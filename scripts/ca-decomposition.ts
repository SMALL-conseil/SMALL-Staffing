// ============================================================
//  D'OÙ VIENT LE CA ? (a32) — décomposition du KPI, et de sa VARIATION.
//      npx tsx scripts/ca-decomposition.ts [AAAA]
//
//  Le rechargement complet des CRA a fait bouger le montant. Trois causes
//  possibles, et ce relevé les CHIFFRE au lieu de les supposer :
//   1. le périmètre du jeton (a27) a fait entrer les jours des 10 bordelais ;
//   2. les prestations (s6) valorisent chaque jour au TJM VENDU, là où la
//      cascade retombait sur les honoraires de mission — ou sur RIEN, auquel
//      cas le jour n'était pas compté du tout ;
//   3. l'historique rechargé couvre des mois que la fenêtre des 90 jours ne
//      relisait plus.
//
//  Le script recalcule le même CA sous plusieurs hypothèses, avec le MÊME
//  moteur que l'app (lib/reporting.ts), et affiche l'écart entre chacune.
//  Puis il cherche ce qui gonfle anormalement : durées qui ne valent pas une
//  journée, TJM aberrants, clients qui ressemblent à de la facturation interne,
//  jours hors de la présence de la personne.
//  Lecture seule.
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
import { Agency } from "../lib/types"

const eur = (n: number) =>
  `${Math.round(n).toLocaleString("fr-FR").replace(/ | /g, " ")} €`
const jr = (n: number) => n.toFixed(2).replace(".", ",")
const titre = (t: string) => console.log(`\n${"═".repeat(78)}\n${t}\n${"═".repeat(78)}`)
// Un client qui ressemble à du refacturé interne : ce n'est pas du chiffre
// d'affaires externe, et ça peut gonfler le KPI sans qu'on le voie.
const INTERNE = /small|interne|intragroupe|intra-groupe/i

