// Validation des saisies des registres (missions, absences prolongées) —
// module PUR, testé dans tests/admin.validation.test.ts. Les routes API
// s'appuient dessus ; aucune logique de validation dans les composants.

export interface MissionValues {
  personId: string
  client: string
  startDate: Date
  endDate: Date
  share: number
  note: string | null
}

export interface AbsenceValues {
  personId: string
  startDate: Date
  endDate: Date | null
  label: string | null
}

export type Validation<T> = { ok: true; value: T } | { ok: false; error: string }

/** « YYYY-MM-DD » → Date minuit UTC (colonne @db.Date), null si invalide. */
function parseDay(v: unknown): Date | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null
  const d = new Date(`${v}T00:00:00.000Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Part d'intervention : accepte « 1 », « 0.8 », « 0,8 » — bornée à (0 ; 1]. */
export function parseShare(v: unknown): number | null {
  if (typeof v === "number") return v > 0 && v <= 1 ? v : null
  if (typeof v !== "string") return null
  const n = Number.parseFloat(v.trim().replace(",", "."))
  if (Number.isNaN(n) || n <= 0 || n > 1) return null
  return n
}

function cleanText(v: unknown, max = 120): string | null {
  if (typeof v !== "string") return null
  const s = v.trim()
  return s.length ? s.slice(0, max) : null
}

export function validateMission(raw: {
  personId?: unknown
  client?: unknown
  startDate?: unknown
  endDate?: unknown
  share?: unknown
  note?: unknown
}): Validation<MissionValues> {
  const personId = cleanText(raw.personId, 60)
  if (!personId) return { ok: false, error: "Consultant requis" }
  const client = cleanText(raw.client, 60)
  if (!client) return { ok: false, error: "Client requis" }
  const startDate = parseDay(raw.startDate)
  if (!startDate) return { ok: false, error: "Date de début invalide" }
  const endDate = parseDay(raw.endDate)
  if (!endDate) return { ok: false, error: "Date de fin invalide" }
  if (startDate.getTime() > endDate.getTime())
    return { ok: false, error: "La date de début doit précéder la date de fin" }
  const share = parseShare(raw.share ?? 1)
  if (share === null)
    return { ok: false, error: "Part d'intervention invalide (entre 0 et 1, ex. 0,8)" }
  return {
    ok: true,
    value: { personId, client, startDate, endDate, share, note: cleanText(raw.note, 300) },
  }
}

export function validateAbsence(raw: {
  personId?: unknown
  startDate?: unknown
  endDate?: unknown
  label?: unknown
}): Validation<AbsenceValues> {
  const personId = cleanText(raw.personId, 60)
  if (!personId) return { ok: false, error: "Personne requise" }
  const startDate = parseDay(raw.startDate)
  if (!startDate) return { ok: false, error: "Date de début invalide" }
  const rawEnd = typeof raw.endDate === "string" && raw.endDate.trim() === "" ? null : raw.endDate
  let endDate: Date | null = null
  if (rawEnd != null) {
    endDate = parseDay(rawEnd)
    if (!endDate) return { ok: false, error: "Date de fin invalide (laisser vide si inconnue)" }
    if (startDate.getTime() > endDate.getTime())
      return { ok: false, error: "La date de début doit précéder la date de fin" }
  }
  return { ok: true, value: { personId, startDate, endDate, label: cleanText(raw.label, 120) } }
}
