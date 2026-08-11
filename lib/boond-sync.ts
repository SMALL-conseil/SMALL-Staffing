// ============================================================
//  Synchronisation Boond → registre Person (staffing).
//  Sens unique Boond → app, idempotente sur Person.boondId, rapprochement
//  initial par email puis par nom (même kind uniquement — une personne peut
//  exister en consultant ET en siège, ex. Elvire HOUDEVILLE).
//  INVARIANTS staffing (≠ Formation) :
//   · le grade reçoit le Titre Boond BRUT (« SM 2 », « M 1 »… jamais aplati) ;
//   · une personne n'est JAMAIS supprimée ni masquée — l'historique des
//     KPIs vit sur les dates ; un départ = departureDate, rien d'autre ;
//   · les absents du flux sont seulement SIGNALÉS dans le rapport ;
//   · les missions ne sont jamais touchées (saisies dans l'app en v1).
//  Dry run : transaction annulée (sentinelle), rapport conservé.
// ============================================================
import { prisma } from "./prisma"
import type { Prisma, PrismaClient } from "@prisma/client"
import { CONSULTANT_GRADES, PersonKind, SIEGE_GRADES } from "./types"
import { extractPerson, fetchResources, normText, type BoondPerson } from "./boond"

type Db = PrismaClient | Prisma.TransactionClient

export interface SyncReport {
  received: number
  pages: number
  updated: number
  created: number
  adopted: number
  managersLinked: number
  skippedExcluded: number
  skippedInactive: { name: string; state: string | null }[]
  skippedNoTitle: string[]
  skippedNoArrival: string[]
  assumedConsultant: { name: string; title: string }[]
  unknownTitles: string[]
  kindConflicts: string[]
  departuresSet: { name: string; date: string }[]
  absentsDuFlux: string[]
  nonRapproches: number
  errors: string[]
}

function emptyReport(received: number, pages: number): SyncReport {
  return {
    received, pages, updated: 0, created: 0, adopted: 0, managersLinked: 0,
    skippedExcluded: 0, skippedInactive: [], skippedNoTitle: [], skippedNoArrival: [],
    assumedConsultant: [], unknownTitles: [], kindConflicts: [], departuresSet: [],
    absentsDuFlux: [], nonRapproches: 0, errors: [],
  }
}

/** Kind déduit du titre BRUT : grades consultants fins → CONSULTANT ;
 *  grades siège connus → SIEGE ; inconnu → CONSULTANT (supposé, signalé). */
export function kindFromTitle(title: string): { kind: string; assumed: boolean } {
  if ((CONSULTANT_GRADES as readonly string[]).includes(title)) return { kind: PersonKind.CONSULTANT, assumed: false }
  if ((SIEGE_GRADES as readonly string[]).includes(title)) return { kind: PersonKind.SIEGE, assumed: false }
  return { kind: PersonKind.CONSULTANT, assumed: true }
}

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

export async function runBoondSync(db: Db, items: BoondPerson[], pages: number): Promise<SyncReport> {
  const report = emptyReport(items.length, pages)
  if (!items.length) {
    report.errors.push("Flux Boond vide — synchronisation annulée par sécurité.")
    return report
  }

  const now = new Date()
  const seen = new Set<string>()

  // Passe 1 — upsert des personnes
  for (const p of items) {
    if (p.excluded) { report.skippedExcluded++; continue }
    if (!p.activeState) { report.skippedInactive.push({ name: p.name || p.boondId, state: p.state }); continue }
    if (!p.name) { report.errors.push(`Ressource ${p.boondId} sans nom — ignorée`); continue }

    try {
      let person = await db.person.findUnique({ where: { boondId: p.boondId } })
      let adopted = false

      if (!person) {
        // Rapprochement initial (import Excel sans boondId) — même kind UNIQUEMENT.
        if (!p.title) { report.skippedNoTitle.push(p.name); continue }
        const { kind, assumed } = kindFromTitle(p.title)
        if (assumed) report.assumedConsultant.push({ name: p.name, title: p.title })

        const candidates = await db.person.findMany({ where: { kind, boondId: null } })
        person =
          (p.email && candidates.find((c) => c.email?.toLowerCase() === p.email)) ||
          candidates.find((c) => normText(c.name) === normText(p.name)) ||
          null

        if (!person) {
          // Conflit de kind ? (correspondance email/nom sur l'AUTRE kind)
          const others = await db.person.findMany({ where: { boondId: null, NOT: { kind } } })
          const crossHit = others.find(
            (c) => (p.email && c.email?.toLowerCase() === p.email) || normText(c.name) === normText(p.name)
          )
          if (crossHit) {
            report.kindConflicts.push(
              `${p.name} (titre « ${p.title} », kind déduit ${kind}) ressemble à ${crossHit.name} (${crossHit.kind}) — non modifié, à rapprocher manuellement`
            )
            continue
          }
        } else {
          adopted = true
        }

        if (!person) {
          // Création — la date d'arrivée est indispensable au moteur.
          if (!p.arrival) { report.skippedNoArrival.push(p.name); continue }
          await db.person.create({
            data: {
              name: p.name,
              email: p.email,
              kind,
              grade: p.title,
              arrivalDate: day(p.arrival),
              departureDate: p.departure ? day(p.departure) : null,
              boondId: p.boondId,
              boondState: p.state,
              boondSyncedAt: now,
            },
          })
          if (p.departure) report.departuresSet.push({ name: p.name, date: p.departure })
          if (!(CONSULTANT_GRADES as readonly string[]).includes(p.title) &&
              !(SIEGE_GRADES as readonly string[]).includes(p.title) &&
              !report.unknownTitles.includes(p.title)) {
            report.unknownTitles.push(p.title)
          }
          report.created++
          seen.add(p.boondId)
          continue
        }
      }

      // Mise à jour (personne connue ou tout juste rapprochée)
      const data: Record<string, unknown> = {
        boondId: p.boondId,
        boondState: p.state,
        boondSyncedAt: now,
        name: p.name,
      }
      if (p.email) data.email = p.email
      if (p.title) {
        data.grade = p.title
        if (!(CONSULTANT_GRADES as readonly string[]).includes(p.title) &&
            !(SIEGE_GRADES as readonly string[]).includes(p.title) &&
            !report.unknownTitles.includes(p.title)) {
          report.unknownTitles.push(p.title)
        }
      }
      if (p.arrival) data.arrivalDate = day(p.arrival)
      if (p.departure) {
        const before = person.departureDate?.toISOString().slice(0, 10) ?? null
        if (before !== p.departure) report.departuresSet.push({ name: p.name, date: p.departure })
        data.departureDate = day(p.departure)
      }
      // NB : un départ existant n'est JAMAIS effacé si Boond n'en fournit pas.

      await db.person.update({ where: { id: person.id }, data: data as never })
      report.updated++
      if (adopted) report.adopted++
      seen.add(p.boondId)
    } catch (e) {
      report.errors.push(
        `Ressource ${p.boondId} (${p.name}) : ${e instanceof Error ? e.message : "erreur upsert"}`
      )
    }
  }

  // Garde-fou : rien d'abouti → on s'arrête là.
  if (!seen.size) {
    report.errors.push("Aucune personne synchronisée — passes suivantes ignorées par sécurité.")
    return report
  }

  // Passe 2 — liens managers (par boondId, comme Formation)
  for (const p of items) {
    if (!p.managerBoondId || !seen.has(p.boondId)) continue
    try {
      const [me, mgr] = await Promise.all([
        db.person.findUnique({ where: { boondId: p.boondId } }),
        db.person.findUnique({ where: { boondId: p.managerBoondId } }),
      ])
      if (me && mgr && me.id !== mgr.id && me.managerId !== mgr.id) {
        await db.person.update({ where: { id: me.id }, data: { managerId: mgr.id } })
        report.managersLinked++
      }
    } catch (e) {
      report.errors.push(
        `Lien manager ${p.boondId} → ${p.managerBoondId} : ${e instanceof Error ? e.message : "erreur"}`
      )
    }
  }

  // Passe 3 — absents du flux : SIGNALÉS seulement (jamais désactivés — les
  // dates portent l'historique du staffable).
  const absents = await db.person.findMany({
    where: { boondId: { not: null }, NOT: { boondId: { in: [...seen] } } },
    select: { name: true },
  })
  report.absentsDuFlux = absents.map((a) => a.name)
  report.nonRapproches = await db.person.count({ where: { boondId: null } })

  return report
}

