// ============================================================
//  LE CLASSEUR EST-IL COHÉRENT AVEC LUI-MÊME ? (a40)
//      npx tsx scripts/verifier-classeur.ts "<chemin du xlsx>" [AAAA]
//
//  Le moteur de l'app est une réplique CERTIFIÉE du classeur (golden tests,
//  0 écart sur 6 221 cellules). On peut donc s'en servir comme CONTRÔLE du
//  classeur : rejouer le moteur sur les REGISTRES du fichier (Consultant,
//  Siège, Mission_Consultant) et confronter le résultat aux cellules calculées
//  de l'onglet « Staffing ». Tout écart ne peut venir que d'une formule du
//  classeur — les données étant, par construction, les mêmes des deux côtés.
//
//  Ce que ça a déjà trouvé (06/10/2026, octobre) : le DERNIER consultant de la
//  liste n'est JAMAIS compté comme staffé. Les formules de l'onglet « Staffés »
//  construisent leur plage par
//      INDIRECT("Staffable!$A$2:$A$" & COUNTA(ANCHORARRAY(Staffable!$A$2)))
//  où COUNTA compte les noms SANS l'en-tête (51) alors que la plage démarre
//  en ligne 2 : elle s'arrête donc en ligne 51 et laisse dehors la ligne 52.
//  Le dénominateur, lui, compte depuis $A$1 (en-tête compris) et inclut bien
//  cette dernière ligne. Résultat : la personne du bas pèse dans l'effectif
//  mais jamais dans les facturés — le taux est sous-évalué, silencieusement,
//  et la victime change à chaque nouvelle arrivée.
//
//  Lecture seule : le classeur n'est jamais modifié.
// ============================================================
import "dotenv/config"
import { readFileSync, readdirSync, statSync } from "fs"
import { join } from "path"
import * as XLSX from "xlsx"
import { readRegistres, toEngineInputs, toIso } from "../lib/excel-registres"
import { monthlyKpis, staffableDays, staffedDays } from "../lib/staffing"
import { MOIS_LONGS, todayParis } from "../lib/staffing-ui"
import { GRADE_INDEP } from "../lib/types"

const pct = (x: number) => `${(x * 100).toFixed(2).replace(".", ",")} %`
const jr = (x: number) => x.toFixed(4).replace(".", ",").replace(/,0000$/, "")

class ErreurUtilisateur extends Error {}

