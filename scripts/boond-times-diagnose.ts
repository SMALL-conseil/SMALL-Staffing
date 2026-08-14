// ============================================================
//  Diagnostic du CA réel — À LANCER EN LOCAL :
//      npx tsx scripts/boond-times-diagnose.ts [CLIENT]
//  (CLIENT optionnel, défaut GROUPAMA — casse indifférente)
//  Imprime tout ce qui explique le donut de /admin/reporting :
//   1. l'état de la table des jours de CRA (vide = donut en convention) ;
//   2. le dernier passage de la synchro des jours ;
//   3. les missions du registre portant des honoraires ;
//   4. la SIMULATION EXACTE du donut (même code que la page) ;
//   5. un zoom sur le client demandé : ses jours CRA se rattachent-ils
//      aux missions de l'app ?
//  Lecture seule. Coller TOUTE la sortie à Claude.
// ============================================================
import "dotenv/config"
import { prisma } from "../lib/prisma"
import { toIsoDate } from "../lib/staffing-load"
import { todayParis } from "../lib/staffing-ui"
import {
  caParClient,
  caParClientReel,
  type ReportingJour,
  type ReportingMission,
} from "../lib/reporting"

const eur = (v: number) => `${Math.round(v).toLocaleString("fr-FR")} €`

async function main() {
  const today = todayParis()
  const year = Number(today.slice(0, 4))
  const cible = (process.argv[2] ?? "GROUPAMA").trim()

  // --- 1. État de la table des jours ---------------------------------------
  const total = await prisma.timeEntry.count()
  console.log(`=== 1. Jours de CRA en base : ${total} ligne(s) ===`)
  if (total === 0) {
    console.log("⚠ TABLE VIDE → le donut est en pure CONVENTION (« jours CRA non synchronisés »).")
    console.log("  (si la table a été vidée pour reconstruction, relancer « Synchroniser les jours »)")
  } else {
    const bornes = await prisma.timeEntry.aggregate({ _min: { date: true }, _max: { date: true } })
    const parAct = await prisma.timeEntry.groupBy({
      by: ["activityType", "workUnit"],
      _sum: { duration: true },
      _count: true,
    })
    const sansClient = await prisma.timeEntry.count({ where: { clientName: null } })
    const personnes = await prisma.timeEntry.groupBy({ by: ["personId"] })
    console.log(
      `  du ${toIsoDate(bornes._min.date as Date)} au ${toIsoDate(bornes._max.date as Date)} · ${personnes.length} personne(s) · ${sansClient} ligne(s) sans client Boond`
    )
    console.log("  Par type d'activité (Σ durées) :")
    for (const a of [...parAct].sort((x, y) => (y._sum.duration ?? 0) - (x._sum.duration ?? 0))) {
      console.log(`    ${a.activityType} · ${a.workUnit} : ${a._sum.duration} j (${a._count} lignes)`)
    }
    const topClients = await prisma.timeEntry.groupBy({
      by: ["clientName"],
      where: {
        activityType: "production",
        date: { gte: new Date(Date.UTC(year, 0, 1)), lte: new Date(Date.UTC(year, 11, 31)) },
      },
      _sum: { duration: true },
    })
    console.log(`  Top clients Boond ${year} (jours de production) :`)
    for (const c of [...topClients].sort((x, y) => (y._sum.duration ?? 0) - (x._sum.duration ?? 0)).slice(0, 12)) {
      console.log(`    ${c.clientName ?? "(sans client)"} : ${c._sum.duration} j`)
    }
  }

  // --- 2. Dernier passage de la synchro des jours --------------------------
  const run = await prisma.syncRun.findFirst({ where: { kind: "BOOND_TIMES" }, orderBy: { startedAt: "desc" } })
  console.log("\n=== 2. Dernière synchro des jours ===")
  if (!run) console.log("  (aucun passage enregistré)")
  else {
    const rep = (run.report ?? {}) as Record<string, unknown>
    console.log(
      `  ${run.startedAt.toISOString()} · ${run.dryRun ? "RÉPÉTITION (rien écrit)" : "réelle"} · ${run.ok ? "OK" : "EN ERREUR"}`
    )
    console.log(
      `  pleine charge=${rep.fullLoad} · pages=${rep.pagesWalked} · lues=${rep.rowsFetched} · écrites=${rep.created} · remplacées=${rep.deleted} · fenêtre=${rep.windowFrom}→${rep.windowTo}`
    )
    console.log(
      `  sans fiche=${rep.skippedNoPerson} · inexploitables=${rep.skippedUnusable} · erreurs=${JSON.stringify(rep.errors ?? [])}`
    )
  }

  // --- 3. Missions à honoraires --------------------------------------------
  const missionsDb = await prisma.mission.findMany({ orderBy: { rank: "asc" }, include: { person: true } })
  const avecFees = missionsDb.filter((m) => m.fees !== null)
  console.log(`\n=== 3. Missions avec honoraires : ${avecFees.length} / ${missionsDb.length} ===`)
  for (const m of avecFees) {
    console.log(
      `  ${m.client} · ${m.person.name} · ${toIsoDate(m.startDate)} → ${toIsoDate(m.endDate)} · ${m.fees} €/j`
    )
  }

  // --- 4. Simulation EXACTE du donut (même code que la page) ---------------
  const missions: ReportingMission[] = missionsDb.map((m) => ({
    personId: m.personId,
    client: m.client,
    start: toIsoDate(m.startDate),
    end: toIsoDate(m.endDate),
    fees: m.fees,
  }))
  const joursDb = await prisma.timeEntry.findMany({
    where: {
      activityType: "production",
      date: { gte: new Date(Date.UTC(year, 0, 1)), lte: new Date(Date.UTC(year, 11, 31)) },
    },
    select: { personId: true, date: true, duration: true, clientName: true },
  })
  const jours: ReportingJour[] = joursDb.map((j) => ({
    personId: j.personId,
    date: toIsoDate(j.date),
    duration: j.duration,
    clientName: j.clientName,
  }))
  console.log(`\n=== 4. Donut ${year} recalculé (${jours.length} jour(s) de production chargés) ===`)
  if (jours.length === 0) {
    const conv = caParClient(missions, year, today)
    console.log(`  MODE CONVENTION · total ${eur(conv.total)}`)
    for (const e of conv.entries) console.log(`    ${e.client} : ${eur(e.ca)}`)
    console.log(`  sans honoraires : ${JSON.stringify(conv.sansHonoraires)}`)
  } else {
    const reel = caParClientReel(missions, jours, year, today)
    console.log(
      `  MODE RÉEL+CONVENTION · total ${eur(reel.total)} (réel ${eur(reel.caReel)} jusqu'au mois ${reel.moisReelMax} · convention ${eur(reel.caConvention)})`
    )
    for (const e of reel.entries) console.log(`    ${e.client} : ${eur(e.ca)}`)
    console.log(`  jours de production SANS mission couvrante : ${reel.joursSansMission} j`)
    console.log(`  missions sans honoraires (exclues) : ${JSON.stringify(reel.sansHonoraires)}`)
  }

  // --- 5. Zoom client ------------------------------------------------------
  const t = cible.toLowerCase()
  console.log(`\n=== 5. Zoom « ${cible} » ===`)
  const missionsCible = missionsDb.filter((m) => m.client.toLowerCase().includes(t))
  console.log(`  Missions de l'app : ${missionsCible.length}`)
  for (const m of missionsCible) {
    const joursAttribues = jours.filter(
      (j) => j.personId === m.personId && j.date >= toIsoDate(m.startDate) && j.date <= toIsoDate(m.endDate)
    )
    const somme = joursAttribues.reduce((n, j) => n + j.duration, 0)
    console.log(
      `    ${m.person.name} · ${toIsoDate(m.startDate)} → ${toIsoDate(m.endDate)} · fees=${m.fees ?? "NON RENSEIGNÉS"} · ${somme} j de production ${year} dans la fenêtre`
    )
  }
  const joursCible = await prisma.timeEntry.findMany({
    where: { clientName: { contains: cible, mode: "insensitive" }, activityType: "production" },
    include: { person: true },
    orderBy: { date: "asc" },
  })
  console.log(`  Jours CRA (client Boond ~ « ${cible} », toutes années) : ${joursCible.length}`)
  const parPersonne = new Map<string, { n: number; min: string; max: string; couverts: number }>()
  for (const j of joursCible) {
    const d = toIsoDate(j.date)
    const cur = parPersonne.get(j.person.name) ?? { n: 0, min: d, max: d, couverts: 0 }
    cur.n += j.duration
    if (d < cur.min) cur.min = d
    if (d > cur.max) cur.max = d
    const couvert = missionsDb.some(
      (m) => m.personId === j.personId && toIsoDate(m.startDate) <= d && d <= toIsoDate(m.endDate)
    )
    if (couvert) cur.couverts += j.duration
    parPersonne.set(j.person.name, cur)
  }
  for (const [name, s] of parPersonne) {
    console.log(
      `    ${name} : ${s.n} j (${s.min} → ${s.max}) · ${s.couverts} j couverts par une mission de l'app${s.couverts < s.n ? " ⚠" : ""}`
    )
  }

  console.log("\n→ Coller TOUTE cette sortie à Claude.")
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
