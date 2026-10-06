// ============================================================
//  Lecture des 3 registres du classeur « Staffing SMALL Paris ».
//  Module PARTAGÉ (testé dans tests/excel-registres.test.ts) :
//   · scripts/import-excel.ts  — import initial dans la base ;
//   · scripts/compare-excel.ts — comparaison classeur ↔ base (a21).
//  Parsing PUR : aucune écriture, aucune dépendance Prisma. Les règles de
//  lecture (colonnes, sérials de dates, validations) vivent ICI et nulle
//  part ailleurs — deux lecteurs divergents feraient mentir la comparaison.
// ============================================================
import { readFileSync } from "fs"
import * as XLSX from "xlsx"
import { CONSULTANT_GRADES, SIEGE_GRADES } from "./types"
import type { StaffMission, StaffPerson } from "./staffing"

/** Consultants retirés du registre de l'app — correction assumée du 11/08/2026
 *  (cf. CLAUDE.md) : au registre Consultant de l'Excel alors que le rôle a
 *  toujours été siège, ils faussaient le taux. */
export const CONSULTANTS_EXCLUS = ["Elvire HOUDEVILLE"]

/**
 * CHANGEMENTS DE NOM — « nom au classeur » → « nom dans l'app » (a42).
 * Le registre de l'app reçoit le nom d'usage par la synchro Boond ; le
 * classeur, saisi à la main, garde parfois l'ancien. Sans ce rapprochement la
 * même personne compte DEUX FOIS dans une comparaison : +22 j staffables d'un
 * côté, −22 j de l'autre, et l'écart semble venir de nulle part.
 * Rapprochement confirmé à la main par Sacha, jamais deviné : deux noms ne se
 * confondent pas parce qu'ils se ressemblent.
 */
export const ALIAS_CLASSEUR: Record<string, string> = {
  "Thessa LOPES": "Thessa Franco", // confirmé le 06/10/2026
}

/** Clé de rapprochement d'un nom, alias du classeur résolus. */
export function cleNom(nom: string): string {
  const direct = normNom(nom)
  for (const [ancien, actuel] of Object.entries(ALIAS_CLASSEUR)) {
    if (normNom(ancien) === direct) return normNom(actuel)
  }
  return direct
}

/** Nom tel que l'app le porte (le classeur peut être en retard). */
export function nomCanonique(nom: string): string {
  for (const [ancien, actuel] of Object.entries(ALIAS_CLASSEUR)) {
    if (normNom(ancien) === normNom(nom)) return actuel
  }
  return nom
}

/** Les KPI que le classeur CALCULE lui-même, lus dans l'onglet « Staffing »
 *  (une colonne par mois). Ce sont les cellules que Sacha lit à l'écran : les
 *  confronter au moteur distingue un écart de FORMULE (a40) d'un écart de
 *  DONNÉES (a21/a41). */
export interface KpiClasseur {
  mois: number
  joursOuvres: number | null
  effectifSalaries: number | null
  tauxSalaries: number | null
  effectifAvecIndep: number | null
  factures: number | null
  intercontrat: number | null
  tauxAvecIndep: number | null
}

/**
 * Lit les cellules calculées de l'onglet « Staffing » pour une année.
 * Les colonnes sont repérées par la DATE portée en en-tête (1er du mois) et
 * les lignes par leur rang, tel que le classeur les empile depuis l'origine :
 * 1 jours ouvrés, 2 effectif salariés, 3 taux salariés, 4 effectif + indép,
 * 5 facturés, 6 intercontrat, 7 taux + indép.
 * Lecture seule, et tolérante : une cellule non numérique revient à `null`
 * plutôt que de faire échouer la lecture (le classeur vit, ses mois futurs
 * sont parfois vides).
 */
export function readKpiStaffing(path: string, year: number): KpiClasseur[] {
  const wb = XLSX.read(readFileSync(path), { type: "buffer", cellDates: true })
  const ws = wb.Sheets["Staffing"]
  if (!ws) throw new Error(`onglet « Staffing » introuvable dans ${path}`)
  const lignes = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true })
  const colonnes = new Map<number, number>()
  for (const [i, v] of (lignes[0] ?? []).entries()) {
    if (v instanceof Date && v.getFullYear() === year) colonnes.set(v.getMonth() + 1, i)
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

export interface ConsultantRow {
  name: string
  email: string | null
  grade: string
  arrival: Date
  departure: Date | null
  absenceStart: Date | null
  absenceEnd: Date | null
  manager: string | null
}

export interface SiegeRow {
  name: string
  grade: string
  arrival: Date
  departure: Date | null
}

export interface MissionRow {
  consultant: string
  client: string
  start: Date
  end: Date
  share: number
  /** Ordre de saisie dans l'onglet — fait foi pour la carte de staffing. */
  rank: number
}

export interface Registres {
  consultants: ConsultantRow[]
  siege: SiegeRow[]
  missions: MissionRow[]
}

/** Sérial Excel (base 30/12/1899) → Date UTC minuit, null si vide/0. */
export function serialToDate(v: unknown): Date | null {
  if (v == null || v === "" || v === 0) return null
  if (v instanceof Date) return new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate()))
  if (typeof v !== "number") throw new Error(`date attendue, reçu : ${JSON.stringify(v)}`)
  return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86_400_000)
}

