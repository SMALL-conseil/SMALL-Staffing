// ============================================================
//  Client BoondManager + extraction des ressources (personnes).
//  Aligné sur l'implémentation éprouvée de l'app Formation (JWT HS256 signé
//  maison, /resources paginé, garde-fous) — MAIS avec les inversions propres
//  au staffing :
//   · le « Titre » Boond est conservé BRUT comme grade (SM 2, M 1… — jamais
//     aplati, contrairement à Formation) ;
//   · les dates d'arrivée / de départ sont extraites (elles pilotent le
//     moteur de staffing) ;
//   · l'état Boond (1 = à venir, 2 = IC, 3 = en mission) est conservé pour
//     le croisement de contrôle.
//  Les champs exacts du tenant se figent au premier appel réel via
//  `npx tsx scripts/boond-inspect.ts` puis les variables BOOND_* (.env).
// ============================================================
import crypto from "crypto"

const BASE = process.env.BOOND_BASE_URL || "https://ui.boondmanager.com/api"
const JWT_HEADER = process.env.BOOND_JWT_HEADER || "X-Jwt-Client-BoondManager"
// Relation Boond du « Responsable manager » (même valeur que Formation).
const MANAGER_REL = process.env.BOOND_MANAGER_REL || "mainManager"
// Champ portant le « Titre » ; vide = chaîne de candidats (à figer via inspect).
const TITLE_FIELD = process.env.BOOND_TITLE_FIELD || ""
// Champs portant les dates d'arrivée / de départ ; vides = chaînes de candidats.
const ARRIVAL_FIELD = process.env.BOOND_ARRIVAL_FIELD || ""
const DEPARTURE_FIELD = process.env.BOOND_DEPARTURE_FIELD || ""
// Codes d'état ACTIFS (ex. "1,2,3"). Vide = heuristique permissive (tout sauf 0/inactive).
const ACTIVE_STATES = (process.env.BOOND_ACTIVE_STATES || "")
  .split(",").map((s) => s.trim()).filter(Boolean)
// Codes typeOf à EXCLURE totalement de la synchro (vide = personne).
const EXCLUDED_TYPEOF = (process.env.BOOND_EXCLUDED_TYPEOF || "")
  .split(",").map((s) => s.trim()).filter(Boolean)
// Codes typeOf des INDÉPENDANTS : synchronisés en consultant de grade « Indép ».
const INDEP_TYPEOF = (process.env.BOOND_INDEP_TYPEOF || "")
  .split(",").map((s) => s.trim()).filter(Boolean)
// Domaine privilégié pour choisir l'email parmi email1/2/3.
const PREFERRED_EMAIL_DOMAIN = (process.env.BOOND_PREFERRED_EMAIL_DOMAIN ?? "small-conseil.com")
  .trim().toLowerCase()

// --- JWT client HS256 (sans dépendance — identique Formation) ---
function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

export function buildJwt(): string {
  const userToken = process.env.BOOND_USER_TOKEN
  const clientToken = process.env.BOOND_CLIENT_TOKEN
  const clientKey = process.env.BOOND_CLIENT_KEY
  if (!userToken || !clientToken || !clientKey) {
    throw new Error("Secrets Boond manquants (BOOND_USER_TOKEN / BOOND_CLIENT_TOKEN / BOOND_CLIENT_KEY)")
  }
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))
  const payload = b64url(
    JSON.stringify({ userToken, clientToken, time: Math.floor(Date.now() / 1000), mode: "normal" })
  )
  const sig = b64url(crypto.createHmac("sha256", clientKey).update(`${header}.${payload}`).digest())
  return `${header}.${payload}.${sig}`
}

export type BoondResource = {
  id: string
  attributes?: Record<string, unknown>
  relationships?: Record<string, { data?: { id?: string | number } }>
}

export async function fetchResources(): Promise<{ resources: BoondResource[]; pages: number }> {
  const headers = { [JWT_HEADER]: buildJwt(), Accept: "application/json" }
  const out: BoondResource[] = []
  let page = 1
  while (page <= 100) {
    const url = `${BASE}/resources?page=${page}&maxResults=100&maxPerPage=100`
    const res = await fetch(url, { headers, cache: "no-store" })
    if (!res.ok) throw new Error(`Boond /resources HTTP ${res.status}`)
    const payload = await res.json()
    const data: BoondResource[] = payload.data ?? []
    out.push(...data)
    const total = payload?.meta?.totals?.rows
    if (!data.length || (typeof total === "number" && out.length >= total)) break
    page++
  }
  return { resources: out, pages: page }
}

// ------------------------------------------------------------
// Extraction — fonctions PURES (testées dans tests/boond-pure.test.ts)
// ------------------------------------------------------------

export function normText(s?: string | null): string {
  if (!s) return ""
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toLowerCase()
}

