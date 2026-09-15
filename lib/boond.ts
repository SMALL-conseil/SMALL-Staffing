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
// Relations pouvant porter la VILLE de rattachement (Paris / Bordeaux) — s5,
// élargi a25. On en lit PLUSIEURS, dans l'ordre : la première qui donne une
// ville reconnue gagne. Deux raisons :
//   · l'app Formation lit `pole` (relevé du 27/08, `mapPoleToSite`) tandis que
//     le staffing lisait `agency` — les deux outils doivent s'allumer sur la
//     même donnée le jour où elle existera ;
//   · relevé du 15/09 côté staffing : `agency` vaut « SMALL » pour les 65
//     ressources (aucune ville) et `pole` n'est affecté à personne. Autrement
//     dit BoondManager ne connaît PAS encore la distinction — mêmes conclusions
//     dans les deux apps, à trois semaines d'écart.
// Le jour où l'équipe crée les pôles (ou une seconde agence) dans Boond, la
// synchro reprend la main sans changement de code.
const AGENCY_RELS = (process.env.BOOND_AGENCY_REL || "pole,agency")
  .split(",").map((r) => r.trim()).filter(Boolean)
// Correspondance libellé Boond → agence de l'app (s5/a24). Deux usages :
//   « SMALL Sud-Ouest=BORDEAUX »  force un libellé que le mot-clé ne trouve pas ;
//   « SMALL= »  (valeur VIDE) déclare un libellé SANS INFORMATION de ville —
//     relevé du 15/09 : le tenant n'a qu'une agence, « SMALL », portée par les
//     65 ressources. Sans ce réglage, la synchro signalerait tout le monde
//     comme « sans agence » à chaque passage. Un libellé sans information
//     n'écrit RIEN : les agences saisies dans l'app survivent.
const AGENCY_MAP = new Map<string, string>(
  (process.env.BOOND_AGENCY_MAP || "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const i = p.indexOf("=")
      const cle = (i === -1 ? p : p.slice(0, i)).trim()
      const val = (i === -1 ? "" : p.slice(i + 1)).trim().toUpperCase()
      return [cle, val] as [string, string]
    })
)
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
// Champ du TJM de vente par défaut de la fiche (recensement a16 du 02/09 :
// averageDailyPriceExcludingTax, rempli sur 32/65 ressources du listing).
const RATE_FIELD = process.env.BOOND_RATE_FIELD || "averageDailyPriceExcludingTax"

// --- JWT client HS256 (sans dépendance — identique Formation) ---
function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

/** `userTokenOverride` : jeton d'un AUTRE compte (s6 — le compte « financier »
 *  qui seul voit les prestations). clientToken/clientKey restent ceux de
 *  l'application SMALL : seul l'utilisateur change. */
