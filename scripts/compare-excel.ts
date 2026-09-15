// ============================================================
//  COMPARATEUR classeur Excel ↔ base de l'app — a21.
//      npx tsx scripts/compare-excel.ts "<chemin du xlsx>" [AAAA-MM]
//  (mois par défaut : le mois courant)
//
//  Pourquoi : le moteur est une réplique CERTIFIÉE de l'Excel (golden tests,
//  0 écart). Un écart de taux ne vient donc jamais du calcul, mais des
//  DONNÉES : depuis l'import initial, le classeur a continué à vivre (missions
//  saisies à la main) pendant que la base suivait sa propre trajectoire
//  (synchro Boond, saisies dans l'app).
//  Ce script rejoue le MÊME moteur sur les deux jeux de données, chiffre
//  l'écart, l'attribue consultant par consultant, puis liste les différences
//  de registre — c'est la liste des corrections à faire pour recoller.
//  Lecture seule : rien n'est écrit, ni dans le classeur, ni en base.
// ============================================================
import "dotenv/config"
import { statSync } from "fs"
import { prisma } from "../lib/prisma"
import { loadStaffingData } from "../lib/staffing-load"
import { monthlyKpis, staffableDays, staffedDays, workingDaysInMonth } from "../lib/staffing"
import type { StaffMission, StaffPerson } from "../lib/staffing"
import { GRADE_INDEP, GRADE_ROOKIE } from "../lib/types"
import { CONSULTANTS_EXCLUS, normNom, readRegistres, toEngineInputs, toIso } from "../lib/excel-registres"
import { MOIS_LONGS, todayParis } from "../lib/staffing-ui"

const pct = (x: number) => `${(x * 100).toFixed(2).replace(".", ",")} %`
const pts = (x: number) => `${x >= 0 ? "+" : "−"}${(Math.abs(x) * 100).toFixed(2).replace(".", ",")} pt`
const jr = (x: number) => x.toFixed(2).replace(".", ",")
const fr = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "—")

interface Cote {
  people: StaffPerson[]
  missions: StaffMission[]
}

/** Agrégats du taux mensuel « salariés » (dénominateur hors Rookie + Indép,
 *  numérateur = staffés des non-Indép — la bizarrerie fidèle de l'Excel). */
function agregats(c: Cote, year: number, month: number) {
  let sta = 0
  let stf = 0
  const parPersonne = new Map<string, { nom: string; grade: string; sta: number; stf: number }>()
  for (const p of c.people) {
    const s = staffableDays(p, c.missions, year, month)
    const f = staffedDays(p, c.missions, year, month)
    const compteSta = p.grade !== GRADE_ROOKIE && p.grade !== GRADE_INDEP
    const compteStf = p.grade !== GRADE_INDEP
    if (compteSta) sta += s
    if (compteStf) stf += f
    if (s > 0 || f > 0) parPersonne.set(normNom(p.name), { nom: p.name, grade: p.grade, sta: compteSta ? s : 0, stf: compteStf ? f : 0 })
  }
  return { sta, stf, taux: sta > 0 ? stf / sta : 0, parPersonne }
}

function titre(n: string) {
  console.log(`\n${"═".repeat(72)}\n${n}\n${"═".repeat(72)}`)
}