/** Accepte un fichier .xlsx ou un dossier (le classeur le plus récent y est pris). */
function resoudreClasseur(chemin: string): string {
  let st
  try {
    st = statSync(chemin)
  } catch {
    throw new ErreurUtilisateur(`Chemin introuvable : ${chemin}`)
  }
  if (st.isFile()) return chemin
  const candidats = readdirSync(chemin)
    .filter((f) => /\.xlsx$/i.test(f) && !f.startsWith("~$"))
    .map((f) => ({ f, t: statSync(join(chemin, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t)
  if (!candidats.length) throw new ErreurUtilisateur(`Aucun .xlsx dans le dossier ${chemin}`)
  return join(chemin, candidats[0].f)
}

/** Les KPI calculés PAR LE CLASSEUR, lus dans l'onglet « Staffing ». */
interface KpiClasseur {
  mois: number
  joursOuvres: number | null
  effectifSalaries: number | null
  tauxSalaries: number | null
  effectifAvecIndep: number | null
  factures: number | null
  intercontrat: number | null
  tauxAvecIndep: number | null
}

function lireKpiClasseur(path: string, year: number): KpiClasseur[] {
  const wb = XLSX.read(readFileSync(path), { type: "buffer", cellDates: true })
  const ws = wb.Sheets["Staffing"]
  if (!ws) throw new ErreurUtilisateur(`onglet « Staffing » introuvable dans ${path}`)
  const lignes = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true })
  const entete = lignes[0] ?? []
  // Colonnes des mois : l'en-tête porte le 1er de chaque mois de l'année visée.
  const colonnes = new Map<number, number>()
  entete.forEach((v, i) => {
    const d = v instanceof Date ? v : null
    if (d && d.getFullYear() === year) colonnes.set(d.getMonth() + 1, i)
  })
  if (!colonnes.size) {
    throw new ErreurUtilisateur(
      `Aucune colonne de ${year} dans l'onglet « Staffing » (le classeur couvre une autre année ?)`
    )
  }
  const nombre = (ligne: number, col: number): number | null => {
    const v = (lignes[ligne] ?? [])[col]
    return typeof v === "number" ? v : null
  }
  return [...colonnes.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([mois, col]) => ({
      mois,
      joursOuvres: nombre(1, col),
      effectifSalaries: nombre(2, col),
      tauxSalaries: nombre(3, col),
      effectifAvecIndep: nombre(4, col),
      factures: nombre(5, col),
      intercontrat: nombre(6, col),
      tauxAvecIndep: nombre(7, col),
    }))
}

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"))
  if (!args.length) {
    throw new ErreurUtilisateur(
      `Usage : npx tsx scripts/verifier-classeur.ts "<chemin du xlsx ou du dossier>" [AAAA]`
    )
  }
  const chemin = resoudreClasseur(args[0])
  const year = Number(args.find((a) => /^\d{4}$/.test(a)) ?? todayParis().slice(0, 4))

  const reg = readRegistres(chemin)
  const { people, missions } = toEngineInputs(reg)
  console.log(`Classeur : ${chemin}`)
  console.log(
    `Registres : ${reg.consultants.length} consultants · ${reg.missions.length} missions · ${reg.siege.length} siège\n`
  )

  const duClasseur = lireKpiClasseur(chemin, year)
  let ecarts = 0

  // Le moteur sur une ligne ; quand le classeur dit autre chose, une seconde
  // ligne juste en dessous — les colonnes restent alignées, l'écart saute aux yeux.
  const COLS: [string, number][] = [
    ["effectif sal.", 15], ["taux salariés", 15],
    ["effectif +ind", 15], ["facturés", 12], ["taux +indép", 14],
  ]
  console.log(
    `${"Mois".padEnd(11)}${"j.o.".padStart(5)}` + COLS.map(([t, n]) => t.padStart(n)).join("")
  )
  const proche = (a: number | null, b: number, tol = 0.0001) => a !== null && Math.abs(a - b) < tol
  for (const k of duClasseur) {
    const m = monthlyKpis(people, missions, year, k.mois)
    const paires: [number, number | null, (x: number) => string][] = [
      [m.effectifSalaries, k.effectifSalaries, jr],
      [m.tauxSalaries, k.tauxSalaries, pct],
      [m.effectifSalariesIndep, k.effectifAvecIndep, jr],
      [m.factures, k.factures, jr],
      [m.tauxSalariesIndep, k.tauxAvecIndep, pct],
    ]
    const divergent = paires.map(([v, r]) => !proche(r, v))
    ecarts += divergent.filter(Boolean).length
    console.log(
      `${MOIS_LONGS[k.mois - 1].padEnd(11)}${String(m.workingDays).padStart(5)}` +
        paires.map(([v, , f], i) => f(v).padStart(COLS[i][1])).join("")
    )
    if (divergent.some(Boolean)) {
      console.log(
        `${"  → classeur".padEnd(16)}` +
          paires
            .map(([, r, f], i) => (divergent[i] ? (r === null ? "—" : f(r)) : "·").padStart(COLS[i][1]))
            .join("") +
          "   ⚠"
      )
    }
  }

  if (!ecarts) {
    console.log(`\n✔ Aucun écart : le classeur est cohérent avec lui-même sur ${year}.`)
    return
  }

  console.log(
    `\n⚠ ${ecarts} écart(s) entre les REGISTRES du classeur et ses propres cellules calculées.` +
      `\n  Les données étant les mêmes des deux côtés, l'écart vient d'une FORMULE du classeur.\n`
  )

  // --- Le piège connu : la dernière ligne de la liste ------------------------
  const dernier = reg.consultants[reg.consultants.length - 1]
  if (dernier) {
    console.log(
      `Piège connu — la DERNIÈRE ligne du registre (${dernier.name}) :` +
        `\n  les formules de l'onglet « Staffés » bornent leur plage à` +
        `\n  COUNTA(ANCHORARRAY(Staffable!$A$2)), qui compte les noms SANS l'en-tête,` +
        `\n  alors que la plage démarre en ligne 2 — la dernière ligne tombe dehors.` +
        `\n  Elle pèse donc dans l'EFFECTIF mais jamais dans les FACTURÉS.\n`
    )
    const p = people.find((x) => x.name === dernier.name)
    if (p) {
      for (const k of duClasseur) {
        const s = staffableDays(p, missions, year, k.mois)
        const f = staffedDays(p, missions, year, k.mois)
        if (s === 0 && f === 0) continue
        console.log(
          `  ${MOIS_LONGS[k.mois - 1].padEnd(11)} staffable ${jr(s).padStart(6)} j · ` +
            `staffé (moteur) ${jr(f).padStart(6)} j` +
            `${f > 0 ? `   → ${jr(f / (k.joursOuvres ?? 1))} ETP que le classeur ne compte pas` : ""}` +
            `${p.grade === GRADE_INDEP ? "   [Indép : n'affecte que la ligne « + Indép »]" : "   [SALARIÉ : affecte AUSSI le taux hors indépendants]"}`
        )
      }
      console.log(
        `\n  Arrivée ${toIso(dernier.arrival)}${dernier.departure ? ` · départ ${toIso(dernier.departure)}` : ""}` +
          ` · grade ${dernier.grade}`
      )
    }
  }
  console.log(
    `\nCorrection dans le classeur : remplacer COUNTA(ANCHORARRAY(Staffable!$A$2))` +
      `\npar COUNTA(ANCHORARRAY(Staffable!$A$2))+1 dans les formules de « Staffés »` +
      `\n(ou borner les plages sur $A$1, comme le font déjà les lignes d'agrégat).`
  )
}

main().catch((e) => {
  if (e instanceof ErreurUtilisateur) {
    console.error(`\n${e.message}\n`)
    process.exit(1)
  }
  console.error(e)
  process.exit(1)
})
