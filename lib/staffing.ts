// ============================================================
// Moteur de staffing — réplique FIDÈLE du classeur « Staffing SMALL Paris ».
// Module PUR : aucune dépendance Prisma/Next, entrées = objets simples,
// dates = chaînes ISO « YYYY-MM-DD » (jours pleins, aucune notion d'heure).
// Toute évolution DOIT passer les tests golden (tests/golden/) extraits de
// l'Excel de référence — c'est le contrat du projet.
//
// Sémantiques héritées de l'Excel (vérifiées cellule par cellule, 0 écart) :
// · Jours ouvrés = NETWORKDAYS français ; le lundi de Pentecôte est TRAVAILLÉ
//   (journée de solidarité — mai 2026 = 18 j.o., pas 17) ; Pâques et Pentecôte
//   (dimanches) figurent dans la liste sans effet.
//   L'Excel applique les fériés de l'année pilotée à TOUS les mois de ses
//   matrices ; le moteur calcule les fériés de l'année de CHAQUE mois — les
//   valeurs affichées par l'Excel (toujours celles de l'année pilotée) sont
//   identiques, les autres années sont plus justes ici.
// · Départ effectif d'un Indép = MAX(fins de ses missions) — au-delà de son
//   dernier contrat, un indépendant n'est plus staffable (règle cachée de la
//   matrice Staffable, col D). Sans mission : jamais staffable.
// · Staffés[mois] : l'Excel ne somme PAS mission par mission — il prend
//   l'étendue en jours ouvrés du min(débuts) au max(fins) des missions
//   chevauchant le mois (les « trous » entre deux missions du même mois sont
//   comptés staffés), multipliée par MAX(Σ parts au 1er du mois, Σ parts au
//   dernier jour, Σ parts des missions incluses dans le mois), plafonnée au
//   staffable. Reproduit tel quel — les golden values en dépendent.
// · Taux salariés MENSUEL : numérateur = staffés des non-Indép (Rookie inclus,
//   bizarrerie E4) ; taux salariés YTD : numérateur hors Rookie ET Indép (Q3).
//   Dénominateurs : staffable hors Rookie et Indép. Reproduits tels quels.
// · Carte de staffing : LE client du mois = 1re mission (ordre du registre)
//   chevauchant le mois, affiché seulement si staffés > 0.
// · Suivi des effectifs (têtes) : présent = arrivé au plus tard en fin de
//   mois ET (départ REGISTRE strictement après le 1er du mois, ou aucun) —
//   un Indép sans date de départ reste compté en têtes après sa dernière
//   mission (fidèle à l'Excel), même s'il n'est plus staffable.
// ============================================================

import { GRADE_INDEP, GRADE_ROOKIE } from "./types"

// ---------- Types d'entrée ----------

/** Date calendaire « YYYY-MM-DD ». */
export type IsoDate = string

export interface StaffAbsence {
  start: IsoDate
  /** null = absence ouverte (pas de retour connu). */
  end: IsoDate | null
}

export interface StaffPerson {
  id: string
  name: string
  grade: string
  arrival: IsoDate
  /** Date de départ du registre (null = présent). */
  departure: IsoDate | null
  absences: StaffAbsence[]
}

export interface StaffMission {
  personId: string
  client: string
  start: IsoDate
  end: IsoDate
  /** Part d'intervention 0–1. */
  share: number
  /** Ordre du registre (la carte affiche la 1re mission qui chevauche le mois). */
  rank: number
}

// ---------- Dates : numéros de jour UTC (aucune heure, aucun fuseau) ----------

const DAY = 86_400_000

function toDay(iso: IsoDate): number {
  const [y, m, d] = iso.split("-").map(Number)
  return Date.UTC(y, m - 1, d) / DAY
}

function toIso(day: number): IsoDate {
  return new Date(day * DAY).toISOString().slice(0, 10)
}

/** 0 = lundi … 6 = dimanche. */
function weekday(day: number): number {
  return (((day + 3) % 7) + 7) % 7 // jour 0 (1970-01-01) était un jeudi
}

function monthFirstDay(year: number, month: number): number {
  return Date.UTC(year, month - 1, 1) / DAY
}

