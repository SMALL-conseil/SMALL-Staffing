// ============================================================
//  Export Excel des TJM effectifs — a19, enrichi a20.
//      npx tsx scripts/export-tjm.ts
//  (lanceur double-clic : claude-bridge/exporter-tjm.ps1)
//  Produit exports/TJM_Boond_<AAAA-MM-JJ>.xlsx (3 feuilles) :
//   · « TJM fiche Boond » — consultants À DATE dont la fiche Boond porte
//     un TJM : mission(s) en cours, honoraires saisis, TJM EFFECTIF
//     appliqué par le CA (cascade honoraires mission → TJM fiche) et sa
//     source, jours CRA réalisés depuis le début de la mission ;
//   · « Sans TJM fiche » — consultants à date dont la fiche est vide
//     (à compléter dans Boond ou au registre) ;
//   · « Missions passées » — HISTORIQUE complet des missions terminées
//     (consultants partis inclus), avec TJM effectif, jours CRA de la
//     fenêtre et CA réel estimé (jours × TJM effectif).
//  NB : les jours CRA d'une mission = jours « production » du consultant
//  dans la fenêtre de LA mission (deux missions chevauchantes du même
//  consultant compteraient les mêmes jours — cas rare, listing indicatif).
//  Montants en NOMBRES formatés € (filtrables, sommables). Lecture seule.
// ============================================================
import "dotenv/config"
import fs from "fs"
import path from "path"
import * as XLSX from "xlsx"
import { prisma } from "../lib/prisma"
import { toIsoDate } from "../lib/staffing-load"
import { todayParis } from "../lib/staffing-ui"
import { PersonKind } from "../lib/types"

const fr = (iso: string | null): string => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "")

type Ligne = (string | number | null)[]

interface SpecFeuille {
  entetes: string[]
  largeurs: number[]
  colsEuros: number[]
  colPct: number | null
}

const SPEC_A_DATE: SpecFeuille = {
  entetes: [
    "Consultant", "Grade", "Statut à date", "TJM fiche Boond (€/j)",
    "Client (mission en cours)", "Début mission", "Fin mission", "Part",
    "Honoraires mission (€/j)", "TJM effectif à date (€/j)", "Source du TJM effectif",
    "Jours CRA (prod.)", "CA réel à date (€)",
  ],
  largeurs: [26, 9, 18, 18, 24, 12, 12, 6, 20, 20, 20, 14, 16],
  colsEuros: [3, 8, 9, 12],
  colPct: 7,
}

const SPEC_PASSEES: SpecFeuille = {
  entetes: [
    "Consultant", "Grade", "Client", "Début mission", "Fin mission", "Part",
    "Honoraires mission (€/j)", "TJM fiche Boond (€/j)", "TJM effectif (€/j)",
    "Source du TJM effectif", "Jours CRA (prod.)", "CA réel (€)",
  ],
  largeurs: [26, 9, 24, 12, 12, 6, 20, 18, 18, 20, 14, 16],
  colsEuros: [6, 7, 8, 11],
  colPct: 5,
}

function feuille(spec: SpecFeuille, lignes: Ligne[]): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet([spec.entetes, ...lignes])
  ws["!cols"] = spec.largeurs.map((wch) => ({ wch }))
  for (let r = 1; r <= lignes.length; r++) {
    for (const c of spec.colsEuros) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })]
      if (cell && cell.t === "n") cell.z = '#,##0" €"'
    }
    if (spec.colPct !== null) {
      const part = ws[XLSX.utils.encode_cell({ r, c: spec.colPct })]
      if (part && part.t === "n") part.z = "0%"
    }
  }
  const fin = XLSX.utils.encode_cell({ r: lignes.length, c: spec.entetes.length - 1 })
  ws["!autofilter"] = { ref: `A1:${fin}` }
  return ws
}

const sourceDe = (fees: number | null, fiche: number | null): string =>
  fees != null ? "Honoraires mission" : fiche != null ? "Fiche Boond" : "AUCUN (hors CA)"