export function asName(v: unknown): string | null {
  if (typeof v !== "string") return null
  const s = v.trim()
  return s.length ? s : null
}

/** Date UTC → « YYYY-MM-DD ». */
export const toIso = (d: Date): string => d.toISOString().slice(0, 10)

/** Clé de rapprochement des noms (casse, accents et espaces indifférents) —
 *  la synchro Boond réécrit la casse (« Marc KOLTA » → « Marc Kolta »). */
export function normNom(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
}

/** Lit les 3 registres du classeur. Les lignes invalides LÈVENT (le classeur
 *  est la source de vérité : mieux vaut s'arrêter que deviner). */
export function readRegistres(path: string): Registres {
  const wb = XLSX.read(readFileSync(path), { type: "buffer", cellDates: false })
  const sheet = (name: string) => {
    const ws = wb.Sheets[name]
    if (!ws) throw new Error(`onglet « ${name} » introuvable dans ${path}`)
    // header:1 = lignes brutes ; raw:true = sérials numériques pour les dates
    return XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true })
  }

  const consultants: ConsultantRow[] = []
  for (const row of sheet("Consultant").slice(1)) {
    const name = asName(row[0])
    if (!name) continue
    const grade = asName(row[2])
    if (!grade || !(CONSULTANT_GRADES as readonly string[]).includes(grade))
      throw new Error(`grade consultant inconnu pour ${name} : « ${grade} »`)
    const arrival = serialToDate(row[3])
    if (!arrival) throw new Error(`date d'arrivée manquante pour ${name}`)
    consultants.push({
      name,
      email: asName(row[1]),
      grade,
      arrival,
      departure: serialToDate(row[4]),
      absenceStart: serialToDate(row[5]),
      absenceEnd: serialToDate(row[6]),
      manager: asName(row[7]),
    })
  }

  const siege: SiegeRow[] = []
  for (const row of sheet("Siège").slice(1)) {
    const name = asName(row[0])
    if (!name) continue
    const grade = asName(row[1])
    if (!grade) throw new Error(`grade siège manquant pour ${name}`)
    if (!(SIEGE_GRADES as readonly string[]).includes(grade))
      // fidèle à l'Excel : un grade siège hors liste (ex. « DG SMALL Bordeaux »)
      // est lu tel quel et n'apparaît dans aucune ligne du suivi des effectifs
      console.warn(`  ⚠ grade siège hors suivi des effectifs pour ${name} : « ${grade} » (lu tel quel)`)
    const arrival = serialToDate(row[2])
    if (!arrival) throw new Error(`date d'arrivée manquante pour ${name}`)
    siege.push({ name, grade, arrival, departure: serialToDate(row[3]) })
  }

  const missions: MissionRow[] = []
  for (const row of sheet("Mission_Consultant").slice(1)) {
    const consultant = asName(row[0])
    if (!consultant) continue
    const client = asName(row[2])
    const start = serialToDate(row[3])
    const end = serialToDate(row[4])
    const share = typeof row[5] === "number" ? row[5] : NaN
    if (!client || !start || !end) throw new Error(`mission incomplète pour ${consultant}`)
    if (Number.isNaN(share) || share <= 0 || share > 1)
      throw new Error(`part d'intervention invalide pour ${consultant} (${row[5]})`)
    if (start.getTime() > end.getTime())
      throw new Error(`mission de ${consultant} chez ${client} : début après fin`)
    missions.push({ consultant, client, start, end, share, rank: missions.length })
  }

  return { consultants, siege, missions }
}

/**
 * Registres → entrées du moteur (lib/staffing.ts). L'identifiant d'une
 * personne est son nom normalisé : c'est aussi la clé de rapprochement avec
 * la base lors de la comparaison.
 * `exclure` applique la correction assumée (Elvire) ; l'omettre donne le
 * classeur TEL QUEL — c'est ce qu'affiche l'Excel.
 */
export function toEngineInputs(
  reg: Registres,
  opts: { exclure?: string[] } = {}
): { people: StaffPerson[]; missions: StaffMission[] } {
  const exclus = new Set((opts.exclure ?? []).map(normNom))
  const people: StaffPerson[] = reg.consultants
    .filter((c) => !exclus.has(normNom(c.name)))
    .map((c) => ({
      // Alias résolus (a42) : le classeur peut porter l'ancien nom — c'est la
      // MÊME personne, elle ne doit pas compter deux fois.
      id: cleNom(c.name),
      name: nomCanonique(c.name),
      grade: c.grade,
      arrival: toIso(c.arrival),
      departure: c.departure ? toIso(c.departure) : null,
      absences: c.absenceStart
        ? [{ start: toIso(c.absenceStart), end: c.absenceEnd ? toIso(c.absenceEnd) : null }]
        : [],
    }))
  const connus = new Set(people.map((p) => p.id))
  const missions: StaffMission[] = reg.missions
    .filter((m) => connus.has(cleNom(m.consultant)))
    .map((m) => ({
      personId: cleNom(m.consultant),
      client: m.client,
      start: toIso(m.start),
      end: toIso(m.end),
      share: m.share,
      rank: m.rank,
    }))
  return { people, missions }
}