function monthLastDay(year: number, month: number): number {
  return Date.UTC(year, month, 0) / DAY
}

// ---------- Fériés français ----------

/** Dimanche de Pâques (algorithme de Meeus, valable pour toute année grégorienne). */
export function easterSunday(year: number): IsoDate {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

const holidayCache = new Map<number, Set<number>>()

/**
 * Fériés d'une année — liste EXACTE de l'onglet Feries de l'Excel :
 * jour de l'an, Pâques, lundi de Pâques, 1er mai, 8 mai, Ascension,
 * Pentecôte, 14 juillet, Assomption, Toussaint, 11 novembre, Noël.
 * Le lundi de Pentecôte n'y est PAS (travaillé — journée de solidarité).
 */
export function frenchHolidays(year: number): Set<number> {
  const cached = holidayCache.get(year)
  if (cached) return cached
  const easter = toDay(easterSunday(year))
  const fixed: [number, number][] = [
    [1, 1], // jour de l'an
    [5, 1], // fête du travail
    [5, 8], // armistice 39/45
    [7, 14], // fête nationale
    [8, 15], // Assomption
    [11, 1], // Toussaint
    [11, 11], // armistice 14/18
    [12, 25], // Noël
  ]
  const set = new Set<number>(fixed.map(([m, d]) => Date.UTC(year, m - 1, d) / DAY))
  set.add(easter) // dimanche (sans effet sur les jours ouvrés)
  set.add(easter + 1) // lundi de Pâques
  set.add(easter + 39) // Ascension
  set.add(easter + 49) // Pentecôte (dimanche, sans effet)
  holidayCache.set(year, set)
  return set
}

/** NETWORKDAYS français : jours ouvrés de start à end INCLUS (0 si start > end). */
function workingDaysNum(start: number, end: number): number {
  if (start > end) return 0
  let n = 0
  let holidays = frenchHolidays(new Date(start * DAY).getUTCFullYear())
  let holidayYear = new Date(start * DAY).getUTCFullYear()
  for (let d = start; d <= end; d++) {
    const y = new Date(d * DAY).getUTCFullYear()
    if (y !== holidayYear) {
      holidayYear = y
      holidays = frenchHolidays(y)
    }
    if (weekday(d) < 5 && !holidays.has(d)) n++
  }
  return n
}

/** Jours ouvrés français entre deux dates ISO incluses. */
export function workingDays(start: IsoDate, end: IsoDate): number {
  return workingDaysNum(toDay(start), toDay(end))
}

/** Jours ouvrés d'un mois (month : 1–12). */
export function workingDaysInMonth(year: number, month: number): number {
  return workingDaysNum(monthFirstDay(year, month), monthLastDay(year, month))
}

// ---------- Fenêtres individuelles ----------

const FAR_FUTURE = toDay("2099-12-31")

function missionsOf(person: StaffPerson, missions: StaffMission[]): StaffMission[] {
  return missions.filter((m) => m.personId === person.id)
}

/**
 * Départ effectif : règle Indép (MAX des fins de missions ; sans mission,
 * jamais staffable), sinon date de départ du registre (null = présent).
 */
export function effectiveDeparture(person: StaffPerson, missions: StaffMission[]): number | null {
  if (person.grade === GRADE_INDEP) {
    const own = missionsOf(person, missions)
    if (own.length === 0) return toDay(person.arrival) - 1
    return Math.max(...own.map((m) => toDay(m.end)))
  }
  return person.departure ? toDay(person.departure) : null
}

/**
 * Jours staffables d'une personne sur un mois : jours ouvrés du mois ∩
 * [arrivée, départ effectif], moins les fenêtres d'absence prolongée
 * (chacune clippée au mois, comme l'Excel — sans re-clippage à la présence).
 */
export function staffableDays(
  person: StaffPerson,
  missions: StaffMission[],
  year: number,
  month: number
): number {
  const m1 = monthFirstDay(year, month)
  const eom = monthLastDay(year, month)
  const dep = effectiveDeparture(person, missions) ?? FAR_FUTURE
  const base = Math.max(workingDaysNum(Math.max(toDay(person.arrival), m1), Math.min(dep, eom)), 0)
  let absent = 0
  for (const a of person.absences) {
    const aEnd = a.end ? toDay(a.end) : FAR_FUTURE
    absent += Math.max(workingDaysNum(Math.max(toDay(a.start), m1), Math.min(aEnd, eom)), 0)
  }
  return base - absent
}

/**
 * Jours staffés d'une personne sur un mois — formule EXACTE de l'Excel :
 * étendue en jours ouvrés du min(débuts) au max(fins) des missions chevauchant
 * le mois (clippée au mois), × MAX(Σ parts au 1er, Σ parts au dernier jour,
 * Σ parts des missions incluses), plafonnée aux jours staffables.
 */
export function staffedDays(
  person: StaffPerson,
  missions: StaffMission[],
  year: number,
  month: number
): number {
  const m1 = monthFirstDay(year, month)
  const eom = monthLastDay(year, month)
  const own = missionsOf(person, missions)
  const overlap = own.filter((m) => toDay(m.start) <= eom && toDay(m.end) >= m1)
  if (overlap.length === 0) return 0
  const spanStart = Math.max(Math.min(...overlap.map((m) => toDay(m.start))), m1)
  const spanEnd = Math.min(Math.max(...overlap.map((m) => toDay(m.end))), eom)
  const span = workingDaysNum(spanStart, spanEnd)
  const shareAtStart = own
    .filter((m) => toDay(m.start) <= m1 && toDay(m.end) >= m1)
    .reduce((s, m) => s + m.share, 0)
  const shareAtEnd = own
    .filter((m) => toDay(m.start) <= eom && toDay(m.end) >= eom)
    .reduce((s, m) => s + m.share, 0)
  const shareInside = own
    .filter((m) => toDay(m.start) >= m1 && toDay(m.end) <= eom)
    .reduce((s, m) => s + m.share, 0)
  const cap = staffableDays(person, missions, year, month)
  return Math.min(cap, span * Math.max(shareAtStart, shareAtEnd, shareInside))
}

// ---------- KPIs mensuels + YTD ----------

export interface MonthlyKpis {
  year: number
  month: number
  workingDays: number
  /** Effectif « salariés » en ETP moyens (hors Rookie et Indép). */
  effectifSalaries: number
  /** Taux de staffing salariés (numérateur : staffés des non-Indép — fidèle Excel). */
  tauxSalaries: number
  /** Effectif « salariés + indép » en ETP moyens (hors Rookie). */
  effectifSalariesIndep: number
  /** Nb facturés en ETP (tous staffés / jours ouvrés). */
  factures: number
  /** Nb en intercontrat (effectif s+i − facturés). */
  intercontrat: number
  /** Taux de staffing salariés + indép. */
  tauxSalariesIndep: number
}

function isSalarie(grade: string): boolean {
  return grade !== GRADE_ROOKIE && grade !== GRADE_INDEP
}

export function monthlyKpis(
  people: StaffPerson[],
  missions: StaffMission[],
  year: number,
  month: number
): MonthlyKpis {
  const wd = workingDaysInMonth(year, month)
  let staSal = 0
  let staSalIndep = 0
  let stfAll = 0
  let stfNonIndep = 0
  for (const p of people) {
    const sta = staffableDays(p, missions, year, month)
    const stf = staffedDays(p, missions, year, month)
    if (isSalarie(p.grade)) staSal += sta
    if (p.grade !== GRADE_ROOKIE) staSalIndep += sta
    stfAll += stf
    if (p.grade !== GRADE_INDEP) stfNonIndep += stf
  }
  return {
    year,
    month,
    workingDays: wd,
    effectifSalaries: staSal / wd,
    tauxSalaries: staSal > 0 ? stfNonIndep / staSal : 0,
    effectifSalariesIndep: staSalIndep / wd,
    factures: stfAll / wd,
    intercontrat: (staSalIndep - stfAll) / wd,
    tauxSalariesIndep: staSalIndep > 0 ? stfAll / staSalIndep : 0,
  }
}

export function yearKpis(people: StaffPerson[], missions: StaffMission[], year: number): MonthlyKpis[] {
  return Array.from({ length: 12 }, (_, i) => monthlyKpis(people, missions, year, i + 1))
}

export interface YtdRates {
  /** Dernier jour du dernier mois inclus (fin du mois de `today`, bornée au 31/12). */
  cutoff: IsoDate
  /** Mois inclus (1..n) — vide si `today` précède l'année pilotée. */
  months: number[]
  /** Taux salariés YTD (numérateur ET dénominateur hors Rookie et Indép — fidèle Excel). */
  tauxSalaries: number
  /** Taux salariés + indép YTD. */
  tauxSalariesIndep: number
}

/**
 * Taux YTD « arrêtés à fin du mois courant » : mois de l'année pilotée dont le
 * 1er jour ≤ fin du mois de `today` (bornée au 31/12 de l'année pilotée).
 */
export function ytdRates(
  people: StaffPerson[],
  missions: StaffMission[],
  year: number,
  today: IsoDate
): YtdRates {
  const t = new Date(toDay(today) * DAY)
  const eomToday = Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0) / DAY
  const cutoff = Math.min(eomToday, toDay(`${year}-12-31`))
  const months: number[] = []
  for (let m = 1; m <= 12; m++) if (monthFirstDay(year, m) <= cutoff) months.push(m)
  let numSal = 0
  let denSal = 0
  let numAll = 0
  let denSalIndep = 0
  for (const m of months) {
    for (const p of people) {
      const sta = staffableDays(p, missions, year, m)
      const stf = staffedDays(p, missions, year, m)
      if (isSalarie(p.grade)) {
        denSal += sta
        numSal += stf
      }
      if (p.grade !== GRADE_ROOKIE) denSalIndep += sta
      numAll += stf
    }
  }
  return {
    cutoff: toIso(cutoff),
    months,
    tauxSalaries: denSal > 0 ? numSal / denSal : 0,
    tauxSalariesIndep: denSalIndep > 0 ? numAll / denSalIndep : 0,
  }
}

