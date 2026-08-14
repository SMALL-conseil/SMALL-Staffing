// ============================================================
//  Synchronisation Boond /times → TimeEntry (jours de CRA) — a12.
//  Stratégie « REMPLACEMENT PAR FENÊTRE » (≠ synchro personnes) :
//   · l'API n'honore aucun filtre de dates mais trie par startDate → on
//     descend les pages en ordre DÉCROISSANT jusqu'à passer la date de
//     coupure (aujourd'hui − BOOND_TIMES_LOOKBACK_DAYS, 90 par défaut) ;
//   · table vide (premier passage, reconstruction) → PLEINE CHARGE : toutes
//     les pages, aucune coupure ;
//   · en base, la fenêtre est SUPPRIMÉE puis réinsérée dans la même
//     transaction : corrections ET suppressions de CRA suivies, idempotent ;
//   · seules les lignes dont la ressource correspond à une Person (boondId,
//     posé par la synchro personnes) sont conservées — le reste est compté.
//  Les jours sont des données RÉPLIQUÉES (pas un registre) : les remplacer
//  est légitime, contrairement aux personnes (jamais supprimées).
// ============================================================
import { prisma } from "./prisma"
import type { Prisma, PrismaClient } from "@prisma/client"
import { extractTimeRows, fetchTimesPage, type BoondTimeRow } from "./boond-times"

type Db = PrismaClient | Prisma.TransactionClient

const LOOKBACK_DAYS = Number(process.env.BOOND_TIMES_LOOKBACK_DAYS || "90")
const MAX_PAGES = Number(process.env.BOOND_TIMES_MAX_PAGES || "300")

export interface TimesSyncReport {
  /** Pleine charge (table vide) ou fenêtre incrémentale. */
  fullLoad: boolean
  pagesWalked: number
  rowsFetched: number
  /** Bornes de la fenêtre réellement écrite. */
  windowFrom: string | null
  windowTo: string | null
  deleted: number
  created: number
  /** Σ durées écrites par type d'activité (production / absence / …). */
  parActivite: Record<string, number>
  /** Lignes dont la ressource Boond n'a pas de fiche en base (personnes non
   *  synchronisées : partis d'avant l'import, inconnus) — non conservées. */
  skippedNoPerson: number
  personsUnknown: string[]
  /** Lignes sans date ou sans ressource résolue — inexploitables. */
  skippedUnusable: number
  errors: string[]
}

function emptyReport(fullLoad: boolean): TimesSyncReport {
  return {
    fullLoad, pagesWalked: 0, rowsFetched: 0, windowFrom: null, windowTo: null,
    deleted: 0, created: 0, parActivite: {}, skippedNoPerson: 0, personsUnknown: [],
    skippedUnusable: 0, errors: [],
  }
}

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

