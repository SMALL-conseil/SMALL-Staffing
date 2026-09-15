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
      id: normNom(c.name),
      name: c.name,
      grade: c.grade,
      arrival: toIso(c.arrival),
      departure: c.departure ? toIso(c.departure) : null,
      absences: c.absenceStart
        ? [{ start: toIso(c.absenceStart), end: c.absenceEnd ? toIso(c.absenceEnd) : null }]
        : [],
    }))
  const connus = new Set(people.map((p) => p.id))
  const missions: StaffMission[] = reg.missions
    .filter((m) => connus.has(normNom(m.consultant)))
    .map((m) => ({
      personId: normNom(m.consultant),
      client: m.client,
      start: toIso(m.start),
      end: toIso(m.end),
      share: m.share,
      rank: m.rank,
    }))
  return { people, missions }
}