// ---------- Carte de staffing ----------

export interface CarteRow {
  personId: string
  name: string
  grade: string
  arrival: IsoDate
  departure: IsoDate | null
  /** Client affiché pour chacun des 12 mois (null = pas staffé). */
  clients: (string | null)[]
}

/**
 * Carte de staffing de l'année : une ligne par consultant non parti avant le
 * 1er janvier (départ REGISTRE — un Indép sans départ saisi reste affiché),
 * LE client du mois = 1re mission (ordre du registre) chevauchant le mois,
 * seulement si jours staffés > 0.
 */
export function carteStaffing(
  people: StaffPerson[],
  missions: StaffMission[],
  year: number
): CarteRow[] {
  const jan1 = monthFirstDay(year, 1)
  const sorted = [...missions].sort((a, b) => a.rank - b.rank)
  return people
    .filter((p) => !(p.departure && toDay(p.departure) < jan1))
    .map((p) => {
      const clients: (string | null)[] = []
      for (let m = 1; m <= 12; m++) {
        if (staffedDays(p, sorted, year, m) > 0) {
          const m1 = monthFirstDay(year, m)
          const eom = monthLastDay(year, m)
          const first = sorted.find(
            (mi) => mi.personId === p.id && toDay(mi.start) <= eom && toDay(mi.end) >= m1
          )
          clients.push(first ? first.client : null)
        } else {
          clients.push(null)
        }
      }
      return {
        personId: p.id,
        name: p.name,
        grade: p.grade,
        arrival: p.arrival,
        departure: p.departure,
        clients,
      }
    })
}