export function isoDaysAgo(todayIso: string, days: number): string {
  const d = day(todayIso)
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

/**
 * Applique en base une fenêtre de jours CRA : suppression de la fenêtre puis
 * réinsertion des lignes rattachables. `cutoffIso` null = pleine charge
 * (toute la table). PURE vis-à-vis du fetch — testée avec rollback.
 */
export async function runTimesSync(
  db: Db,
  rows: BoondTimeRow[],
  opts: { cutoffIso: string | null; pagesWalked: number }
): Promise<TimesSyncReport> {
  const report = emptyReport(opts.cutoffIso === null)
  report.pagesWalked = opts.pagesWalked
  report.rowsFetched = rows.length

  try {
    // Résolution ressource Boond → Person (boondId posés par la synchro personnes).
    const persons = await db.person.findMany({
      where: { boondId: { not: null } },
      select: { id: true, boondId: true },
    })
    const byBoondId = new Map(persons.map((p) => [p.boondId as string, p.id]))
    if (byBoondId.size === 0) {
      report.errors.push(
        "Aucune personne rapprochée de Boond en base — lancer d'abord la synchro des personnes."
      )
      return report
    }

    const unknown = new Map<string, number>()
    const kept: { row: BoondTimeRow; personId: string }[] = []
    for (const r of rows) {
      if (!r.date || !r.resourceBoondId || r.duration <= 0) { report.skippedUnusable++; continue }
      if (opts.cutoffIso && r.date < opts.cutoffIso) continue // hors fenêtre (queue de page)
      const personId = byBoondId.get(r.resourceBoondId)
      if (!personId) {
        report.skippedNoPerson++
        unknown.set(r.resourceBoondId, (unknown.get(r.resourceBoondId) ?? 0) + 1)
        continue
      }
      kept.push({ row: r, personId })
    }
    report.personsUnknown = [...unknown.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([id, n]) => `resource#${id} (${n} ligne${n > 1 ? "s" : ""})`)

    // Garde-fous : ne JAMAIS vider une fenêtre sur un flux vide ou intégralement
    // irrésolu — c'est un symptôme (panne, droits API), pas une réalité métier.
    if (rows.length === 0) {
      report.errors.push("Flux /times vide — rien n'est touché.")
      return report
    }
    if (kept.length === 0) {
      report.errors.push(
        "Aucune ligne rattachable dans la fenêtre (ressources inconnues ou lignes inexploitables) — rien n'est touché."
      )
      return report
    }

    for (const { row } of kept) {
      const d = row.date as string
      if (!report.windowFrom || d < report.windowFrom) report.windowFrom = d
      if (!report.windowTo || d > report.windowTo) report.windowTo = d
      report.parActivite[row.activityType] =
        Math.round(((report.parActivite[row.activityType] ?? 0) + row.duration) * 100) / 100
    }

    // Remplacement par fenêtre — dans la transaction appelante.
    const where = opts.cutoffIso === null ? {} : { date: { gte: day(opts.cutoffIso) } }
    const del = await db.timeEntry.deleteMany({ where })
    report.deleted = del.count

    const now = new Date()
    const data = kept.map(({ row, personId }) => ({
      boondId: row.boondId,
      personId,
      date: day(row.date as string),
      duration: row.duration,
      category: row.category,
      activityType: row.activityType,
      workUnit: row.workUnit,
      projectBoondId: row.projectBoondId,
      projectName: row.projectName,
      clientName: row.clientName,
      craState: row.craState,
      craTerm: row.craTerm,
      syncedAt: now,
    }))
    for (let i = 0; i < data.length; i += 2000) {
      const chunk = data.slice(i, i + 2000)
      const res = await db.timeEntry.createMany({ data: chunk, skipDuplicates: true })
      report.created += res.count
    }
  } catch (e) {
    report.errors.push(e instanceof Error ? e.message : "Erreur de synchronisation des jours")
  }
  return report
}

/** Lit /times : pleine charge en ordre NATUREL (pagination stable), fenêtre
 *  incrémentale en tri décroissant (arrêt dès que la coupure est dépassée). */
export async function fetchTimesWindow(
  cutoffIso: string | null
): Promise<{ rows: BoondTimeRow[]; pages: number }> {
  const rows: BoondTimeRow[] = []
  let pages = 0
  for (let page = 1; page <= MAX_PAGES; page++) {
    const p = await fetchTimesPage(page, cutoffIso === null ? null : "desc")
    pages = page
    const extracted = extractTimeRows(p.rows, p.included)
    rows.push(...extracted)
    if (!p.rows.length) break
    if (p.total !== null && page * 100 >= p.total) break
    if (cutoffIso) {
      const dates = extracted.map((r) => r.date).filter((d): d is string => !!d)
      // Tri décroissant : si le plus ANCIEN jour de la page précède la
      // coupure, les pages suivantes sont plus anciennes encore — stop.
      if (dates.length && dates.reduce((a, b) => (a < b ? a : b)) < cutoffIso) break
    }
  }
  return { rows, pages }
}

class DryRunRollback extends Error {}
/** Avorte la transaction réelle en emportant le rapport (rien n'est perdu). */
class SyncAbort extends Error {
  constructor(public report: TimesSyncReport) { super("times-sync-abort") }
}

/** Point d'entrée : fetch + fenêtre + journal SyncRun (kind BOOND_TIMES).
 *  `full` force une pleine charge (reconstruction) même si la table est pleine. */
export async function syncTimes(
  opts: { dryRun?: boolean; todayIso?: string; full?: boolean } = {}
): Promise<TimesSyncReport> {
  const dryRun = opts.dryRun === true
  const startedAt = new Date()
  const todayIso = opts.todayIso ?? new Date().toISOString().slice(0, 10)

  const existing = await prisma.timeEntry.count()
  const cutoffIso = opts.full === true || existing === 0 ? null : isoDaysAgo(todayIso, LOOKBACK_DAYS)
  const { rows, pages } = await fetchTimesWindow(cutoffIso)

  let report: TimesSyncReport
  if (dryRun) {
    let out: TimesSyncReport | undefined
    try {
      await prisma.$transaction(async (tx) => {
        out = await runTimesSync(tx, rows, { cutoffIso, pagesWalked: pages })
        throw new DryRunRollback()
      }, { maxWait: 10_000, timeout: 300_000 })
    } catch (e) {
      if (!(e instanceof DryRunRollback)) throw e
    }
    report = out as TimesSyncReport
  } else {
    // Une erreur en cours de remplacement (fenêtre supprimée, insertion en
    // échec…) doit ANNULER la transaction — le rapport voyage dans l'abandon.
    try {
      report = await prisma.$transaction(async (tx) => {
        const r = await runTimesSync(tx, rows, { cutoffIso, pagesWalked: pages })
        if (r.errors.length > 0) throw new SyncAbort(r)
        return r
      }, { maxWait: 10_000, timeout: 300_000 })
    } catch (e) {
      if (!(e instanceof SyncAbort)) throw e
      report = e.report
    }
  }

  await prisma.syncRun.create({
    data: {
      kind: "BOOND_TIMES",
      dryRun,
      ok: report.errors.length === 0,
      report: report as unknown as Prisma.InputJsonValue,
      startedAt,
      finishedAt: new Date(),
    },
  })
  return report
}
