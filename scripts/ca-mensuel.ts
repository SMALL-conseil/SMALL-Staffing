// ============================================================
//  CA ARRÊTÉ PAR MOIS, ET JOURS SANS MISSION (a39)
//      npx tsx scripts/ca-mensuel.ts [AAAA]
//
//  Deux questions de Sacha, une seule lecture :
//
//  1. « Quels sont les jours de production, et à qui sont-ils rattachés ? »
//     → la liste des jours de CRA qu'AUCUNE mission du registre ne couvre :
//       qui, quel client Boond, combien de jours, sur quelle période, et
//       s'ils sont valorisés (TJM de prestation) ou perdus pour le CA.
//
//  2. « Quel CA à fin août, et quel CA prévu sur septembre ? »
//     → le donut recalculé COMME SI on l'arrêtait au dernier jour du mois
//       précédent (du réalisé pur, aucune projection), puis le mois en cours
//       isolé : ce qui y est déjà pointé + ce qui reste vendu.
//     Le tout ventilé Paris / Bordeaux / Tout SMALL.
//
//  Lecture seule, avec le MÊME moteur que l'écran (lib/reporting.ts).
// ============================================================
import "dotenv/config"
import { prisma } from "../lib/prisma"
import { toIsoDate } from "../lib/staffing-load"
import { todayParis } from "../lib/staffing-ui"
import {
  caParClientReel,
  type PrestationEnCours,
  type ReportingAbsence,
  type ReportingJour,
  type ReportingMission,
} from "../lib/reporting"
import { dansLePerimetre } from "../lib/perimetre"
import { Perimetre } from "../lib/types"

const eur = (n: number) =>
  `${Math.round(n).toLocaleString("fr-FR").replace(/ | /g, " ")} €`
const jr = (n: number) => n.toFixed(2).replace(".", ",")
const titre = (t: string) => console.log(`\n${"═".repeat(78)}\n${t}\n${"═".repeat(78)}`)
const MOIS = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
]