// ---------- Intercontrat à date + mouvements ----------

/** Date de disponibilité : MAX(arrivée, fins d'absences prolongées connues). */
function availabilityDay(person: StaffPerson): number {
  let d = toDay(person.arrival)
  for (const a of person.absences) {
    if (a.end) d = Math.max(d, toDay(a.end))
  }
  return d
}

/** Consultants « actifs » au sens de l'onglet IC : ni Rookie, ni Indép, sans départ. */
function icScope(people: StaffPerson[]): StaffPerson[] {
  return people.filter((p) => isSalarie(p.grade) && !p.departure)
}

function lastMissionEnd(person: StaffPerson, missions: StaffMission[]): number | null {
  const own = missionsOf(person, missions)
  return own.length ? Math.max(...own.map((m) => toDay(m.end))) : null
}

export interface IcEntry {
  personId: string
  name: string
  grade: string
  /** Disponible depuis (arrivée ou retour d'absence). */
  since: IsoDate
}

/**
 * Intercontrat à date : consultants actifs, disponibles (arrivée/retour
 * d'absence ≤ aujourd'hui), sans AUCUNE mission en cours ou à venir
 * (aucune mission dont la fin ≥ aujourd'hui).
 */
export function icAtDate(people: StaffPerson[], missions: StaffMission[], today: IsoDate): IcEntry[] {
  const t = toDay(today)
  return icScope(people)
    .filter(
      (p) =>
        availabilityDay(p) <= t &&
        !missionsOf(p, missions).some((m) => toDay(m.end) >= t)
    )
    .map((p) => ({ personId: p.id, name: p.name, grade: p.grade, since: toIso(availabilityDay(p)) }))
}

