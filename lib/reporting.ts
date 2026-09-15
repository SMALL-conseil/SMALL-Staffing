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
//  · Cascade des taux (a17) : honoraires de la MISSION s'ils sont saisis,
//    sinon TJM par défaut de la FICHE Boond du titulaire (defaultDailyRate,
//    synchro quotidienne). Les missions sans AUCUN taux sont EXCLUES et
//    comptées (« sans honoraires »).
//  · PRIORITÉ ABSOLUE (s6) : quand le jour de CRA porte le TJM VENDU de sa
//    PRESTATION Boond, c'est lui qui vaut — il vient du contrat, pas d'une
//    saisie ni d'un rapprochement. La cascade ci-dessus devient le repli.
// ============================================================
import { workingDays } from "./staffing"

export const JOURS_FACTURES_PAR_AN = 218

export interface ReportingMission {
  personId: string
  client: string
  /** « YYYY-MM-DD ». */
  start: string
  end: string
  /** Honoraires journaliers (€/jour) — null = non renseignés. */
  fees: number | null
  /** TJM par défaut de la FICHE Boond du titulaire (a17) — repli de la
   *  cascade quand fees est null. Optionnel (absent = pas de repli). */
  defaultRate?: number | null
}

/** Cascade des taux (a17) : honoraires de la mission, sinon TJM fiche Boond. */
export function tauxJournalier(m: ReportingMission): number | null {
  return m.fees ?? m.defaultRate ?? null
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
    const taux = tauxJournalier(m)
    if (taux === null) {
      sans.set(m.client, (sans.get(m.client) ?? 0) + 1)
      continue
    }
    const montant = taux * mois * (JOURS_FACTURES_PAR_AN / 12)
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
//  Décision du 14/08/2026 : mois écoulés au RÉEL, mois courant à la CONVENTION
//  218/12 (CRA en cours de saisie).
//  ⚠️ RÉVISÉ LE 15/09 (s9), demande de Sacha : « le réalisé + le vendu restant
//  sur le mois ». La convention DISPARAÎT.
//   · RÉALISÉ = tous les jours pointés jusqu'à AUJOURD'HUI inclus — le mois en
//     cours compte donc pour ce qui est déjà saisi, au jour le jour ;
//   · VENDU RESTANT = les jours ouvrés d'ici la fin du mois couverts par une
//     PRESTATION Boond, à son TJM vendu, moins ce qui y est déjà pointé,
//     plafonné par le contrat (jours vendus − jours consommés) et diminué des
//     absences prolongées connues.
//  Plus aucun 218/12 : les deux nombres sont de la donnée (le CRA d'un côté,
//  le contrat de l'autre). Limite assumée : les congés ordinaires à venir dans
//  le mois ne sont pas connus — le plafond du contrat les absorbe en partie.
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
  /** Client Boond de la ligne (nom de company) — départage, et rattachement
   *  des jours qu'aucune mission de l'app ne couvre (s6). */
  clientName: string | null
  /** TJM VENDU de la prestation Boond du jour (s6) — quand il est là, c'est
   *  LUI qui fait foi : plus besoin de deviner la mission ni son taux. */
  dailyRate?: number | null
  /** Prestation Boond du jour (s9) — sert à décompter ce qui reste VENDU. */
  deliveryBoondId?: string | null
}

/**
 * Une prestation Boond en cours — le CARNET DE COMMANDES (s9).
 * Elle remplace la convention 218/12 : ce qui n'est pas encore pointé sur le
 * mois n'est plus estimé par une règle de trois, il est lu dans ce qui a été
 * VENDU (jours ouvrés restants de la fenêtre, plafonnés par le contrat).
 */
export interface PrestationEnCours {
  boondId: string
  /** Fiche de l'app qui exécute la prestation (chaîne de mobilité résolue). */
  personId: string
  /** Client tel que Boond le nomme — utilisé si aucune mission ne couvre. */
  client: string | null
  start: string
  end: string
  /** TJM vendu — sans lui, la prestation ne compte pas. */
  dailyRate: number | null
  /** Jours vendus au contrat — plafonne le reste à réaliser. */
  daysSold: number | null
}

/** Absence prolongée connue — retirée du reste à réaliser (s9). */
export interface ReportingAbsence {
  personId: string
  start: string
  end: string | null
}

export interface CaReelParClient extends CaParClient {
  /** RÉALISÉ : jours de CRA effectivement pointés, jusqu'à aujourd'hui inclus. */
  caReel: number
  /** VENDU RESTANT sur le mois en cours (s9) — jours ouvrés d'ici la fin du
   *  mois couverts par une prestation, plafonnés par le contrat. Remplace la
   *  convention 218/12 : de la donnée vendue, pas une règle de trois. */
  caVenduRestant: number
  /** Jours ouvrés encore à réaliser ce mois (Σ). */
  joursVenduRestant: number
  /** Dernier jour valorisé au réel (« YYYY-MM-DD »). */
  realiseJusquau: string
  /** Dernier mois touché par le réel (1–12) — 0 si aucun (année future). */
  moisReelMax: number
  /** Σ durées des jours de production sans mission de l'app couvrant la date
   *  ET sans prestation Boond connue — les seuls qui restent hors du CA. */
  joursSansMission: number
  /** Σ durées valorisées au TJM de leur PRESTATION Boond (s6). */
  joursAuTjmPrestation: number
  /** Σ durées valorisées par la cascade (honoraires mission, TJM fiche). */
  joursALaCascade: number
}

