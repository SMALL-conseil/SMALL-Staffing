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

/** Nb de mois de [from..to] de l'année où la mission est active au moins un jour. */
function moisActifs(m: { start: string; end: string }, year: number, from: number, to: number): number {
  let count = 0
  for (let month = from; month <= to; month++) {
    const first = `${year}-${String(month).padStart(2, "0")}-01`
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
    const last = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`
    if (m.start <= last && m.end >= first) count++
  }
  return count
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
  return moisActifs(m, year, 1, maxMonth)
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

// ------------------------------------------------------------
//  CA RÉEL (a12) — jours de CRA Boond × honoraires €/jour.
//  Décision du 14/08/2026 : pour l'année affichée, les mois ÉCOULÉS sont
//  valorisés au RÉEL (Σ jours « production » du CRA × fees de la mission de
//  l'app couvrant la date), le mois courant reste à la CONVENTION 218/12
//  (CRA en cours de saisie), une année future est entièrement conventionnelle.
//  Rattachement jour → mission : mission de la personne couvrant la date ;
//  si plusieurs se chevauchent, départage par le CLIENT Boond de la ligne
//  (nom de company), sinon première mission par ordre de saisie (rank).
// ------------------------------------------------------------

/** Jour de CRA « production », prêt pour le CA réel. */
export interface ReportingJour {
  personId: string
  /** « YYYY-MM-DD ». */
  date: string
  duration: number
  /** Client Boond de la ligne (nom de company) — sert au seul départage. */
  clientName: string | null
}

export interface CaReelParClient extends CaParClient {
  /** Part réelle (mois écoulés) et conventionnelle (mois courant / futurs). */
  caReel: number
  caConvention: number
  /** Dernier mois valorisé au réel (1–12) — 0 si aucun (année future). */
  moisReelMax: number
  /** Σ durées des jours de production sans mission de l'app couvrant la date. */
  joursSansMission: number
}

const normClient = (s: string | null): string =>
  (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toLowerCase()

/**
 * CA par client mêlant réel (CRA) et convention. `missions` doit être trié
 * par rank (ordre de saisie) — le départage multi-missions en dépend.
 */
export function caParClientReel(
  missions: ReportingMission[],
  jours: ReportingJour[],
  year: number,
  today: string
): CaReelParClient {
  const currentYear = Number(today.slice(0, 4))
  const currentMonth = Number(today.slice(5, 7))
  // Mois au réel : année passée → 1..12 ; en cours → 1..(mois courant − 1) ; future → aucun.
  const moisReelMax = year < currentYear ? 12 : year === currentYear ? currentMonth - 1 : 0
  // Mois à la convention : en cours → le seul mois courant (CA « généré »,
  // arrêté au mois courant comme avant) ; future → 12 mois ; passée → aucun.
  const convFrom = year === currentYear ? currentMonth : year > currentYear ? 1 : 1
  const convTo = year === currentYear ? currentMonth : year > currentYear ? 12 : 0

  const ca = new Map<string, { ca: number; mois: number }>()
  const sans = new Map<string, Set<ReportingMission>>()
  const add = (client: string, montant: number, mois = 0) => {
    const cur = ca.get(client) ?? { ca: 0, mois: 0 }
    ca.set(client, { ca: cur.ca + montant, mois: cur.mois + mois })
  }
  const addSans = (m: ReportingMission) => {
    if (!sans.has(m.client)) sans.set(m.client, new Set())
    sans.get(m.client)!.add(m)
  }
  let caReel = 0
  let caConvention = 0
  let joursSansMission = 0

  // — Volet RÉEL : chaque jour de production × fees de sa mission —
  if (moisReelMax > 0) {
    const prefix = `${year}-`
    for (const j of jours) {
      if (!j.date.startsWith(prefix)) continue
      if (Number(j.date.slice(5, 7)) > moisReelMax) continue
      const couvrantes = missions.filter(
        (m) => m.personId === j.personId && m.start <= j.date && j.date <= m.end
      )
      if (couvrantes.length === 0) { joursSansMission += j.duration; continue }
      let mission = couvrantes[0]
      if (couvrantes.length > 1 && j.clientName) {
        const parClient = couvrantes.find((m) => normClient(m.client) === normClient(j.clientName))
        if (parClient) mission = parClient
      }
      if (mission.fees === null) { addSans(mission); continue }
      const montant = j.duration * mission.fees
      caReel += montant
      add(mission.client, montant)
    }
  }

  // — Volet CONVENTION : mois restants (fees × mois × 218/12) —
  if (convTo >= convFrom) {
    for (const m of missions) {
      const mois = moisActifs(m, year, convFrom, convTo)
      if (mois === 0) continue
      if (m.fees === null) { addSans(m); continue }
      const montant = m.fees * mois * (JOURS_FACTURES_PAR_AN / 12)
      caConvention += montant
      add(m.client, montant, mois)
    }
  }

  const entries = [...ca.entries()]
    .map(([client, v]) => ({ client, ca: v.ca, moisFactures: v.mois }))
    .sort((a, b) => b.ca - a.ca || a.client.localeCompare(b.client, "fr"))
  return {
    entries,
    total: caReel + caConvention,
    caReel,
    caConvention,
    moisReelMax,
    joursSansMission: Math.round(joursSansMission * 100) / 100,
    sansHonoraires: [...sans.entries()]
      .map(([client, set]) => ({ client, missions: set.size }))
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