async function main() {
  const args = process.argv.slice(2)
  const path = args.find((a) => !a.startsWith("--"))
  if (!path) {
    console.error('Usage : npx tsx scripts/compare-excel.ts "<chemin du xlsx>" [AAAA-MM]')
    process.exit(1)
  }
  const moisArg = args.find((a) => /^\d{4}-\d{2}$/.test(a))
  const today = todayParis()
  const year = Number((moisArg ?? today).slice(0, 4))
  const month = Number((moisArg ?? today).slice(5, 7))

  // --- Les deux côtés, même moteur -----------------------------------------
  const reg = readRegistres(path)
  const excel: Cote = toEngineInputs(reg) // TEL QUEL (Elvire incluse) = ce qu'affiche l'Excel
  const db = await loadStaffingData()
  const app: Cote = { people: db.people, missions: db.missions }

  const aE = agregats(excel, year, month)
  const aA = agregats(app, year, month)
  const kE = monthlyKpis(excel.people, excel.missions, year, month)
  const kA = monthlyKpis(app.people, app.missions, year, month)

  titre(`COMPARAISON Excel ↔ app — ${MOIS_LONGS[month - 1]} ${year}`)
  console.log(`Classeur : ${path}`)
  console.log(`           modifié le ${statSync(path).mtime.toLocaleString("fr-FR")}`)
  console.log(`Registres : Excel ${reg.consultants.length} consultants / ${reg.missions.length} missions`)
  console.log(`            app   ${app.people.length} consultants / ${app.missions.length} missions`)

  titre("1. LE TAUX (salariés, hors indépendants)")
  const w = 30
  console.log(`${"".padEnd(w)}${"Excel".padStart(12)}${"app".padStart(12)}${"écart".padStart(14)}`)
  console.log(
    `${"Taux de staffing".padEnd(w)}${pct(kE.tauxSalaries).padStart(12)}${pct(kA.tauxSalaries).padStart(12)}${pts(kA.tauxSalaries - kE.tauxSalaries).padStart(14)}`
  )
  const ecartJ = (d: number) => `${d >= 0 ? "+" : "−"}${jr(Math.abs(d))} j`.padStart(14)
  console.log(
    `${"Staffable salariés (j)".padEnd(w)}${jr(aE.sta).padStart(12)}${jr(aA.sta).padStart(12)}${ecartJ(aA.sta - aE.sta)}`
  )
  console.log(
    `${"Staffés non-Indép (j)".padEnd(w)}${jr(aE.stf).padStart(12)}${jr(aA.stf).padStart(12)}${ecartJ(aA.stf - aE.stf)}`
  )
  console.log(`${"Jours ouvrés du mois".padEnd(w)}${String(workingDaysInMonth(year, month)).padStart(12)}`)

  // --- 2. Attribution de l'écart, consultant par consultant -----------------
  titre("2. D'OÙ VIENT L'ÉCART — par consultant")
  const noms = new Set([...aE.parPersonne.keys(), ...aA.parPersonne.keys()])
  const vide = { nom: "", grade: "", sta: 0, stf: 0 }
  const lignes = [...noms]
    .map((cle) => {
      const e = aE.parPersonne.get(cle) ?? vide
      const a = aA.parPersonne.get(cle) ?? vide
      const dSta = a.sta - e.sta
      const dStf = a.stf - e.stf
      // Taux de l'app SI ce consultant était aligné sur l'Excel — l'attribution
      // honnête : un taux est un rapport, l'effet d'une ligne n'est pas additif.
      const tauxAligne = aA.sta - dSta > 0 ? (aA.stf - dStf) / (aA.sta - dSta) : 0
      return {
        nom: a.nom || e.nom,
        grade: a.grade || e.grade,
        cote: CONSULTANTS_EXCLUS.some((x) => normNom(x) === cle)
          ? "Excel seul — correction assumée"
          : !aE.parPersonne.has(cle)
            ? "app seule"
            : !aA.parPersonne.has(cle)
              ? "Excel seul"
              : "",
        eSta: e.sta, aSta: a.sta, eStf: e.stf, aStf: a.stf,
        dSta, dStf,
        effet: tauxAligne - kA.tauxSalaries,
      }
    })
    .filter((l) => Math.abs(l.dSta) > 0.001 || Math.abs(l.dStf) > 0.001)
    .sort((x, y) => Math.abs(y.effet) - Math.abs(x.effet))

  if (!lignes.length) {
    console.log("  Aucun écart par consultant : les deux registres donnent le même mois.")
  } else {
    console.log(
      `${"Consultant".padEnd(26)}${"Grade".padEnd(8)}${"staffable E→app".padStart(18)}${"staffés E→app".padStart(18)}${"si aligné".padStart(12)}`
    )
    for (const l of lignes) {
      const sta = `${jr(l.eSta)} → ${jr(l.aSta)}`
      const stf = `${jr(l.eStf)} → ${jr(l.aStf)}`
      console.log(
        `${l.nom.slice(0, 25).padEnd(26)}${l.grade.padEnd(8)}${sta.padStart(18)}${stf.padStart(18)}${pct(kA.tauxSalaries + l.effet).padStart(12)}  ${l.cote}`
      )
    }
    console.log(
      `\n  « si aligné » = le taux de l'app si CE consultant seul était remis à l'identique de l'Excel\n` +
        `  (le taux est un rapport : les effets ne s'additionnent pas ligne à ligne).`
    )
  }

  // --- 3. Registre des consultants -----------------------------------------
  titre("3. REGISTRE DES CONSULTANTS")
  const parNomE = new Map(excel.people.map((p) => [normNom(p.name), p]))
  const parNomA = new Map(app.people.map((p) => [normNom(p.name), p]))
  const seulApp = [...parNomA.values()].filter((p) => !parNomE.has(normNom(p.name)))
  const seulExcel = [...parNomE.values()].filter((p) => !parNomA.has(normNom(p.name)))
  console.log(`  Seulement dans l'app (${seulApp.length}) — arrivés par la synchro Boond ou saisis dans l'app :`)
  for (const p of seulApp) console.log(`    ${p.name} · ${p.grade} · arrivée ${fr(p.arrival)} · départ ${fr(p.departure)}`)
  const exclus = new Set(CONSULTANTS_EXCLUS.map(normNom))
  console.log(`  Seulement dans l'Excel (${seulExcel.length}) :`)
  for (const p of seulExcel)
    console.log(
      `    ${p.name} · ${p.grade} · arrivée ${fr(p.arrival)} · départ ${fr(p.departure)}` +
        (exclus.has(normNom(p.name)) ? "   ← CORRECTION ASSUMÉE (cf. CLAUDE.md), écart normal" : "")
    )

  const diffs: string[] = []
  for (const [cle, e] of parNomE) {
    const a = parNomA.get(cle)
    if (!a) continue
    const d: string[] = []
    if (a.grade !== e.grade) d.push(`grade ${e.grade} → ${a.grade}`)
    if (a.arrival !== e.arrival) d.push(`arrivée ${fr(e.arrival)} → ${fr(a.arrival)}`)
    if ((a.departure ?? null) !== (e.departure ?? null)) d.push(`départ ${fr(e.departure)} → ${fr(a.departure)}`)
    const absE = e.absences.map((x) => `${fr(x.start)}→${fr(x.end)}`).join(" ; ")
    const absA = a.absences.map((x) => `${fr(x.start)}→${fr(x.end)}`).join(" ; ")
    if (absE !== absA) d.push(`absences « ${absE || "aucune"} » → « ${absA || "aucune"} »`)
    if (d.length) diffs.push(`    ${e.name} : ${d.join(" · ")}`)
  }
  console.log(`  Différences Excel → app (${diffs.length}) :`)
  for (const d of diffs) console.log(d)

  // --- 4. Missions ----------------------------------------------------------
  titre(`4. MISSIONS CHEVAUCHANT ${MOIS_LONGS[month - 1].toUpperCase()} ${year}`)
  const debutMois = `${year}-${String(month).padStart(2, "0")}-01`
  const finMois = toIso(new Date(Date.UTC(year, month, 0)))
  const chevauche = (m: StaffMission) => m.start <= finMois && m.end >= debutMois
  const cleM = (m: StaffMission, nom: string) => `${nom}|${normNom(m.client)}|${m.start}|${m.end}|${m.share}`
  const nomDe = (c: Cote, id: string) => c.people.find((p) => p.id === id)?.name ?? id

  const mE = new Map<string, { m: StaffMission; nom: string }>()
  for (const m of excel.missions.filter(chevauche)) {
    const nom = normNom(nomDe(excel, m.personId))
    mE.set(cleM(m, nom), { m, nom: nomDe(excel, m.personId) })
  }
  const mA = new Map<string, { m: StaffMission; nom: string }>()
  for (const m of app.missions.filter(chevauche)) {
    const nom = normNom(nomDe(app, m.personId))
    mA.set(cleM(m, nom), { m, nom: nomDe(app, m.personId) })
  }
  const ligneM = (x: { m: StaffMission; nom: string }) =>
    `    ${x.nom} · ${x.m.client} · ${fr(x.m.start)} → ${fr(x.m.end)} · part ${x.m.share}`
  const seulesExcel = [...mE.entries()].filter(([k]) => !mA.has(k)).map(([, v]) => v)
  const seulesApp = [...mA.entries()].filter(([k]) => !mE.has(k)).map(([, v]) => v)
  console.log(`  Dans l'Excel, PAS dans l'app (${seulesExcel.length}) — à saisir/prolonger au registre :`)
  for (const x of seulesExcel) console.log(ligneM(x))
  console.log(`  Dans l'app, PAS dans l'Excel (${seulesApp.length}) :`)
  for (const x of seulesApp) console.log(ligneM(x))
  console.log(
    `  (« pas dans l'app » inclut les missions dont les DATES ou la PART diffèrent —\n` +
      `   elles apparaissent alors des deux côtés, avec leurs valeurs respectives.)`
  )

  titre("EN RÉSUMÉ")
  console.log(
    `  Excel ${pct(kE.tauxSalaries)} · app ${pct(kA.tauxSalaries)} · écart ${pts(kA.tauxSalaries - kE.tauxSalaries)}\n` +
      `  Corriger les lignes de la section 4 (et 3) dans le registre de l'app aligne les deux.`
  )
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