export interface MovementEntry {
  personId: string
  name: string
  grade: string
  /** SORTIE = fin de dernière mission ; ARRIVEE = arrivée/disponibilité sans mission. */
  type: "SORTIE" | "ARRIVEE"
  /** Date affichée (fin de mission, ou disponibilité si postérieure — fidèle Excel). */
  date: IsoDate
}

/**
 * Sorties de mission d'ici la fin du mois de `today` : consultants actifs dont
 * la DERNIÈRE mission se termine entre aujourd'hui et la fin du mois.
 */
export function sortiesMoisCourant(
  people: StaffPerson[],
  missions: StaffMission[],
  today: IsoDate
): MovementEntry[] {
  const t = toDay(today)
  const d = new Date(t * DAY)
  const eom = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0) / DAY
  const out: MovementEntry[] = []
  for (const p of icScope(people)) {
    const le = lastMissionEnd(p, missions)
    if (le !== null && le >= t && le <= eom) {
      out.push({
        personId: p.id,
        name: p.name,
        grade: p.grade,
        type: "SORTIE",
        date: toIso(Math.max(availabilityDay(p), le)),
      })
    }
  }
  return out
}

/**
 * Mouvements du mois PROCHAIN : sorties (dernière mission finissant le mois
 * prochain) et arrivées (consultants sans aucune mission, disponibles le mois
 * prochain).
 */
export function mouvementsMoisProchain(
  people: StaffPerson[],
  missions: StaffMission[],
  today: IsoDate
): MovementEntry[] {
  const t = new Date(toDay(today) * DAY)
  const eomCurrent = Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0) / DAY
  const eomNext = Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 2, 0) / DAY
  const out: MovementEntry[] = []
  for (const p of icScope(people)) {
    const le = lastMissionEnd(p, missions)
    if (le !== null && le > eomCurrent && le <= eomNext) {
      out.push({
        personId: p.id,
        name: p.name,
        grade: p.grade,
        type: "SORTIE",
        date: toIso(Math.max(availabilityDay(p), le)),
      })
    } else if (le === null) {
      const avail = availabilityDay(p)
      if (avail > eomCurrent && avail <= eomNext) {
        out.push({ personId: p.id, name: p.name, grade: p.grade, type: "ARRIVEE", date: toIso(avail) })
      }
    }
  }
  return out
}

// ---------- Suivi des effectifs (têtes par grade × mois) ----------

export interface HeadcountPerson {
  grade: string
  arrival: IsoDate
  departure: IsoDate | null
}

/**
 * Têtes présentes un mois donné : arrivée ≤ fin du mois ET (départ registre
 * strictement après le 1er du mois, ou aucun départ).
 */
export function headcount(people: HeadcountPerson[], grade: string, year: number, month: number): number {
  const m1 = monthFirstDay(year, month)
  const eom = monthLastDay(year, month)
  return people.filter(
    (p) =>
      p.grade === grade &&
      toDay(p.arrival) <= eom &&
      (!p.departure || toDay(p.departure) > m1)
  ).length
}