export function buildJwt(userTokenOverride?: string): string {
  const userToken = userTokenOverride || process.env.BOOND_USER_TOKEN
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

/**
 * Jeton de LECTURE des flux (ressources, CRA) — a27, 15/09/2026.
 *
 * Relevé décisif : le compte STANDARD a un PÉRIMÈTRE DE VISIBILITÉ RESTREINT.
 * Il ne voit que 65 ressources, toutes d'agence « SMALL », et conclut donc à
 * tort que BoondManager ignore Bordeaux. Le compte financier voit **75**
 * ressources et **deux** agences : « SMALL » ×65 et « SMALL BORDEAUX » ×10.
 * Autrement dit l'information a toujours été là — c'est le compte qui la
 * cachait. Lire le flux des personnes avec un compte à périmètre partiel,
 * c'est amputer le registre de 10 consultants (et leurs CRA).
 *
 * Ordre : variable dédiée (permet de FORCER un compte, y compris le standard),
 * puis le jeton financier s'il existe, puis le jeton standard. La source est
 * rendue au rapport de synchro : jamais de bascule muette.
 */
export function jetonLecture(): { token?: string; source: string } {
  const dedie = (process.env.BOOND_RESOURCES_USER_TOKEN || "").trim()
  if (dedie) return { token: dedie, source: "BOOND_RESOURCES_USER_TOKEN" }
  const finance = (process.env.BOOND_FINANCE_USER_TOKEN || "").trim()
  if (finance) return { token: finance, source: "BOOND_FINANCE_USER_TOKEN" }
  return { token: undefined, source: "BOOND_USER_TOKEN" }
}

export type BoondResource = {
  id: string
  type?: string
  attributes?: Record<string, unknown>
  relationships?: Record<string, { data?: { id?: string | number } }>
}

/** Index « type#id » → ressource, construit depuis la section `included`. */
export function indexIncluded(included: BoondResource[]): Map<string, BoondResource> {
  const m = new Map<string, BoondResource>()
  for (const i of included) m.set(`${String(i.type)}#${String(i.id)}`, i)
  return m
}

export async function fetchResources(): Promise<{
  resources: BoondResource[]
  included: BoondResource[]
  pages: number
  jeton: string
}> {
  const { token, source } = jetonLecture()
  const headers = { [JWT_HEADER]: buildJwt(token), Accept: "application/json" }
  const out: BoondResource[] = []
  const inc: BoondResource[] = []
  let page = 1
  while (page <= 100) {
    // include=<relation manager> : sans lui, le listing expose la CLÉ de la
    // relation mais pas son contenu (data) — relevé du 13/08 : mainManager
    // présent sur 65/65 ressources mais 0 lien posé. Paramètre ignoré sans
    // dommage si l'API ne le supporte pas.
    const url =
      `${BASE}/resources?page=${page}&maxResults=100&maxPerPage=100` +
      `&include=${encodeURIComponent([MANAGER_REL, ...AGENCY_RELS].join(","))}`
    const res = await fetch(url, { headers, cache: "no-store" })
    if (!res.ok) throw new Error(`Boond /resources HTTP ${res.status}`)
    const payload = await res.json()
    const data: BoondResource[] = payload.data ?? []
    out.push(...data)
    // `included` porte le CONTENU des relations (nom de l'agence, du manager…)
    inc.push(...((payload.included ?? []) as BoondResource[]))
    const total = payload?.meta?.totals?.rows
    if (!data.length || (typeof total === "number" && out.length >= total)) break
    page++
  }
  return { resources: out, included: inc, pages: page, jeton: source }
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

/**
 * Date d'arrivée depuis le DÉTAIL d'une ressource — le listing /resources ne
 * l'expose pas ; le tenant la porte dans `seniorityDate` (relevé du 13/08 :
 * #598 → 2026-01-12, conforme au registre). Champ forçable via BOOND_ARRIVAL_FIELD.
 */
export function pickArrivalFromDetail(a: Record<string, unknown>): string | null {
  return pickDate(a, ARRIVAL_FIELD, [
    "seniorityDate",
    "originalSeniorityDate",
    "startDate",
    "entryDate",
    "hiringDate",
  ])
}

/** GET /resources/{id} — attributs du détail (dates contrat, etc.). */
export async function fetchResourceDetail(boondId: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE}/resources/${boondId}`, {
    headers: { [JWT_HEADER]: buildJwt(jetonLecture().token), Accept: "application/json" },
    cache: "no-store",
  })
  if (!res.ok) throw new Error(`Boond /resources/${boondId} HTTP ${res.status}`)
  const payload = await res.json()
  return (payload?.data?.attributes ?? {}) as Record<string, unknown>
}

/** TJM de vente par défaut de la fiche (€/jour) — nombre strictement positif,
 *  sinon null (0 ou vide = « non renseigné dans Boond »). */
export function pickDailyRate(a: Record<string, unknown>): number | null {
  const n = Number(a[RATE_FIELD])
  return Number.isFinite(n) && n > 0 ? n : null
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

/**
 * Nom d'agence Boond → agence de l'app (s5). Reconnaissance par MOT-CLÉ, pas
 * par égalité : le tenant peut libeller « SMALL Bordeaux », « Agence de
 * Bordeaux », « SMALL-CONSEIL Paris »… Tout ce qui n'est ni l'un ni l'autre
 * rend null : la personne sera rattachée à Paris par défaut ET signalée, on
 * ne devine pas une ville.
 */
export function normalizeAgency(nom: string | null | undefined): string | null {
  const n = normText(nom)
  if (!n) return null
  for (const [cle, val] of AGENCY_MAP) {
    if (normText(cle) === n) return val === "PARIS" || val === "BORDEAUX" ? val : null
  }
  // Tolérance alignée sur `mapPoleToSite` de l'app Formation (« BDX »).
  if (n.includes("bordeaux") || n === "bdx" || n.includes("bdx")) return "BORDEAUX"
  if (n.includes("paris")) return "PARIS"
  return null
}

/**
 * Le libellé est-il déclaré SANS INFORMATION de ville (entrée à valeur vide de
 * BOOND_AGENCY_MAP) ? Un tel libellé n'est pas une anomalie : inutile de le
 * signaler à chaque synchro. Distinct de « non reconnu », qui, lui, mérite
 * l'attention.
 */
export function agenceSansInfo(nom: string | null | undefined): boolean {
  const n = normText(nom)
  if (!n) return false
  for (const [cle, val] of AGENCY_MAP) {
    if (normText(cle) === n) return val === ""
  }
  return false
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
  /** TJM de vente par défaut de la fiche (€/jour) — null = non renseigné. */
  dailyRate: number | null
  /** Agence normalisée (« PARIS » | « BORDEAUX ») — null si non reconnue. */
  agency: string | null
  /** Libellé BRUT de l'agence Boond — sert au signalement quand non reconnue. */
  agencyRaw: string | null
  /** Libellé déclaré sans information de ville (BOOND_AGENCY_MAP) — ni écrit,
   *  ni signalé : le tenant ne sait tout simplement pas. */
  agencyNoInfo: boolean
  managerBoondId: string | null
  excluded: boolean
  activeState: boolean
}

/**
 * `included` (facultatif) permet de résoudre le NOM de l'agence : le listing
 * ne porte que l'id de la relation, son contenu arrive dans la section
 * `included` grâce au paramètre include (leçon a8).
 */
export function extractPerson(
  r: BoondResource,
  included?: Map<string, BoondResource>
): BoondPerson {
  const a = r.attributes ?? {}
  const first = String((a.firstName as string) || "").trim()
  const last = String((a.lastName as string) || "").trim()
  const mgr = r.relationships?.[MANAGER_REL]?.data?.id
  const rawTitle = pickTitle(a)

  // Première relation candidate qui donne une VILLE reconnue ; à défaut, on
  // garde le premier libellé rencontré pour pouvoir le signaler tel quel.
  let agencyRaw: string | null = null
  let agencyVille: string | null = null
  for (const rel of AGENCY_RELS) {
    const id = r.relationships?.[rel]?.data?.id
    if (id === undefined || id === null) continue
    const obj =
      included?.get(`${rel}#${String(id)}`) ??
      included?.get(`agency#${String(id)}`) ??
      included?.get(`pole#${String(id)}`)
    const nom = obj?.attributes?.name ? String(obj.attributes.name) : null
    if (!nom) continue
    if (agencyRaw === null) agencyRaw = nom
    const ville = normalizeAgency(nom)
    if (ville) {
      agencyRaw = nom
      agencyVille = ville
      break
    }
  }
  return {
    boondId: String(r.id),
    name: `${first} ${last}`.trim(),
    email: pickEmail(a),
    title: isIndepType(a) ? "Indép" : rawTitle ? normalizeTitle(rawTitle) : null,
    state: a.state === undefined || a.state === null ? null : String(a.state),
    typeOf: a.typeOf === undefined || a.typeOf === null ? null : String(a.typeOf),
    arrival: pickArrival(a),
    departure: pickDeparture(a),
    dailyRate: pickDailyRate(a),
    agency: agencyVille,
    agencyRaw,
    agencyNoInfo: agenceSansInfo(agencyRaw),
    managerBoondId: mgr === undefined || mgr === null ? null : String(mgr),
    excluded: isExcludedType(a),
    activeState: isActiveState(a),
  }
}
