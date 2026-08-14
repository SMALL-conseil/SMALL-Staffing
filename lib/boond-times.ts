// ============================================================
//  Client Boond /times (jours de CRA) + extraction PURE — a12.
//  Relevé du 14/08/2026 (boond-inspect-times) :
//   · 1 ligne = 1 jour saisi : { category, workUnitType{activityType,name},
//     startDate, duration (1 = journée) } — PAS de relation resource directe :
//     la personne arrive par timesReport → resource ;
//   · include=resource,delivery,project fait suivre TOUTE la chaîne dans
//     `included` : timesreport (term, state = validation du CRA, relation
//     resource), resource (nom), project (reference) et company (LE CLIENT) —
//     alors que /projects et /deliveries en direct renvoient 403 (leçon a8) ;
//   · AUCUN filtre serveur de dates n'est honoré, mais sort=startDate
//     fonctionne → la synchro incrémentale descend les pages en ordre
//     décroissant jusqu'à sa fenêtre.
// ============================================================
import { buildJwt } from "./boond"

const BASE = process.env.BOOND_BASE_URL || "https://ui.boondmanager.com/api"
const JWT_HEADER = process.env.BOOND_JWT_HEADER || "X-Jwt-Client-BoondManager"
const TIMES_INCLUDE = process.env.BOOND_TIMES_INCLUDE || "resource,delivery,project"

type J = Record<string, unknown>
type Rel = { data?: { id?: unknown; type?: unknown } | null }
export type TimesResource = {
  id?: unknown
  type?: unknown
  attributes?: J
  relationships?: Record<string, Rel>
}

export interface TimesPage {
  rows: TimesResource[]
  included: TimesResource[]
  total: number | null
}

export async function fetchTimesPage(page: number, order: "asc" | "desc"): Promise<TimesPage> {
  const url =
    `${BASE}/times?page=${page}&maxResults=100&maxPerPage=100` +
    `&sort=startDate&order=${order}&include=${encodeURIComponent(TIMES_INCLUDE)}`
  const res = await fetch(url, {
    headers: { [JWT_HEADER]: buildJwt(), Accept: "application/json" },
    cache: "no-store",
  })
  if (!res.ok) throw new Error(`Boond /times HTTP ${res.status} (page ${page})`)
  const payload = (await res.json()) as J
  const meta = payload.meta as J | undefined
  const totals = meta?.totals as J | undefined
  return {
    rows: (payload.data as TimesResource[] | undefined) ?? [],
    included: (payload.included as TimesResource[] | undefined) ?? [],
    total: typeof totals?.rows === "number" ? totals.rows : null,
  }
}

// ------------------------------------------------------------
// Extraction pure (testée dans tests/boond-times-pure.test.ts)
// ------------------------------------------------------------

/** Jour de CRA normalisé, prêt pour la synchro. */
export interface BoondTimeRow {
  boondId: string
  /** boondId de la personne (via timesReport → resource) — null si irrésolu. */
  resourceBoondId: string | null
  /** « YYYY-MM-DD » — null si absent (ligne inexploitable). */
  date: string | null
  duration: number
  category: string
  activityType: string
  workUnit: string
  projectBoondId: string | null
  projectName: string | null
  clientName: string | null
  craState: string | null
  craTerm: string | null
}

const relId = (r: TimesResource | undefined, key: string): string | null => {
  const data = r?.relationships?.[key]?.data
  const id = data && typeof data === "object" ? (data as J).id : undefined
  return id === undefined || id === null ? null : String(id)
}

const str = (v: unknown): string | null => (v === undefined || v === null || v === "" ? null : String(v))

/** Indexe la section `included` par « type#id ». */
export function indexIncluded(included: TimesResource[]): Map<string, TimesResource> {
  const map = new Map<string, TimesResource>()
  for (const i of included) map.set(`${String(i.type)}#${String(i.id)}`, i)
  return map
}

/** Normalise les lignes /times d'une page à l'aide de sa section included. */
export function extractTimeRows(rows: TimesResource[], included: TimesResource[]): BoondTimeRow[] {
  const inc = indexIncluded(included)
  const out: BoondTimeRow[] = []
  for (const r of rows) {
    const a = r.attributes ?? {}
    const wut = (a.workUnitType ?? {}) as J
    const dateRaw = str(a.startDate)
    const date = dateRaw ? (dateRaw.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? null) : null

    const report = inc.get(`timesreport#${relId(r, "timesReport")}`)
    const project = inc.get(`project#${relId(r, "project")}`)
    const company = inc.get(`company#${relId(project, "company")}`)

    const duration = Number(a.duration)
    out.push({
      boondId: String(r.id),
      resourceBoondId: relId(report, "resource"),
      date,
      duration: Number.isFinite(duration) ? duration : 0,
      category: str(a.category) ?? "?",
      activityType: str((wut as J).activityType) ?? "?",
      workUnit: str((wut as J).name) ?? "?",
      projectBoondId: relId(r, "project"),
      projectName: str(project?.attributes?.reference) ?? str(project?.attributes?.name),
      clientName: str(company?.attributes?.name),
      craState: str(report?.attributes?.state),
      craTerm: str(report?.attributes?.term),
    })
  }
  return out
}