async function main() {
  const today = todayParis()
  const persons = await prisma.person.findMany({
    where: { kind: PersonKind.CONSULTANT },
    include: { missions: { orderBy: { rank: "asc" } } },
    orderBy: { name: "asc" },
  })
  // Jours de production (synchro CRA) — sommés par mission via sa fenêtre.
  const cra = await prisma.timeEntry.findMany({
    where: { activityType: "production" },
    select: { personId: true, date: true, duration: true },
  })
  const parPersonne = new Map<string, { date: string; duration: number }[]>()
  for (const j of cra) {
    const list = parPersonne.get(j.personId) ?? []
    list.push({ date: toIsoDate(j.date), duration: j.duration })
    parPersonne.set(j.personId, list)
  }
  const joursSur = (personId: string, de: string, a: string): number => {
    let n = 0
    for (const j of parPersonne.get(personId) ?? []) if (j.date >= de && j.date <= a) n += j.duration
    return Math.round(n * 100) / 100
  }

  const avec: Ligne[] = []
  const sans: Ligne[] = []
  const passees: Ligne[] = []
  const triPassees: { fin: string; ligne: Ligne }[] = []

  for (const p of persons) {
    const depart = p.departureDate ? toIsoDate(p.departureDate) : null
    const arrivee = toIsoDate(p.arrivalDate)
    const fiche = p.defaultDailyRate
    const parti = depart !== null && depart < today

    // — Historique : toutes les missions TERMINÉES (partis inclus) —
    for (const m of p.missions) {
      const debut = toIsoDate(m.startDate)
      const fin = toIsoDate(m.endDate)
      if (fin >= today) continue
      const effectif = m.fees ?? fiche
      const jours = joursSur(p.id, debut, fin)
      triPassees.push({
        fin,
        ligne: [
          p.name, p.grade, m.client, fr(debut), fr(fin), m.share,
          m.fees, fiche, effectif, sourceDe(m.fees, fiche),
          jours, effectif != null ? Math.round(jours * effectif) : null,
        ],
      })
    }

    if (parti) continue // feuilles « à date » : présents et arrivées futures

    // — À date : mission(s) en cours —
    const enCours = p.missions.filter((m) => toIsoDate(m.startDate) <= today && today <= toIsoDate(m.endDate))
    const statut =
      arrivee > today ? `Arrivée le ${fr(arrivee)}` : enCours.length ? "En mission" : "Intercontrat"

    const lignes: Ligne[] = enCours.length
      ? enCours.map((m) => {
          const effectif = m.fees ?? fiche
          const jours = joursSur(p.id, toIsoDate(m.startDate), today)
          return [
            p.name, p.grade, statut, fiche,
            m.client, fr(toIsoDate(m.startDate)), fr(toIsoDate(m.endDate)), m.share,
            m.fees, effectif, sourceDe(m.fees, fiche),
            jours, effectif != null ? Math.round(jours * effectif) : null,
          ]
        })
      : [[p.name, p.grade, statut, fiche, null, null, null, null, null, fiche, sourceDe(null, fiche), null, null]]

    ;(fiche !== null ? avec : sans).push(...lignes)
  }

  triPassees.sort((x, y) => (x.fin < y.fin ? 1 : -1))
  for (const t of triPassees) passees.push(t.ligne)

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, feuille(SPEC_A_DATE, avec), "TJM fiche Boond")
  XLSX.utils.book_append_sheet(wb, feuille(SPEC_A_DATE, sans), "Sans TJM fiche")
  XLSX.utils.book_append_sheet(wb, feuille(SPEC_PASSEES, passees), "Missions passées")

  const dossier = path.join(process.cwd(), "exports")
  fs.mkdirSync(dossier, { recursive: true })
  const fichier = path.join(dossier, `TJM_Boond_${today}.xlsx`)
  XLSX.writeFile(wb, fichier)

  console.log(
    `✔ ${avec.length} ligne(s) avec TJM fiche · ${sans.length} sans · ${passees.length} mission(s) passée(s)`
  )
  console.log(`→ ${fichier}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
