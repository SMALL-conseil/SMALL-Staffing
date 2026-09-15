// ============================================================
//  Synchronisation des PRESTATIONS Boond → Delivery (s6).
//  Le listing /deliveries répondant 405, on énumère par les identifiants
//  portés par les lignes de CRA déjà synchronisées : ce sont exactement les
//  prestations sur lesquelles des jours ont été pointés — donc les seules
//  qui comptent pour valoriser le CA.
//  Stratégie : upsert idempotent par boondId. Rien n'est supprimé (une
//  prestation disparue du flux garde sa valeur historique ; le CA des mois
//  écoulés ne doit pas bouger dans le dos de l'équipe).
//  Le client vient du projet (/projects, listing autorisé) ; à défaut, le
//  nom déjà relevé sur les jours de CRA fait l'affaire.
// ============================================================
import { prisma } from "./prisma"
import type { Prisma, PrismaClient } from "@prisma/client"
import { fetchDelivery, fetchProjects, type BoondDelivery, type BoondProject } from "./boond-deliveries"

type Db = PrismaClient | Prisma.TransactionClient

export interface DeliveriesSyncReport {
  /** Prestations distinctes référencées par les jours de CRA. */
  referenced: number
  fetched: number
  created: number
  updated: number
  /** Prestations refusées par l'API (403 : jeton sans droit financier) ou absentes. */
  unreachable: string[]
  /** Prestations lues mais SANS TJM vendu — le CA retombera sur la cascade. */
  withoutRate: string[]
  /** Projets résolus pour nommer le client. */
  projectsResolved: number
  errors: string[]
}

function emptyReport(): DeliveriesSyncReport {
  return {
    referenced: 0, fetched: 0, created: 0, updated: 0,
    unreachable: [], withoutRate: [], projectsResolved: 0, errors: [],
  }
}

const day = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00.000Z`) : null)

/** Lecture d'une prestation (injectable pour les tests). */
export type DeliveryFetcher = (boondId: string) => Promise<BoondDelivery | null>

/**
 * Écrit en base les prestations fournies. PURE vis-à-vis du réseau : les
 * lectures sont injectées, ce qui rend la synchro testable avec rollback.
 * `clientParPrestation` : repli du nom de client (relevé sur les CRA).
 */
export async function runDeliveriesSync(
  db: Db,
  ids: string[],
  fetcher: DeliveryFetcher,
  projets: Map<string, BoondProject>,
  clientParPrestation: Map<string, string> = new Map()
): Promise<DeliveriesSyncReport> {
  const report = emptyReport()
  report.referenced = ids.length
  report.projectsResolved = projets.size

  const now = new Date()
  for (const id of ids) {
    try {
      const d = await fetcher(id)
      if (!d) {
        report.unreachable.push(id)
        continue
      }
      report.fetched++
      if (d.dailyRate === null) report.withoutRate.push(`${id}${d.title ? ` — ${d.title}` : ""}`)

      const projet = d.projectBoondId ? projets.get(d.projectBoondId) : undefined
      const data = {
        title: d.title,
        startDate: day(d.startDate),
        endDate: day(d.endDate),
        dailyRate: d.dailyRate,
        daysSold: d.daysSold,
        state: d.state,
        typeOf: d.typeOf,
        projectBoondId: d.projectBoondId,
        projectName: projet?.reference ?? null,
        resourceBoondId: d.resourceBoondId,
        workingDays: d.workingDays,
        clientName: projet?.clientName ?? clientParPrestation.get(id) ?? null,
        syncedAt: now,
      }
      const existe = await db.delivery.findUnique({ where: { boondId: id } })
      if (existe) {
        await db.delivery.update({ where: { boondId: id }, data })
        report.updated++
      } else {
        await db.delivery.create({ data: { boondId: id, ...data } })
        report.created++
      }
    } catch (e) {
      report.errors.push(`Prestation ${id} : ${e instanceof Error ? e.message : "erreur"}`)
    }
  }
  return report
}

/** Point d'entrée : énumère depuis les CRA, lit Boond, écrit, journalise. */
export async function syncDeliveries(opts: { dryRun?: boolean } = {}): Promise<DeliveriesSyncReport> {
  const dryRun = opts.dryRun === true
  const startedAt = new Date()

  // Les prestations qui comptent : celles portées par des jours de PRODUCTION.
  const refs = await prisma.timeEntry.groupBy({
    by: ["deliveryBoondId", "clientName"],
    where: { activityType: "production", deliveryBoondId: { not: null } },
  })
  const ids = [...new Set(refs.map((r) => r.deliveryBoondId as string))]
  const clientParPrestation = new Map<string, string>()
  for (const r of refs) {
    if (r.deliveryBoondId && r.clientName && !clientParPrestation.has(r.deliveryBoondId)) {
      clientParPrestation.set(r.deliveryBoondId, r.clientName)
    }
  }

  let report: DeliveriesSyncReport
  if (!ids.length) {
    report = emptyReport()
    report.errors.push(
      "Aucune prestation référencée par les jours de CRA — recharger l'historique des jours " +
        "(les lignes d'avant s6 ne portent pas encore l'identifiant de prestation)."
    )
  } else {
    const projets = await fetchProjects()
    if (dryRun) {
      let out: DeliveriesSyncReport | undefined
      try {
        await prisma.$transaction(
          async (tx) => {
            out = await runDeliveriesSync(tx, ids, fetchDelivery, projets, clientParPrestation)
            throw new DryRunRollback()
          },
          { maxWait: 10_000, timeout: 300_000 }
        )
      } catch (e) {
        if (!(e instanceof DryRunRollback)) throw e
      }
      report = out as DeliveriesSyncReport
    } else {
      report = await runDeliveriesSync(prisma, ids, fetchDelivery, projets, clientParPrestation)
    }
  }

  await prisma.syncRun.create({
    data: {
      kind: "BOOND_DELIVERIES",
      dryRun,
      ok: report.errors.length === 0,
      report: report as unknown as Prisma.InputJsonValue,
      startedAt,
      finishedAt: new Date(),
    },
  })
  return report
}

class DryRunRollback extends Error {}
