// ============================================================
//  Prestations BoondManager (s6) — le PRIX DE VENTE des missions.
//      client + extraction PURE (testée dans tests/boond-deliveries.test.ts)
//
//  Relevé du 15/09/2026, avec un jeton dont le compte voit le financier :
//   · /deliveries/{id} → 200, et porte tout ce qui nous manquait :
//       averageDailyPriceExcludingTax  = TJM VENDU (ex. 1250 €)
//       numberOfDaysInvoicedOrQuantity = jours vendus (ex. 93)
//       startDate / endDate / title / state / typeOf
//       relations : project (→ company = le client), contract, purchase…
//   · le LISTING /deliveries répond 405 : impossible d'énumérer de front —
//     on part donc des identifiants portés par les lignes de CRA, qui sont
//     exactement les prestations sur lesquelles on a pointé des jours ;
//   · /projects répond 200 (109 lignes) : c'est là qu'on lit le client.
//
//  ⚠️ DÉCISION DU 15/09 : les COÛTS et MARGES (averageDailyCost,
//  costsSimulatedExcludingTax, marginSimulatedExcludingTax, profitability…)
//  existent dans la charge utile mais ne sont JAMAIS extraits — ils
//  trahiraient les salaires. Ne pas les stocker, c'est ne pas avoir à les
//  protéger. Ne pas les ajouter sans décision d'équipe explicite.
// ============================================================
import { buildJwt } from "./boond"

const BASE = process.env.BOOND_BASE_URL || "https://ui.boondmanager.com/api"
const JWT_HEADER = process.env.BOOND_JWT_HEADER || "X-Jwt-Client-BoondManager"
// Jeton d'un compte qui voit le financier ; à défaut, le jeton standard
// (qui, lui, prend 403 sur les prestations).
const FINANCE_TOKEN = (process.env.BOOND_FINANCE_USER_TOKEN || "").trim()

type J = Record<string, unknown>

/** Prestation normalisée — prix de vente uniquement, jamais les coûts. */
export interface BoondDelivery {
  boondId: string
  title: string | null
  startDate: string | null
  endDate: string | null
  /** TJM vendu (€/jour) — null si absent ou nul. */
  dailyRate: number | null
  /** Jours vendus au contrat — null si absent. */
  daysSold: number | null
  state: string | null
  typeOf: string | null
  projectBoondId: string | null
}

const str = (v: unknown): string | null => (v === undefined || v === null || v === "" ? null : String(v))

const num = (v: unknown): number | null => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

const iso = (v: unknown): string | null => {
  const s = str(v)
  return s ? (s.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? null) : null
}

const relId = (payload: J | undefined, key: string): string | null => {
  const rels = payload?.relationships as Record<string, { data?: { id?: unknown } | null }> | undefined
  const id = rels?.[key]?.data?.id
  return id === undefined || id === null ? null : String(id)
}

/**
 * Extraction PURE d'une prestation depuis la charge utile de /deliveries/{id}.
 * `data` = le nœud `data` de la réponse (attributes + relationships).
 */
export function extractDelivery(boondId: string, data: J | undefined): BoondDelivery {
  const a = (data?.attributes ?? {}) as J
  return {
    boondId,
    title: str(a.title),
    startDate: iso(a.startDate),
    endDate: iso(a.endDate),
    dailyRate: num(a.averageDailyPriceExcludingTax),
    daysSold: num(a.numberOfDaysInvoicedOrQuantity),
    state: str(a.state),
    typeOf: str(a.typeOf),
    projectBoondId: relId(data, "project"),
  }
}

async function get(path: string): Promise<{ status: number; payload: J | null }> {
  const token = FINANCE_TOKEN || undefined
  const res = await fetch(`${BASE}/${path}`, {
    headers: { [JWT_HEADER]: buildJwt(token), Accept: "application/json" },
    cache: "no-store",
  })
  return { status: res.status, payload: res.ok ? ((await res.json()) as J) : null }
}

/** GET /deliveries/{id} — null si l'API refuse (403) ou ne connaît pas l'objet. */
export async function fetchDelivery(boondId: string): Promise<BoondDelivery | null> {
  const r = await get(`deliveries/${boondId}`)
  if (r.status !== 200) return null
  return extractDelivery(boondId, r.payload?.data as J | undefined)
}

/** Projet → { référence, client } : le nom du client vient de `company`. */
export interface BoondProject {
  boondId: string
  reference: string | null
  clientName: string | null
}

/** Listing /projects (200 au relevé du 15/09) avec le client inclus. */
export async function fetchProjects(): Promise<Map<string, BoondProject>> {
  const out = new Map<string, BoondProject>()
  for (let page = 1; page <= 30; page++) {
    const r = await get(`projects?page=${page}&maxResults=100&maxPerPage=100&include=company`)
    if (r.status !== 200) break
    const data = (r.payload?.data ?? []) as J[]
    const included = (r.payload?.included ?? []) as J[]
    const companies = new Map<string, string>()
    for (const i of included) {
      if (String(i.type) === "company") {
        const nom = (i.attributes as J | undefined)?.name
        if (nom) companies.set(String(i.id), String(nom))
      }
    }
    for (const p of data) {
      const id = String(p.id)
      const companyId = relId(p, "company")
      out.set(id, {
        boondId: id,
        reference: str((p.attributes as J | undefined)?.reference),
        clientName: companyId ? (companies.get(companyId) ?? null) : null,
      })
    }
    const total = ((r.payload?.meta as J | undefined)?.totals as J | undefined)?.rows
    if (!data.length || (typeof total === "number" && out.size >= total)) break
  }
  return out
}
