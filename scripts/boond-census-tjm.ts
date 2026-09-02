// ============================================================
//  RECENSEMENT des champs TJM / honoraires à travers l'API Boond — a16.
//      npx tsx scripts/boond-census-tjm.ts
//  Objectif : trouver LE champ le mieux REMPLI pour alimenter les
//  honoraires du registre — le candidat actuel est vide dans trop de cas.
//  La sonde balaie tout ce que le jeton ouvre et MESURE le remplissage :
//   1. la FICHE CONSULTANT (/resources, listing + détails) — le « TJM par
//      défaut » d'un profil, souvent le mieux tenu en cabinet, et
//      accessible même sans droits financiers ;
//   2. les PROJETS de VOS missions 2026 (ids relevés dans la base locale
//      depuis les jours de CRA) — détail par projet, nominatif ;
//   3. les PRESTATIONS liées aux CRA récents (ids via /times) ;
//   4. les listings financiers : deliveries, opportunities, positionings,
//      orders, invoices ;
//   5. un TABLEAU RÉCAPITULATIF : champ × endpoint × taux de remplissage.
//  Jeton : BOOND_FINANCE_USER_TOKEN si présent, sinon le jeton standard.
//  Garde-fou : les champs de COÛT/SALAIRE sont comptés mais leurs valeurs
//  ne sont JAMAIS affichées. Lecture seule. Coller TOUTE la sortie à Claude.
// ============================================================
import "dotenv/config"
import crypto from "crypto"
import { prisma } from "../lib/prisma"

const BASE = process.env.BOOND_BASE_URL || "https://ui.boondmanager.com/api"
const JWT_HEADER = process.env.BOOND_JWT_HEADER || "X-Jwt-Client-BoondManager"

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function jwtFor(userToken: string): string {
  const clientToken = process.env.BOOND_CLIENT_TOKEN
  const clientKey = process.env.BOOND_CLIENT_KEY
  if (!userToken || !clientToken || !clientKey) {
    throw new Error("Jetons manquants (BOOND_USER_TOKEN ou BOOND_FINANCE_USER_TOKEN + BOOND_CLIENT_TOKEN + BOOND_CLIENT_KEY)")
  }
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))
  const payload = b64url(
    JSON.stringify({ userToken, clientToken, time: Math.floor(Date.now() / 1000), mode: "normal" })
  )
  const sig = b64url(crypto.createHmac("sha256", clientKey).update(`${header}.${payload}`).digest())
  return `${header}.${payload}.${sig}`
}

type J = Record<string, unknown>
type Row = { id?: unknown; type?: unknown; attributes?: J; relationships?: Record<string, { data?: { id?: unknown } | null }> }

// Champs candidats (nom aplati « parent.enfant » inclus).
const FIN_KEY = /price|rate|tjm|daily|amount|turnover|budget|quantity|invoic|sold|selling|numberofdays/i
// Comptés mais valeurs JAMAIS affichées (coûts internes, salaires).
const SENSIBLE = /cost|salary|charge|payroll/i

const token = (process.env.BOOND_FINANCE_USER_TOKEN || "").trim() || process.env.BOOND_USER_TOKEN || ""

async function get(pathAndQuery: string): Promise<{ status: number; payload: J | null }> {
  try {
    const res = await fetch(`${BASE}/${pathAndQuery}`, {
      headers: { [JWT_HEADER]: jwtFor(token), Accept: "application/json" },
      cache: "no-store",
    })
    return { status: res.status, payload: res.ok ? ((await res.json()) as J) : null }
  } catch (e) {
    console.log(`  /${pathAndQuery.split("?")[0]} → erreur : ${e instanceof Error ? e.message : e}`)
    return { status: 0, payload: null }
  }
}

const rowsOf = (p: J | null): Row[] => (p?.data as Row[] | undefined) ?? []
const rowOf = (p: J | null): Row | null => (p?.data as Row | undefined) ?? null

/** Aplatit un niveau d'objet ({ workUnitType: { name } } → « workUnitType.name »). */
function flat(a: J): [string, unknown][] {
  const out: [string, unknown][] = []
  for (const [k, v] of Object.entries(a)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      for (const [k2, v2] of Object.entries(v as J)) out.push([`${k}.${k2}`, v2])
    } else out.push([k, v])
  }
  return out
}

/** Rempli = utilisable pour un TJM : ni null/vide, ni 0. */
const estRempli = (v: unknown): boolean =>
  v !== null && v !== undefined && v !== "" && v !== 0 && v !== "0" && v !== false

interface Stat { total: number; remplis: number; exemples: string[] }
const census = new Map<string, Stat>() // clé « endpoint · champ »

function scan(endpoint: string, attrs: J): void {
  for (const [k, v] of flat(attrs)) {
    if (!FIN_KEY.test(k)) continue
    const cle = `${endpoint} · ${k}`
    const s = census.get(cle) ?? { total: 0, remplis: 0, exemples: [] }
    s.total++
    if (estRempli(v)) {
      s.remplis++
      if (!SENSIBLE.test(k)) {
        const ex = String(v).slice(0, 18)
        if (s.exemples.length < 4 && !s.exemples.includes(ex)) s.exemples.push(ex)
      }
    }
    census.set(cle, s)
  }
}

function valeursVisibles(a: J): string {
  const picked = flat(a)
    .filter(([k, v]) => FIN_KEY.test(k) && estRempli(v) && !SENSIBLE.test(k))
    .slice(0, 8)
  return picked.length ? picked.map(([k, v]) => `${k}=${String(v).slice(0, 16)}`).join(" · ") : "(aucun champ financier rempli)"
}

