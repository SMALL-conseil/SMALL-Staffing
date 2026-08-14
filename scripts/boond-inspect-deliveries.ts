// ============================================================
//  Sonde du volet FINANCIER Boond (prestations / projets) — a15.
//      npx tsx scripts/boond-inspect-deliveries.ts
//  Contexte : le jeton actuel (BOOND_USER_TOKEN) prend 403 sur /deliveries,
//  /projects, /orders, /invoices — or les taux journaliers et jours vendus
//  des missions vivent sur les PRESTATIONS (/deliveries). Les droits API
//  Boond suivent le COMPTE du jeton : un compte qui voit le financier dans
//  l'interface devrait l'ouvrir aussi par l'API.
//  → Renseigner BOOND_FINANCE_USER_TOKEN dans le .env (jeton généré depuis
//    un compte voyant les honoraires — même manip que les jetons d'origine,
//    clientToken/clientKey inchangés), puis lancer cette sonde.
//  Sans BOOND_FINANCE_USER_TOKEN, elle teste le jeton standard (état des lieux).
//  Lecture seule ; AUCUNE valeur de jeton affichée. Coller la sortie à Claude.
// ============================================================
import "dotenv/config"
import crypto from "crypto"

const BASE = process.env.BOOND_BASE_URL || "https://ui.boondmanager.com/api"
const JWT_HEADER = process.env.BOOND_JWT_HEADER || "X-Jwt-Client-BoondManager"

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function jwtFor(userToken: string): string {
  const clientToken = process.env.BOOND_CLIENT_TOKEN
  const clientKey = process.env.BOOND_CLIENT_KEY
  if (!userToken || !clientToken || !clientKey) {
    throw new Error("Jetons manquants (BOOND_USER_TOKEN/BOOND_FINANCE_USER_TOKEN + BOOND_CLIENT_TOKEN + BOOND_CLIENT_KEY)")
  }
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))
  const payload = b64url(
    JSON.stringify({ userToken, clientToken, time: Math.floor(Date.now() / 1000), mode: "normal" })
  )
  const sig = b64url(crypto.createHmac("sha256", clientKey).update(`${header}.${payload}`).digest())
  return `${header}.${payload}.${sig}`
}

type J = Record<string, unknown>
type Row = { id?: unknown; attributes?: J; relationships?: Record<string, { data?: { id?: unknown } | null }> }

const FINANCIER = /price|rate|daily|amount|number|quantity|day|turnover|cost|invoic|budget|state|title|mode/i

async function get(token: string, pathAndQuery: string): Promise<{ status: number; payload: J | null }> {
  try {
    const res = await fetch(`${BASE}/${pathAndQuery}`, {
      headers: { [JWT_HEADER]: jwtFor(token), Accept: "application/json" },
      cache: "no-store",
    })
    return { status: res.status, payload: res.ok ? ((await res.json()) as J) : null }
  } catch (e) {
    console.log(`  /${pathAndQuery} → erreur : ${e instanceof Error ? e.message : e}`)
    return { status: 0, payload: null }
  }
}

function extrait(a: J): string {
  const picked = Object.entries(a).filter(([k, v]) => FINANCIER.test(k) && v !== null && v !== "")
  return JSON.stringify(Object.fromEntries(picked.slice(0, 14)))
}

async function probeList(token: string, path: string): Promise<Row[]> {
  const r = await get(token, `${path}?page=1&maxResults=3&maxPerPage=3`)
  const data = ((r.payload?.data as Row[] | undefined) ?? [])
  const total = ((r.payload?.meta as J | undefined)?.totals as J | undefined)?.rows ?? "?"
  console.log(`  /${path} → HTTP ${r.status}${r.status === 200 ? ` · ${total} ligne(s)` : ""}`)
  if (data.length) {
    const a = data[0].attributes ?? {}
    console.log(`     clés : ${Object.keys(a).join(", ")}`)
    for (const row of data) {
      const rels = Object.keys(row.relationships ?? {})
      console.log(`     #${row.id} ${extrait(row.attributes ?? {})}${rels.length ? ` · relations : ${rels.join(", ")}` : ""}`)
    }
  }
  return data
}

async function probeDetail(token: string, path: string): Promise<void> {
  const r = await get(token, path)
  const a = ((r.payload?.data as Row | undefined)?.attributes ?? {}) as J
  const rels = Object.keys(((r.payload?.data as Row | undefined)?.relationships ?? {}) as J)
  console.log(`  /${path} → HTTP ${r.status}`)
  if (r.status === 200) {
    console.log(`     clés : ${Object.keys(a).join(", ")}`)
    console.log(`     champs financiers/datés : ${extrait(a)}`)
    if (rels.length) console.log(`     relations : ${rels.join(", ")}`)
  }
}

async function main() {
  const finance = (process.env.BOOND_FINANCE_USER_TOKEN || "").trim()
  const token = finance || process.env.BOOND_USER_TOKEN || ""
  console.log(
    finance
      ? "Jeton testé : BOOND_FINANCE_USER_TOKEN (compte « financier »)\n"
      : "⚠ BOOND_FINANCE_USER_TOKEN absent — test avec le jeton STANDARD (403 attendus, état des lieux).\n"
  )

  console.log("=== 1. Prestations (/deliveries) — taux journaliers & jours vendus ===")
  const deliveries = await probeList(token, "deliveries")

  // Un id de prestation sûr : celui rattaché à une ligne de CRA.
  let deliveryId: string | null = deliveries.length ? String(deliveries[0].id) : null
  if (!deliveryId) {
    const t = await get(token, "times?page=1&maxResults=1")
    const row = ((t.payload?.data as Row[] | undefined) ?? [])[0]
    const id = row?.relationships?.delivery?.data?.id
    deliveryId = id === undefined || id === null ? null : String(id)
  }
  if (deliveryId) {
    console.log(`\n=== 2. Détail d'une prestation (#${deliveryId}) ===`)
    await probeDetail(token, `deliveries/${deliveryId}`)
    await probeDetail(token, `deliveries/${deliveryId}/information`)
  }

  console.log("\n=== 3. Projets (/projects) — le lien prestation ↔ client ===")
  const projects = await probeList(token, "projects")
  const projectId = projects.length ? String(projects[0].id) : "12"
  await probeDetail(token, `projects/${projectId}`)

  console.log("\n=== 4. Facturation (info) ===")
  await probeList(token, "orders")
  await probeList(token, "invoices")

  console.log(
    "\n→ Si /deliveries répond 200 avec un taux (…Price…, …Rate…) et des jours (…number…, …quantity…)," +
      "\n  coller TOUTE la sortie à Claude : la synchro honoraires + jours vendus sera construite dessus." +
      "\n→ Si tout reste en 403 : le compte du jeton ne voit pas le financier — utiliser un jeton d'un" +
      "\n  compte qui le voit, ou passer par l'export Excel de l'interface Boond (import fourni sur demande)."
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
