// ============================================================
//  Reporting par client — module PUR (testé dans tests/reporting.test.ts).
//  Réservé au rôle SIEGE (les honoraires transitent ici).
//
//  · Consultants par client : personnes distinctes en mission AUJOURD'HUI.
//  · CA par client : Boond ne fournissant pas la facturation en v1, la
//    convention retenue (décision équipe du 11/08/2026) est :
//        CA(mission, année) = honoraires (€/JOUR) × nb de mois de mission
//                             sur l'année × 218/12
//    (218 jours facturés par an ; les honoraires saisis sont un TAUX
//    JOURNALIER ; part d'intervention volontairement NON pondérée — affiché
//    comme hypothèse sur la page). Année en cours : mois arrêtés au mois
//    courant (CA « généré ») ; année future : prévisionnel sur 12 mois.
//    Les missions sans honoraires renseignés sont EXCLUES et comptées.
// ============================================================

export const JOURS_FACTURES_PAR_AN = 218

export interface ReportingMission {
  personId: string
  client: string
  /** « YYYY-MM-DD ». */
  start: string
  end: string
  /** Honoraires journaliers (€/jour) — null = non renseignés. */
  fees: number | null
}

export interface ClientConsultants {
  client: string
  consultants: number
}

/** Personnes distinctes en mission aujourd'hui, par client (tri décroissant). */
export function consultantsParClient(
  missions: ReportingMission[],
  today: string
): ClientConsultants[] {
  const parClient = new Map<string, Set<string>>()
  for (const m of missions) {
    if (m.start <= today && today <= m.end) {
      if (!parClient.has(m.client)) parClient.set(m.client, new Set())
      parClient.get(m.client)!.add(m.personId)
    }
  }
  return [...parClient.entries()]
    .map(([client, set]) => ({ client, consultants: set.size }))
    .sort((a, b) => b.consultants - a.consultants || a.client.localeCompare(b.client, "fr"))
}

export interface ClientCa {
  client: string
  ca: number
  moisFactures: number
}

export interface CaParClient {
  entries: ClientCa[]
  total: number
  /** Missions chevauchant la fenêtre SANS honoraires renseignés, par client. */
  sansHonoraires: { client: string; missions: number }[]
}

/**
 * Nb de mois calendaires de l'année où la mission est active au moins un jour,
 * borné au mois courant si l'année affichée est l'année en cours.
 */
export function moisDeMission(
  m: { start: string; end: string },
  year: number,
  today: string
): number {
  const currentYear = Number(today.slice(0, 4))
  const currentMonth = Number(today.slice(5, 7))
  const maxMonth = year < currentYear ? 12 : year === currentYear ? currentMonth : 12
  let count = 0
  for (let month = 1; month <= maxMonth; month++) {
    const first = `${year}-${String(month).padStart(2, "0")}-01`
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
    const last = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`
    if (m.start <= last && m.end >= first) count++
  }
  return count
}

export function caParClient(missions: ReportingMission[], year: number, today: string): CaParClient {
  const ca = new Map<string, { ca: number; mois: number }>()
  const sans = new Map<string, number>()
  for (const m of missions) {
    const mois = moisDeMission(m, year, today)
    if (mois === 0) continue
    if (m.fees === null) {
      sans.set(m.client, (sans.get(m.client) ?? 0) + 1)
      continue
    }
    const montant = m.fees * mois * (JOURS_FACTURES_PAR_AN / 12)
    const cur = ca.get(m.client) ?? { ca: 0, mois: 0 }
    ca.set(m.client, { ca: cur.ca + montant, mois: cur.mois + mois })
  }
  const entries = [...ca.entries()]
    .map(([client, v]) => ({ client, ca: v.ca, moisFactures: v.mois }))
    .sort((a, b) => b.ca - a.ca || a.client.localeCompare(b.client, "fr"))
  return {
    entries,
    total: entries.reduce((n, e) => n + e.ca, 0),
    sansHonoraires: [...sans.entries()]
      .map(([client, missions]) => ({ client, missions }))
      .sort((a, b) => b.missions - a.missions),
  }
}

export interface DonutSlice {
  label: string
  value: number
}

/** Replie les petites parts au-delà de `max` en « Autres » (lisibilité du donut). */
export function replierAutres(slices: DonutSlice[], max = 8): DonutSlice[] {
  if (slices.length <= max) return slices
  let autres = 0
  for (const s of slices.slice(max)) autres += s.value
  return [...slices.slice(0, max), { label: "Autres", value: autres }]
}