async function main() {
  console.log(
    (process.env.BOOND_FINANCE_USER_TOKEN || "").trim()
      ? "Jeton : BOOND_FINANCE_USER_TOKEN (compte « financier »)\n"
      : "⚠ Jeton STANDARD (BOOND_FINANCE_USER_TOKEN absent) — le financier restera sans doute en 403.\n"
  )

  // --- 1. Fiche consultant : listing + détails --------------------------------
  console.log("=== 1. /resources — la fiche consultant porte-t-elle un TJM ? ===")
  const listing = await get("resources?page=1&maxResults=100&maxPerPage=100")
  console.log(`  listing → HTTP ${listing.status} · ${rowsOf(listing.payload).length} ressource(s)`)
  for (const r of rowsOf(listing.payload)) scan("resources(listing)", r.attributes ?? {})

  const actifs = await prisma.person.findMany({
    where: { boondId: { not: null }, kind: "CONSULTANT", departureDate: null },
    select: { boondId: true, name: true },
    take: 10,
  })
  console.log(`  détails sondés : ${actifs.length} consultant(s) actif(s) rapprochés`)
  for (const p of actifs) {
    const d = await get(`resources/${p.boondId}`)
    const a = rowOf(d.payload)?.attributes ?? {}
    if (d.status === 200) {
      scan("resources(détail)", a)
      console.log(`    ${p.name} : ${valeursVisibles(a)}`)
    } else {
      console.log(`    ${p.name} : HTTP ${d.status}`)
    }
  }

  // --- 2. Les projets de VOS missions 2026 ------------------------------------
  console.log("\n=== 2. Projets des CRA 2026 (détail par projet) ===")
  const projets = await prisma.timeEntry.groupBy({
    by: ["projectBoondId", "clientName", "projectName"],
    where: { activityType: "production", date: { gte: new Date("2026-01-01T00:00:00Z") }, projectBoondId: { not: null } },
    _sum: { duration: true },
  })
  const topProjets = [...projets]
    .sort((x, y) => (y._sum.duration ?? 0) - (x._sum.duration ?? 0))
    .slice(0, 25)
  console.log(`  ${topProjets.length} projet(s) distincts (classés par jours 2026)`)
  for (const pr of topProjets) {
    const d = await get(`projects/${pr.projectBoondId}`)
    const a = rowOf(d.payload)?.attributes ?? {}
    const libelle = `${pr.clientName ?? "?"} / ${pr.projectName ?? pr.projectBoondId} (${pr._sum.duration} j)`
    if (d.status === 200) {
      scan("projects(détail)", a)
      console.log(`    ${libelle} : ${valeursVisibles(a)}`)
    } else {
      console.log(`    ${libelle} : HTTP ${d.status}`)
    }
  }

  // --- 3. Prestations liées aux CRA récents -----------------------------------
  console.log("\n=== 3. Prestations (deliveries) des CRA récents ===")
  const deliveryIds = new Set<string>()
  for (let page = 1; page <= 2 && deliveryIds.size < 15; page++) {
    const t = await get(`times?page=${page}&maxResults=100&maxPerPage=100&sort=startDate&order=desc`)
    for (const row of rowsOf(t.payload)) {
      const id = row.relationships?.delivery?.data?.id
      if (id !== undefined && id !== null) deliveryIds.add(String(id))
    }
    if (t.status !== 200) break
  }
  console.log(`  ${deliveryIds.size} prestation(s) distincte(s) relevée(s) sur les CRA récents`)
  for (const id of [...deliveryIds].slice(0, 12)) {
    const d = await get(`deliveries/${id}`)
    const a = rowOf(d.payload)?.attributes ?? {}
    if (d.status === 200) {
      scan("deliveries(détail)", a)
      console.log(`    prestation #${id} : ${valeursVisibles(a)}`)
    } else {
      console.log(`    prestation #${id} : HTTP ${d.status}`)
    }
  }

  // --- 4. Listings financiers ---------------------------------------------------
  console.log("\n=== 4. Listings financiers ===")
  for (const path of ["deliveries", "opportunities", "positionings", "orders", "invoices"]) {
    const r = await get(`${path}?page=1&maxResults=100&maxPerPage=100`)
    const data = rowsOf(r.payload)
    const total = ((r.payload?.meta as J | undefined)?.totals as J | undefined)?.rows ?? "?"
    console.log(`  /${path} → HTTP ${r.status}${r.status === 200 ? ` · ${total} ligne(s) · ${data.length} scannée(s)` : ""}`)
    if (data.length) {
      for (const row of data) scan(`${path}(listing)`, row.attributes ?? {})
      console.log(`     clés : ${Object.keys(data[0].attributes ?? {}).join(", ").slice(0, 200)}`)
    }
  }

  // --- 5. Tableau récapitulatif -------------------------------------------------
  console.log("\n=== 5. RÉCAPITULATIF — remplissage par champ (trié) ===")
  const lignes = [...census.entries()]
    .map(([cle, s]) => ({ cle, ...s, taux: s.total ? s.remplis / s.total : 0 }))
    .filter((l) => l.total >= 3)
    .sort((x, y) => y.taux - x.taux || y.total - x.total)
  for (const l of lignes) {
    const pct = Math.round(l.taux * 100)
    const ex = l.exemples.length ? ` · ex : ${l.exemples.join(", ")}` : ""
    console.log(`  ${String(pct).padStart(3)} % (${l.remplis}/${l.total})  ${l.cle}${ex}`)
  }
  if (!lignes.length) console.log("  (rien d'accessible — le jeton n'ouvre aucun champ financier)")

  console.log("\n→ Coller TOUTE cette sortie à Claude : le champ retenu et la synchro en découlent.")
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