/** Dernier jour du mois, en ISO. */
function finDuMois(year: number, month: number): string {
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10)
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
  today: string,
  prestations: PrestationEnCours[] = [],
  absences: ReportingAbsence[] = []
): CaReelParClient {
  const currentYear = Number(today.slice(0, 4))
  const currentMonth = Number(today.slice(5, 7))
  // Le réalisé va jusqu'à AUJOURD'HUI (année en cours) ou au 31/12 (année
  // passée) ; une année future n'a rien de réalisé.
  const realiseJusquau =
    year < currentYear ? `${year}-12-31` : year === currentYear ? today : `${year}-01-01`
  const moisReelMax = year < currentYear ? 12 : year === currentYear ? currentMonth : 0

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
  let caVenduRestant = 0
  let joursVenduRestant = 0
  let joursSansMission = 0
  let joursAuTjmPrestation = 0
  let joursALaCascade = 0

  // — Volet RÉEL : chaque jour de production à SON taux —
  //   1. le TJM VENDU de la prestation Boond du jour (s6) : exact, il n'exige
  //      ni mission au registre ni rapprochement par dates ;
  //   2. à défaut, la cascade historique (honoraires de la mission couvrante,
  //      sinon TJM de la fiche) — a12/a17.
  //   Le libellé du client reste celui de la MISSION quand elle existe (les
  //   couleurs de marque et les logos y sont adossés) ; sinon celui de Boond,
  //   ce qui fait enfin compter les jours sans mission au registre.
  if (year <= currentYear) {
    const prefix = `${year}-`
    for (const j of jours) {
      if (!j.date.startsWith(prefix)) continue
      if (j.date > realiseJusquau) continue // jamais un jour postérieur à aujourd'hui

      const couvrantes = missions.filter(
        (m) => m.personId === j.personId && m.start <= j.date && j.date <= m.end
      )
      let mission: ReportingMission | null = couvrantes[0] ?? null
      if (couvrantes.length > 1 && j.clientName) {
        const parClient = couvrantes.find((m) => normClient(m.client) === normClient(j.clientName))
        if (parClient) mission = parClient
      }

      const tjmPrestation = j.dailyRate ?? null
      const taux = tjmPrestation ?? (mission ? tauxJournalier(mission) : null)
      if (taux === null) {
        // Aucun taux : si une mission couvre le jour, c'est elle qu'il faut
        // compléter ; sinon le jour est simplement orphelin.
        if (mission) addSans(mission)
        else joursSansMission += j.duration
        continue
      }
      if (tjmPrestation !== null) joursAuTjmPrestation += j.duration
      else joursALaCascade += j.duration

      const client = mission?.client ?? j.clientName
      if (!client) { joursSansMission += j.duration; continue }
      const montant = j.duration * taux
      caReel += montant
      add(client, montant)
    }
  }

  // — Volet VENDU RESTANT : d'aujourd'hui à la fin du mois en cours (s9) —
  //   Ce qui n'est pas encore pointé n'est plus ESTIMÉ : il est lu dans les
  //   prestations vendues. Rien pour une année passée (le mois est clos), rien
  //   pour une année future (aucune prestation n'y court encore).
  if (year === currentYear && prestations.length) {
    const finDeMois = finDuMois(year, currentMonth)
    // Jours déjà pointés par prestation : sur la fenêtre restante (à retirer du
    // reste à faire) et au total (pour le plafond du contrat).
    const pointesFenetre = new Map<string, number>()
    const pointesTotal = new Map<string, number>()
    for (const j of jours) {
      if (!j.deliveryBoondId) continue
      pointesTotal.set(j.deliveryBoondId, (pointesTotal.get(j.deliveryBoondId) ?? 0) + j.duration)
      if (j.date >= today && j.date <= finDeMois) {
        pointesFenetre.set(
          j.deliveryBoondId,
          (pointesFenetre.get(j.deliveryBoondId) ?? 0) + j.duration
        )
      }
    }

    for (const p of prestations) {
      if (p.dailyRate === null || p.dailyRate <= 0) continue
      const debut = p.start > today ? p.start : today
      const fin = p.end < finDeMois ? p.end : finDeMois
      if (debut > fin) continue

      let ouvres = workingDays(debut, fin)
      // Une absence prolongée connue n'est pas du temps vendable.
      for (const a of absences) {
        if (a.personId !== p.personId) continue
        const d = a.start > debut ? a.start : debut
        const f = (a.end ?? "9999-12-31") < fin ? (a.end as string) : fin
        if (d <= f) ouvres -= workingDays(d, f)
      }
      ouvres -= pointesFenetre.get(p.boondId) ?? 0
      if (p.daysSold !== null) {
        const resteContrat = p.daysSold - (pointesTotal.get(p.boondId) ?? 0)
        if (resteContrat < ouvres) ouvres = resteContrat
      }
      if (ouvres <= 0) continue

      // Libellé : celui de la MISSION qui couvre encore la personne (couleurs
      // de marque adossées), sinon celui de Boond.
      const mission =
        missions.find((m) => m.personId === p.personId && m.start <= fin && debut <= m.end) ?? null
      const client = mission?.client ?? p.client
      if (!client) continue

      const montant = ouvres * p.dailyRate
      caVenduRestant += montant
      joursVenduRestant += ouvres
      add(client, montant)
    }
  }

  const entries = [...ca.entries()]
    .map(([client, v]) => ({ client, ca: v.ca, moisFactures: v.mois }))
    .sort((a, b) => b.ca - a.ca || a.client.localeCompare(b.client, "fr"))
  return {
    entries,
    total: caReel + caVenduRestant,
    caReel,
    caVenduRestant,
    joursVenduRestant: Math.round(joursVenduRestant * 100) / 100,
    realiseJusquau,
    moisReelMax,
    joursSansMission: Math.round(joursSansMission * 100) / 100,
    joursAuTjmPrestation: Math.round(joursAuTjmPrestation * 100) / 100,
    joursALaCascade: Math.round(joursALaCascade * 100) / 100,
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
