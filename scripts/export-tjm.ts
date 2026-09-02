// ============================================================
//  Export Excel des TJM effectifs À DATE — a19.
//      npx tsx scripts/export-tjm.ts
//  Produit exports/TJM_Boond_<AAAA-MM-JJ>.xlsx (2 feuilles) :
//   · « TJM fiche Boond » — les consultants dont la fiche Boond porte un
//     TJM (synchro quotidienne), avec leur(s) mission(s) EN COURS à date,
//     les honoraires éventuellement saisis sur la mission, et le TJM
//     EFFECTIF appliqué par le CA (cascade : honoraires mission, sinon
//     TJM fiche) avec sa source ;
//   · « Sans TJM fiche » — les consultants dont la fiche Boond est vide
//     (les trous à combler : soit compléter Boond, soit saisir les
//     honoraires au registre).
//  Périmètre : consultants non partis à date (les arrivées futures sont
//  gardées et signalées). Montants en NOMBRES (formats €) — filtrables et
//  sommables dans Excel. Lecture seule.
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

const ENTETES = [
  "Consultant",
  "Grade",
  "Statut à date",
  "TJM fiche Boond (€/j)",
  "Client (mission en cours)",
  "Début mission",
  "Fin mission",
  "Part",
  "Honoraires mission (€/j)",
  "TJM effectif à date (€/j)",
  "Source du TJM effectif",
]
// Index des colonnes numériques à formater en euros.
const COLS_EUROS = [3, 8, 9]
const LARGEURS = [26, 9, 18, 18, 24, 12, 12, 6, 20, 20, 20]

function feuille(lignes: Ligne[]): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet([ENTETES, ...lignes])
  ws["!cols"] = LARGEURS.map((wch) => ({ wch }))
  for (let r = 1; r <= lignes.length; r++) {
    for (const c of COLS_EUROS) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })]
      if (cell && cell.t === "n") cell.z = '#,##0" €"'
    }
    const part = ws[XLSX.utils.encode_cell({ r, c: 7 })]
    if (part && part.t === "n") part.z = "0%"
  }
  ws["!autofilter"] = { ref: `A1:K${lignes.length + 1}` }
  return ws
}

async function main() {
  const today = todayParis()
  const persons = await prisma.person.findMany({
    where: { kind: PersonKind.CONSULTANT, active: true },
    include: { missions: { orderBy: { rank: "asc" } } },
    orderBy: { name: "asc" },
  })

  const avec: Ligne[] = []
  const sans: Ligne[] = []
  for (const p of persons) {
    const depart = p.departureDate ? toIsoDate(p.departureDate) : null
    if (depart && depart < today) continue // partis : hors périmètre « à date »
    const arrivee = toIsoDate(p.arrivalDate)
    const fiche = p.defaultDailyRate

    const enCours = p.missions.filter((m) => toIsoDate(m.startDate) <= today && today <= toIsoDate(m.endDate))
    const statut =
      arrivee > today ? `Arrivée le ${fr(arrivee)}` : enCours.length ? "En mission" : "Intercontrat"

    const lignes: Ligne[] = enCours.length
      ? enCours.map((m) => {
          const effectif = m.fees ?? fiche
          return [
            p.name, p.grade, statut, fiche,
            m.client, fr(toIsoDate(m.startDate)), fr(toIsoDate(m.endDate)), m.share,
            m.fees, effectif,
            effectif === null ? "AUCUN (hors CA)" : m.fees != null ? "Honoraires mission" : "Fiche Boond",
          ]
        })
      : [[p.name, p.grade, statut, fiche, null, null, null, null, null, fiche, fiche === null ? "AUCUN (hors CA)" : "Fiche Boond"]]

    ;(fiche !== null ? avec : sans).push(...lignes)
  }

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, feuille(avec), "TJM fiche Boond")
  XLSX.utils.book_append_sheet(wb, feuille(sans), "Sans TJM fiche")

  const dossier = path.join(process.cwd(), "exports")
  fs.mkdirSync(dossier, { recursive: true })
  const fichier = path.join(dossier, `TJM_Boond_${today}.xlsx`)
  XLSX.writeFile(wb, fichier)

  console.log(`✔ ${avec.length} ligne(s) avec TJM fiche · ${sans.length} sans (feuille 2)`)
  console.log(`→ ${fichier}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