export function pickEmail(a: Record<string, unknown>): string | null {
  const candidates = ["email1", "email2", "email3"]
    .map((k) => String((a[k] as string) || "").trim().toLowerCase())
    .filter(Boolean)
  if (PREFERRED_EMAIL_DOMAIN) {
    const corporate = candidates.find((e) => e.endsWith(`@${PREFERRED_EMAIL_DOMAIN}`))
    if (corporate) return corporate
  }
  return candidates[0] ?? null
}

export function pickTitle(a: Record<string, unknown>): string | null {
  if (TITLE_FIELD) return a[TITLE_FIELD] ? String(a[TITLE_FIELD]).trim() : null
  for (const k of ["title", "function", "fonction", "jobTitle"]) {
    if (a[k]) return String(a[k]).trim()
  }
  return null
}

// Alias de titres relevés sur le tenant (inspect du 13/08/2026) : variantes
// Boond → grades de l'app, pour que le Suivi_Effectif reste fidèle à l'Excel.
// Toute variante NON listée reste BRUTE (et signalée « hors grilles »).
const TITLE_ALIASES: Record<string, string> = {
  "co-fondateur": "Fondateur",
  "co-fondatrice": "Fondateur",
  "fondateur": "Fondateur",
  "fondatrice": "Fondateur",
  "chargee de mission aupres de la direction": "Chargée de missions transverses",
  "chargee de missions transverses": "Chargée de missions transverses",
}

/**
 * Normalise un titre Boond vers le grade de l'app :
 * · un titre contenant « indépendant(e) » ou « freelance » → grade « Indép »
 *   (la sémantique Indép du moteur en dépend — ex. « Consultant Indépendant ») ;
 * · les variantes siège connues sont réalignées (Co-fondateur → Fondateur…) ;
 * · tout le reste passe BRUT (échelons fins inchangés : « SM 2 », « M 1 »…).
 */
export function normalizeTitle(title: string): string {
  if (/ind[ée]pendant|freelance/i.test(title)) return "Indép"
  return TITLE_ALIASES[normText(title)] ?? title
}

/** Normalise une valeur de date Boond (« 2026-01-12 », ISO long…) en « YYYY-MM-DD ». */
export function normDate(v: unknown): string | null {
  if (v == null || v === "" || v === 0) return null
  const s = String(v).trim()
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/)
  return m ? m[1] : null
}

function pickDate(a: Record<string, unknown>, forced: string, candidates: string[]): string | null {
  if (forced) return normDate(a[forced])
  for (const k of candidates) {
    const d = normDate(a[k])
    if (d) return d
  }
  return null
}

export function pickArrival(a: Record<string, unknown>): string | null {
  return pickDate(a, ARRIVAL_FIELD, ["startDate", "entryDate", "dateOfEntry", "hiringDate", "arrivalDate"])
}

export function pickDeparture(a: Record<string, unknown>): string | null {
  return pickDate(a, DEPARTURE_FIELD, ["endDate", "exitDate", "dateOfExit", "departureDate", "releaseDate"])
}

export function isActiveState(a: Record<string, unknown>): boolean {
  const state = a.state
  if (ACTIVE_STATES.length) return ACTIVE_STATES.includes(String(state))
  if (state === undefined || state === null) return true
  const s = String(state).toLowerCase()
  return !["0", "inactive", "inactif", "disabled", "false"].includes(s)
}

export function isExcludedType(a: Record<string, unknown>): boolean {
  return EXCLUDED_TYPEOF.length > 0 && EXCLUDED_TYPEOF.includes(String(a.typeOf))
}

export function isIndepType(a: Record<string, unknown>): boolean {
  return INDEP_TYPEOF.length > 0 && INDEP_TYPEOF.includes(String(a.typeOf))
}

/** Personne normalisée extraite d'une ressource Boond. */
export interface BoondPerson {
  boondId: string
  name: string
  email: string | null
  /** Titre BRUT (deviendra le grade tel quel) — « Indép » si typeOf indépendant. */
  title: string | null
  state: string | null
  typeOf: string | null
  arrival: string | null
  departure: string | null
  managerBoondId: string | null
  excluded: boolean
  activeState: boolean
}

export function extractPerson(r: BoondResource): BoondPerson {
  const a = r.attributes ?? {}
  const first = String((a.firstName as string) || "").trim()
  const last = String((a.lastName as string) || "").trim()
  const mgr = r.relationships?.[MANAGER_REL]?.data?.id
  const rawTitle = pickTitle(a)
  return {
    boondId: String(r.id),
    name: `${first} ${last}`.trim(),
    email: pickEmail(a),
    title: isIndepType(a) ? "Indép" : rawTitle ? normalizeTitle(rawTitle) : null,
    state: a.state === undefined || a.state === null ? null : String(a.state),
    typeOf: a.typeOf === undefined || a.typeOf === null ? null : String(a.typeOf),
    arrival: pickArrival(a),
    departure: pickDeparture(a),
    managerBoondId: mgr === undefined || mgr === null ? null : String(mgr),
    excluded: isExcludedType(a),
    activeState: isActiveState(a),
  }
}