async function main() {
  const today = todayParis()
  const year = Number(process.argv.slice(2).find((a) => /^\d{4}$/.test(a)) ?? today.slice(0, 4))
  const moisCourant = Number(today.slice(5, 7))
  // Dernier jour du mois PRÉCÉDENT : la date d'arrêté « à fin août ».
  const finMoisPrecedent = new Date(Date.UTC(year, moisCourant - 1, 0)).toISOString().slice(0, 10)
  const debutMoisCourant = `${year}-${String(moisCourant).padStart(2, "0")}-01`

  const [missionsDb, joursDb, deliveries, absencesDb] = await Promise.all([
    prisma.mission.findMany({
      include: { person: { select: { defaultDailyRate: true } } },
      orderBy: [{ rank: "asc" }],
    }),
    prisma.timeEntry.findMany({
      where: {
        activityType: "production",
        date: { gte: new Date(Date.UTC(year, 0, 1)), lte: new Date(Date.UTC(year, 11, 31)) },
      },
      select: {
        personId: true, date: true, duration: true, clientName: true, deliveryBoondId: true,
        person: { select: { name: true, agency: true } },
      },
    }),
    prisma.delivery.findMany({
      select: {
        boondId: true, dailyRate: true, clientName: true, daysSold: true,
        startDate: true, endDate: true, resourceBoondId: true,
      },
    }),
    prisma.longAbsence.findMany({ select: { personId: true, startDate: true, endDate: true } }),
  ])
  if (!joursDb.length) return console.log(`Aucun jour de production en ${year}.`)

  const tjm = new Map(deliveries.map((d) => [d.boondId, d.dailyRate]))
  const missions: ReportingMission[] = missionsDb.map((m) => ({
    personId: m.personId,
    client: m.client,
    start: toIsoDate(m.startDate),
    end: toIsoDate(m.endDate),
    share: m.share,
    fees: m.fees,
    defaultRate: m.person.defaultDailyRate,
  }))
  const jours: (ReportingJour & { agency: string | null; name: string })[] = joursDb.map((j) => ({
    personId: j.personId,
    date: toIsoDate(j.date),
    duration: j.duration,
    clientName: j.clientName,
    dailyRate: j.deliveryBoondId ? (tjm.get(j.deliveryBoondId) ?? null) : null,
    deliveryBoondId: j.deliveryBoondId,
    agency: j.person.agency,
    name: j.person.name,
  }))
  const fiches = await prisma.person.findMany({
    where: { boondId: { not: null }, active: true },
    select: { id: true, boondId: true, agency: true },
  })
  const parBoondId = new Map(fiches.map((f) => [f.boondId as string, f]))
  const prestations: (PrestationEnCours & { agency: string | null })[] = deliveries.flatMap((d) => {
    const f = d.resourceBoondId ? parBoondId.get(d.resourceBoondId) : undefined
    if (!f || !d.startDate || !d.endDate) return []
    return [{
      boondId: d.boondId,
      personId: f.id,
      client: d.clientName,
      start: toIsoDate(d.startDate),
      end: toIsoDate(d.endDate),
      dailyRate: d.dailyRate,
      daysSold: d.daysSold,
      agency: f.agency,
    }]
  })
  const absences: ReportingAbsence[] = absencesDb.map((a) => ({
    personId: a.personId,
    start: toIsoDate(a.startDate),
    end: a.endDate ? toIsoDate(a.endDate) : null,
  }))

  // ------------------------------------------- 1. Jours sans mission couvrante
  titre(`1. JOURS DE PRODUCTION QU'AUCUNE MISSION DU REGISTRE NE COUVRE — ${year}`)
  interface Orphelin {
    name: string
    agency: string | null
    client: string
    jours: number
    du: string
    au: string
    valorises: number
    perdus: number
  }
  const orphelins = new Map<string, Orphelin>()
  for (const j of jours) {
    const couverte = missions.some(
      (m) => m.personId === j.personId && m.start <= j.date && j.date <= m.end
    )
    if (couverte) continue
    const client = j.clientName ?? "(client non renseigné)"
    const cle = `${j.personId}|${client}`
    const o = orphelins.get(cle) ?? {
      name: j.name, agency: j.agency, client, jours: 0, du: j.date, au: j.date,
      valorises: 0, perdus: 0,
    }
    o.jours += j.duration
    if (j.date < o.du) o.du = j.date
    if (j.date > o.au) o.au = j.date
    if (j.dailyRate) o.valorises += j.duration
    else o.perdus += j.duration
    orphelins.set(cle, o)
  }
  const liste = [...orphelins.values()].sort((a, b) => b.jours - a.jours)
  const totalJours = liste.reduce((n, o) => n + o.jours, 0)
  const totalPerdus = liste.reduce((n, o) => n + o.perdus, 0)
  console.log(
    `  ${jr(totalJours)} jour(s) sans mission, dont ${jr(totalPerdus)} SANS AUCUN TAUX` +
      ` (ceux-là ne comptent nulle part dans le CA)\n`
  )
  console.log(
    `  ${"Consultant".padEnd(24)}${"Agence".padEnd(11)}${"Client (Boond)".padEnd(30)}${"jours".padStart(7)}` +
      `  période                 valorisés / perdus`
  )
  for (const o of liste) {
    console.log(
      `  ${o.name.slice(0, 22).padEnd(24)}${(o.agency ?? "—").padEnd(11)}${o.client.slice(0, 28).padEnd(30)}` +
        `${jr(o.jours).padStart(7)}  ${o.du} → ${o.au}   ${jr(o.valorises)} / ${jr(o.perdus)}`
    )
  }
  if (!liste.length) console.log("  (aucun — chaque jour pointé tombe dans une mission du registre)")

  // --------------------------------------------- 2. CA arrêté / mois en cours
  const perimetres: [string, Perimetre][] = [
    ["PARIS", Perimetre.PARIS],
    ["BORDEAUX", Perimetre.BORDEAUX],
    ["TOUT SMALL", Perimetre.TOUT],
  ]

  titre(`2. CA ARRÊTÉ AU ${finMoisPrecedent} — réalisé pur, aucune projection`)
  console.log(`  (jours de CRA pointés du 1er janvier au 31 ${MOIS[moisCourant - 2]}, à leur taux)\n`)
  const arretes = new Map<string, number>()
  for (const [nom, p] of perimetres) {
    const js = jours.filter((j) => dansLePerimetre(j.agency, p))
    // `today` = fin du mois précédent, et AUCUNE prestation : pas de vendu restant.
    const out = caParClientReel(missions, js, year, finMoisPrecedent, [], absences)
    arretes.set(nom, out.caReel)
    console.log(`  ${nom.padEnd(12)} ${eur(out.caReel).padStart(14)}`)
  }

  titre(`3. ${MOIS[moisCourant - 1].toUpperCase()} — ce qui est déjà pointé, et ce qui reste vendu`)
  console.log(`  (réalisé du ${debutMoisCourant} au ${today}, puis vendu restant jusqu'à la fin du mois)\n`)
  for (const [nom, p] of perimetres) {
    const js = jours.filter((j) => dansLePerimetre(j.agency, p))
    const ps = prestations.filter((x) => dansLePerimetre(x.agency, p))
    const complet = caParClientReel(missions, js, year, today, ps, absences)
    const jusquAvant = caParClientReel(missions, js, year, finMoisPrecedent, [], absences)
    const realiseMois = complet.caReel - jusquAvant.caReel
    console.log(
      `  ${nom.padEnd(12)} réalisé ${eur(realiseMois).padStart(12)}` +
        ` · vendu restant ${eur(complet.caVenduRestant).padStart(12)} (${jr(complet.joursVenduRestant)} j)` +
        ` · mois complet ${eur(realiseMois + complet.caVenduRestant).padStart(12)}`
    )
  }

  titre(`4. TOTAL ${year} TEL QUE L'AFFICHE LE DONUT AUJOURD'HUI`)
  for (const [nom, p] of perimetres) {
    const js = jours.filter((j) => dansLePerimetre(j.agency, p))
    const ps = prestations.filter((x) => dansLePerimetre(x.agency, p))
    const out = caParClientReel(missions, js, year, today, ps, absences)
    console.log(
      `  ${nom.padEnd(12)} ${eur(out.total).padStart(14)}` +
        `   = arrêté au ${finMoisPrecedent} ${eur(arretes.get(nom) ?? 0)}` +
        ` + ${MOIS[moisCourant - 1]} ${eur(out.total - (arretes.get(nom) ?? 0))}`
    )
  }
  console.log(
    `\n  Rappel : Paris + Bordeaux ne fait pas toujours exactement Tout SMALL —` +
      `\n  une personne transférée en cours d'année compte dans les deux, sur des` +
      `\n  périodes disjointes (s7).`
  )
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