/** Erreur sentinelle : fait annuler la transaction en mode dryRun. */
class DryRunRollback extends Error {
  constructor() { super("DRY_RUN_ROLLBACK") }
}

export async function syncBoond(opts: { dryRun?: boolean } = {}): Promise<SyncReport> {
  const dryRun = opts.dryRun === true
  const startedAt = new Date()
  const { resources, pages } = await fetchResources()
  const items = resources.map(extractPerson)

  let report: SyncReport
  if (dryRun) {
    let out: SyncReport | undefined
    try {
      await prisma.$transaction(async (tx) => {
        out = await runBoondSync(tx, items, pages)
        throw new DryRunRollback()
      }, { maxWait: 10_000, timeout: 120_000 })
    } catch (e) {
      if (!(e instanceof DryRunRollback)) throw e
    }
    report = out as SyncReport
  } else {
    report = await runBoondSync(prisma, items, pages)
  }

  // Journal (aussi en dry run — le rapport est la valeur du test)
  await prisma.syncRun.create({
    data: {
      kind: "BOOND",
      dryRun,
      ok: report.errors.length === 0,
      report: report as unknown as Prisma.InputJsonValue,
      startedAt,
      finishedAt: new Date(),
    },
  })
  return report
}

// ------------------------------------------------------------
//  Croisement de contrôle : état Boond ↔ calcul missions de l'app.
//  (2 = intercontrat, 3 = en mission — relevé au dernier sync)
// ------------------------------------------------------------

export interface CroisementEntry {
  personId: string
  name: string
  grade: string
  boondState: string
  appStatus: string
  detail: string
}

export function computeCroisement(
  persons: {
    id: string
    name: string
    grade: string
    kind: string
    boondState: string | null
    arrival: string
    departure: string | null
  }[],
  missions: { personId: string; client: string; start: string; end: string }[],
  today: string
): CroisementEntry[] {
  const out: CroisementEntry[] = []
  for (const p of persons) {
    if (p.kind !== PersonKind.CONSULTANT) continue
    if (p.boondState !== "2" && p.boondState !== "3") continue
    if (p.arrival > today) continue
    if (p.departure && p.departure < today) continue
    const current = missions.filter((m) => m.personId === p.id && m.start <= today && today <= m.end)
    if (p.boondState === "3" && current.length === 0) {
      out.push({
        personId: p.id, name: p.name, grade: p.grade, boondState: "3",
        appStatus: "aucune mission en cours",
        detail: "Boond le dit en mission — aucune mission saisie ne couvre aujourd'hui",
      })
    } else if (p.boondState === "2" && current.length > 0) {
      out.push({
        personId: p.id, name: p.name, grade: p.grade, boondState: "2",
        appStatus: `en mission (${current.map((m) => m.client).join(", ")})`,
        detail: "Boond le dit en intercontrat — une mission saisie couvre aujourd'hui",
      })
    }
  }
  return out
}