async function main() {
  const today = todayParis()
  const year = Number(process.argv.slice(2).find((a) => /^\d{4}$/.test(a)) ?? today.slice(0, 4))

  const [missionsDb, joursDb, prestations] = await Promise.all([
    prisma.mission.findMany({
      include: { person: { select: { name: true, agency: true, defaultDailyRate: true } } },
      orderBy: [{ rank: "asc" }],
    }),
    prisma.timeEntry.findMany({
      where: {
        activityType: "production",
        date: { gte: new Date(Date.UTC(year, 0, 1)), lte: new Date(Date.UTC(year, 11, 31)) },
      },
      select: {
        personId: true, date: true, duration: true, clientName: true, deliveryBoondId: true,
        person: { select: { name: true, agency: true, arrivalDate: true, departureDate: true } },
      },
    }),
    prisma.delivery.findMany({
      select: {
        boondId: true, dailyRate: true, clientName: true, daysSold: true,
        startDate: true, endDate: true, resourceBoondId: true,
      },
    }),
  ])

  // s9 — carnet de commandes : les prestations rattachées à une fiche du registre.
  const fiches = await prisma.person.findMany({
    where: { boondId: { not: null }, active: true },
    select: { id: true, boondId: true },
  })
  const parBoondId = new Map(fiches.map((f) => [f.boondId as string, f.id]))
  const enCours: PrestationEnCours[] = prestations.flatMap((d) => {
    const personId = d.resourceBoondId ? parBoondId.get(d.resourceBoondId) : undefined
    if (!personId || !d.startDate || !d.endDate) return []
    return [{
      boondId: d.boondId,
      personId,
      client: d.clientName,
      start: toIsoDate(d.startDate),
      end: toIsoDate(d.endDate),
      dailyRate: d.dailyRate,
      daysSold: d.daysSold,
    }]
  })
  const absences: ReportingAbsence[] = (
    await prisma.longAbsence.findMany({ select: { personId: true, startDate: true, endDate: true } })
  ).map((a) => ({
    personId: a.personId,
    start: toIsoDate(a.startDate),
    end: a.endDate ? toIsoDate(a.endDate) : null,
  }))

  if (!joursDb.length) {
    console.log(`Aucun jour de production en ${year}.`)
    return
  }

  const tjm = new Map(prestations.map((d) => [d.boondId, d.dailyRate]))
  const missions: ReportingMission[] = missionsDb.map((m) => ({
    personId: m.personId,
    client: m.client,
    start: toIsoDate(m.startDate),
    end: toIsoDate(m.endDate),
    share: m.share,
    fees: m.fees,
    defaultRate: m.person.defaultDailyRate,
  }))
  const jours: ReportingJour[] = joursDb.map((j) => ({
    personId: j.personId,
    date: toIsoDate(j.date),
    duration: j.duration,
    clientName: j.clientName,
    dailyRate: j.deliveryBoondId ? (tjm.get(j.deliveryBoondId) ?? null) : null,
    deliveryBoondId: j.deliveryBoondId,
  }))
  const bordelais = new Set(
    joursDb.filter((j) => j.person.agency === Agency.BORDEAUX).map((j) => j.personId)
  )

  // ---------------------------------------------------------------- 1. Écarts
  titre(`CA ${year} — d'où vient le montant`)
  const aujourdhui = caParClientReel(missions, jours, year, today, enCours, absences)
  const sansPrestations = caParClientReel(
    missions,
    jours.map((j) => ({ ...j, dailyRate: null })),
    year,
    today
  )
  const sansBordeaux = caParClientReel(
    missions,
    jours.filter((j) => !bordelais.has(j.personId)),
    year,
    today,
    enCours.filter((p) => !bordelais.has(p.personId)),
    absences
  )
  const avantTout = caParClientReel(
    missions,
    jours.filter((j) => !bordelais.has(j.personId)).map((j) => ({ ...j, dailyRate: null })),
    year,
    today
  )

  console.log(`  Aujourd'hui                                  ${eur(aujourdhui.total).padStart(14)}`)
  console.log(
    `    dont RÉALISÉ (jusqu'au ${aujourdhui.realiseJusquau})       ${eur(aujourdhui.caReel).padStart(14)}`
  )
  console.log(
    `    dont VENDU RESTANT sur le mois (${String(aujourdhui.joursVenduRestant).padStart(6)} j)  ${eur(aujourdhui.caVenduRestant).padStart(14)}`
  )
  console.log(
    `\n  Sans les prestations (cascade seule, avant s6)${eur(sansPrestations.total).padStart(14)}` +
      `   écart ${eur(aujourdhui.total - sansPrestations.total)}`
  )
  console.log(
    `  Sans les bordelais (avant a27)               ${eur(sansBordeaux.total).padStart(14)}` +
      `   écart ${eur(aujourdhui.total - sansBordeaux.total)}`
  )
  console.log(
    `  Sans l'un ni l'autre (l'état d'avant)        ${eur(avantTout.total).padStart(14)}` +
      `   écart TOTAL ${eur(aujourdhui.total - avantTout.total)}`
  )
  console.log(
    `\n  Jours valorisés au TJM de la prestation : ${jr(aujourdhui.joursAuTjmPrestation)}` +
      ` · par la cascade : ${jr(aujourdhui.joursALaCascade)}` +
      ` · sans aucun taux : ${jr(aujourdhui.joursSansMission)}`
  )

  // ------------------------------------------------------------- 2. Par mois
  titre(`Mois par mois (volet RÉEL uniquement)`)
  const parMois = new Map<string, { jours: number; ca: number }>()
  for (const j of jours) {
    const mois = j.date.slice(0, 7)
    if (j.date > aujourdhui.realiseJusquau) continue
    const taux =
      j.dailyRate ??
      (() => {
        const m = missions.find((x) => x.personId === j.personId && x.start <= j.date && j.date <= x.end)
        return m ? (m.fees ?? m.defaultRate ?? null) : null
      })()
    const cur = parMois.get(mois) ?? { jours: 0, ca: 0 }
    cur.jours += j.duration
    cur.ca += taux ? j.duration * taux : 0
    parMois.set(mois, cur)
  }
  for (const [mois, v] of [...parMois.entries()].sort()) {
    console.log(
      `  ${mois}   ${jr(v.jours).padStart(8)} j   ${eur(v.ca).padStart(13)}` +
        `   TJM moyen ${v.jours ? Math.round(v.ca / v.jours) : 0} €`
    )
  }

  // ------------------------------------------------- 2bis. Par agence
  titre(`Par agence (volet RÉEL) — pour comparer à la vision parisienne d'avant`)
  const parAgence = new Map<string, { jours: number; ca: number }>()
  for (const j of joursDb) {
    const d = toIsoDate(j.date)
    if (d > aujourdhui.realiseJusquau || !d.startsWith(`${year}-`)) continue
    const tjmJour =
      (j.deliveryBoondId ? tjm.get(j.deliveryBoondId) : null) ??
      (() => {
        const m = missions.find((x) => x.personId === j.personId && x.start <= d && d <= x.end)
        return m ? (m.fees ?? m.defaultRate ?? null) : null
      })()
    const cle = j.person.agency ?? "(vide → Paris)"
    const cur = parAgence.get(cle) ?? { jours: 0, ca: 0 }
    cur.jours += j.duration
    cur.ca += tjmJour ? j.duration * tjmJour : 0
    parAgence.set(cle, cur)
  }
  for (const [a, v] of [...parAgence.entries()].sort((x, y) => y[1].ca - x[1].ca)) {
    console.log(`  ${a.padEnd(18)} ${jr(v.jours).padStart(9)} j   ${eur(v.ca).padStart(13)}`)
  }

  // ----------------------------------------------------------- 3. Par client
  titre(`Par client — et ce qui ressemble à du refacturé interne`)
  let interne = 0
  for (const e of aujourdhui.entries.slice(0, 25)) {
    const drapeau = INTERNE.test(e.client) ? "   ⚠ INTERNE ?" : ""
    if (INTERNE.test(e.client)) interne += e.ca
    console.log(`  ${e.client.slice(0, 38).padEnd(40)} ${eur(e.ca).padStart(13)}${drapeau}`)
  }
  if (interne > 0) {
    console.log(
      `\n  ⚠ ${eur(interne)} portés par des libellés qui sentent la facturation interne.` +
        `\n    À exclure du CA client si c'en est : me le dire, la règle se pose en une ligne.`
    )
  }

  // ------------------------------------------- 3bis. Libellés à rapprocher
  const parNorm = new Map<string, string[]>()
  const normC = (x: string) =>
    x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "")
  for (const e of aujourdhui.entries) {
    const k = normC(e.client)
    parNorm.set(k, [...(parNorm.get(k) ?? []), e.client])
  }
  const doublons = [...parNorm.values()].filter((v) => v.length > 1)
  if (doublons.length) {
    console.log(
      `\n  Libellés à rapprocher (le donut les compte séparément) : ` +
        doublons.map((v) => v.join(" / ")).join(" · ")
    )
  }

  // --------------------------------------------------- 4. Ce qui gonfle mal
  titre(`Anomalies qui gonflent un CA`)

  const durees = new Map<number, number>()
  for (const j of joursDb) durees.set(j.duration, (durees.get(j.duration) ?? 0) + 1)
  console.log(
    `  Durées rencontrées : ${[...durees.entries()].sort((a, b) => b[1] - a[1]).map(([d, n]) => `${d} × ${n}`).join(" · ")}`
  )
  const suspectes = [...durees.keys()].filter((d) => d > 1)
  if (suspectes.length) {
    console.log(
      `  ⚠ des lignes valent PLUS d'une journée (${suspectes.join(", ")}) : si ce sont des heures,` +
        `\n    chaque ligne compte 7 à 8 fois trop dans le CA.`
    )
  }

  const taux = jours.map((j) => j.dailyRate).filter((t): t is number => typeof t === "number")
  if (taux.length) {
    const tri = [...taux].sort((a, b) => a - b)
    console.log(
      `  TJM des prestations utilisés : min ${tri[0]} € · médiane ${tri[Math.floor(tri.length / 2)]} €` +
        ` · max ${tri[tri.length - 1]} €`
    )
    // Détail des TJM aberrants : quelle prestation, quel client, combien de
    // jours, combien d'euros. Un forfait pris pour un taux journalier se voit
    // ici, et nulle part ailleurs.
    const hauts = [...new Set(tri.filter((t) => t > 2000))]
    if (hauts.length) {
      console.log(`  ⚠ TJM > 2000 € : ${hauts.join(", ")} — forfait pris pour un taux ?`)
      const parPresta = new Map<string, { tjm: number; jours: number; client: string; qui: Set<string> }>()
      for (const j of joursDb) {
        const d = toIsoDate(j.date)
        if (!d.startsWith(`${year}-`) || d > aujourdhui.realiseJusquau) continue
        const t = j.deliveryBoondId ? tjm.get(j.deliveryBoondId) : null
        if (!t || t <= 2000) continue
        const cle = String(j.deliveryBoondId)
        const cur = parPresta.get(cle) ?? {
          tjm: t,
          jours: 0,
          client: prestations.find((x) => x.boondId === cle)?.clientName ?? j.clientName ?? "?",
          qui: new Set<string>(),
        }
        cur.jours += j.duration
        cur.qui.add(j.person.name)
        parPresta.set(cle, cur)
      }
      for (const [id, v] of parPresta) {
        console.log(
          `      prestation ${id.padEnd(6)} ${String(v.tjm).padStart(6)} €/j × ${jr(v.jours)} j` +
            ` = ${eur(v.tjm * v.jours)}   ${v.client}   (${[...v.qui].join(", ")})`
        )
      }
      const gonfle = [...parPresta.values()].reduce((n, v) => n + v.tjm * v.jours, 0)
      const median = tri[Math.floor(tri.length / 2)]
      const raisonnable = [...parPresta.values()].reduce((n, v) => n + median * v.jours, 0)
      console.log(
        `      → ces prestations pèsent ${eur(gonfle)} ; au TJM médian elles vaudraient ${eur(raisonnable)}` +
          `\n        soit ${eur(gonfle - raisonnable)} d'écart à elles seules.`
      )
    }
  }

  let horsPresence = 0
  for (const j of joursDb) {
    const d = toIsoDate(j.date)
    const arr = toIsoDate(j.person.arrivalDate)
    const dep = j.person.departureDate ? toIsoDate(j.person.departureDate) : null
    if (d < arr || (dep && d > dep)) horsPresence += j.duration
  }
  console.log(
    `  Jours pointés HORS de la présence de la personne : ${jr(horsPresence)}` +
      (horsPresence > 0 ? "   ⚠ (dates d'arrivée/départ à vérifier — mobilité s7 ?)" : "")
  )

  const sansTaux = jours.filter((j) => j.dailyRate === null)
  console.log(`  Jours sans TJM de prestation (retombés sur la cascade) : ${jr(sansTaux.reduce((n, j) => n + j.duration, 0))}`)

  console.log(
    `\n  Convention SUPPRIMÉE (s9) : le total = RÉALISÉ (jours pointés jusqu'à` +
      `\n  aujourd'hui) + VENDU RESTANT (jours ouvrés d'ici la fin du mois couverts` +
      `\n  par une prestation, plafonnés par le contrat). Aucun 218/12.`
  )
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
