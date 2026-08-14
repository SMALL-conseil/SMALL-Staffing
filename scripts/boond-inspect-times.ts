// ============================================================
//  Sonde des CRA Boond (/times) — À LANCER EN LOCAL :
//      npx tsx scripts/boond-inspect-times.ts
//  Prépare la synchro des JOURS RÉELS (décision du 14/08 : CA réel par
//  client au reporting = jours CRA × honoraires €/jour, la convention
//  218/12 restant pour les mois à venir). La sonde relève :
//   1. la structure des lignes /times (clés, unités de durée, états,
//      bornes de dates, volumétrie) ;
//   2. la PORTE VERS LE CLIENT : include=project/delivery + détail —
//      si tout est 403, le rattachement passera par les missions de
//      l'app (personne × date → mission → client) ;
//   3. les filtres serveur utilisables par une synchro incrémentale
//      (17 842 lignes au dernier relevé — on ne repagine pas tout ça
//      chaque nuit) ;
//   4. un agrégat de JUIN 2026 par consultant et par projet, à comparer
//      de tête à la carte de staffing (contrôle golden) ;
//   5. les endpoints facturation (information seulement).
//  Lecture seule, aucune écriture, aucun secret ni email affiché.
//  → Coller TOUTE la sortie à Claude.
// ============================================================
import "dotenv/config"
import { buildJwt } from "../lib/boond"

const BASE = process.env.BOOND_BASE_URL || "https://ui.boondmanager.com/api"
const JWT_HEADER = process.env.BOOND_JWT_HEADER || "X-Jwt-Client-BoondManager"

type J = Record<string, unknown>
type Rel = { data?: { id?: unknown; type?: unknown } | null }
type Row = { id?: unknown; type?: unknown; attributes?: J; relationships?: Record<string, Rel> }

/** Accès en profondeur sans réveiller le typage. */
function dig(o: unknown, ...keys: string[]): unknown {
  let cur: unknown = o
  for (const k of keys) {
    if (cur && typeof cur === "object" && k in (cur as J)) cur = (cur as J)[k]
    else return undefined
  }
  return cur
}

async function get(pathAndQuery: string): Promise<{ status: number; payload: J | null }> {
  try {
    const res = await fetch(`${BASE}/${pathAndQuery}`, {
      headers: { [JWT_HEADER]: buildJwt(), Accept: "application/json" },
      cache: "no-store",
    })
    const payload = res.ok ? ((await res.json()) as J) : null
    return { status: res.status, payload }
  } catch (e) {
    console.log(`  /${pathAndQuery} → erreur d'appel : ${e instanceof Error ? e.message : e}`)
    return { status: 0, payload: null }
  }
}

const rows = (payload: J | null): Row[] => (dig(payload, "data") as Row[] | undefined) ?? []
const total = (payload: J | null): number | string =>
  (dig(payload, "meta", "totals", "rows") as number | undefined) ?? "?"
const relId = (r: Row, key: string): string | null => {
  const id = dig(r.relationships?.[key], "data", "id")
  return id === undefined || id === null ? null : String(id)
}
const nameish = (a: J | undefined): string => {
  if (!a) return "∅"
  const composed = [a.firstName, a.lastName].filter((v) => typeof v === "string" && v).join(" ")
  if (composed) return composed
  for (const k of ["title", "name", "reference", "label"]) {
    if (typeof a[k] === "string" && a[k]) return String(a[k])
  }
  return "∅"
}
const bump = (m: Map<string, number>, k: string, n = 1) => m.set(k, (m.get(k) ?? 0) + n)
const show = (label: string, m: Map<string, number>, max = 15) => {
  console.log(`${label} :`)
  const entries = [...m.entries()].sort((x, y) => y[1] - x[1])
  for (const [k, n] of entries.slice(0, max)) console.log(`  ${k} × ${n}`)
  if (entries.length > max) console.log(`  … (${entries.length - max} autres)`)
  console.log()
}

async function main() {
  // --- 1. Structure et volumétrie -----------------------------------------
  console.log("=== 1. /times — page 1 brute (100 lignes) ===")
  const first = await get("times?page=1&maxResults=100&maxPerPage=100")
  if (!first.payload) {
    console.log(`/times → HTTP ${first.status} — rien à sonder, coller quand même cette sortie.`)
    return
  }
  const page1 = rows(first.payload)
  console.log(`HTTP 200 · ${total(first.payload)} ligne(s) au total · ${page1.length} lues\n`)

  const keys = new Map<string, number>()
  const relKeys = new Map<string, number>()
  const durations = new Map<string, number>()
  const stateish = new Map<string, number>()
  const resIds = new Set<string>()
  let dMin = "≥", dMax = ""
  for (const r of page1) {
    const a = r.attributes ?? {}
    for (const k of Object.keys(a)) bump(keys, k)
    for (const k of Object.keys(r.relationships ?? {})) bump(relKeys, k)
    bump(durations, String(a.duration ?? "∅"))
    for (const [k, v] of Object.entries(a)) {
      if (/state|status|valid/i.test(k)) bump(stateish, `${k}=${String(v)}`)
    }
    const d = String(a.startDate ?? "")
    if (d) {
      if (!dMax || d > dMax) dMax = d
      if (dMin === "≥" || d < dMin) dMin = d
    }
    const rid = relId(r, "resource")
    if (rid) resIds.add(rid)
  }
  show("Clés d'attributs (fréquence)", keys)
  show("Clés de RELATIONS (la porte vers le client se cache ici)", relKeys)
  show("duration (unité à déduire : 1 = journée ? 0,5 = demi-journée ? heures ?)", durations, 12)
  show("Champs d'état (validation des CRA ?)", stateish, 12)
  console.log(`startDate sur cette page : de ${dMin} à ${dMax} · ${resIds.size} ressource(s) distincte(s)\n`)

  console.log("Échantillon BRUT (2 lignes) :")
  for (const r of page1.slice(0, 2)) {
    console.log(JSON.stringify({ id: r.id, attributes: r.attributes, relationships: r.relationships }, null, 1))
  }

  // --- 2. La porte vers le client : include -------------------------------
  console.log("\n=== 2. include=resource,delivery,project — le contenu suit-il ? ===")
  const inc = await get(`times?page=1&maxResults=3&include=${encodeURIComponent("resource,delivery,project")}`)
  console.log(`HTTP ${inc.status}`)
  const included = (dig(inc.payload, "included") as Row[] | undefined) ?? []
  if (included.length) {
    for (const i of included) {
      const a = i.attributes ?? {}
      console.log(
        `  ${String(i.type)}#${String(i.id)} : « ${nameish(a)} » · clés : ${Object.keys(a).slice(0, 12).join(", ")}`
      )
      const relsOfIncluded = Object.keys((i as Row).relationships ?? {})
      if (relsOfIncluded.length) console.log(`     relations : ${relsOfIncluded.join(", ")}`)
    }
    console.log("  → si les projets ci-dessus portent un nom/client : PORTE CLIENT OUVERTE via include.")
  } else {
    console.log("  (aucune section included — le rattachement client passera par les missions de l'app)")
  }

  // --- 3. Filtres serveur (pour une synchro incrémentale) -----------------
  console.log("\n=== 3. Filtres serveur — lesquels réduisent la volumétrie ? ===")
  const firstRes = page1.length ? relId(page1[0], "resource") : null
  const combos = [
    "startDate=2026-06-01&endDate=2026-06-30",
    "period=spent&startDate=2026-06-01&endDate=2026-06-30",
    "period=2026-06",
    "month=2026-06",
    ...(firstRes ? [`resources=${firstRes}`] : []),
    "sort=startDate&order=desc",
    "sort=startDate&order=asc",
  ]
  let juneQuery: string | null = null
  const grandTotal = total(first.payload)
  for (const q of combos) {
    const r = await get(`times?page=1&maxResults=1&${q}`)
    const t = total(r.payload)
    const firstDate = r.payload ? String(dig(rows(r.payload)[0]?.attributes ?? {}, "startDate") ?? "∅") : "∅"
    console.log(`  ?${q} → HTTP ${r.status} · total=${t} · 1re ligne startDate=${firstDate}`)
    if (!juneQuery && r.status === 200 && typeof t === "number" && typeof grandTotal === "number" && t < grandTotal && /2026-06/.test(q)) {
      juneQuery = q
    }
  }

  // --- 4. Agrégat de JUIN 2026 (contrôle golden si un filtre marche) ------
  if (juneQuery) {
    console.log(`\n=== 4. Juin 2026 agrégé (filtre retenu : ?${juneQuery}) ===`)
    const perResource = new Map<string, number>()
    const perProject = new Map<string, number>()
    const names = new Map<string, string>()
    const days = new Set<string>()
    let sum = 0
    for (let page = 1; page <= 10; page++) {
      const r = await get(
        `times?page=${page}&maxResults=100&maxPerPage=100&${juneQuery}&include=${encodeURIComponent("resource,project")}`
      )
      if (r.status !== 200) { console.log(`  page ${page} → HTTP ${r.status}, arrêt`); break }
      const data = rows(r.payload)
      for (const i of (dig(r.payload, "included") as Row[] | undefined) ?? []) {
        names.set(`${String(i.type)}#${String(i.id)}`, nameish(i.attributes))
      }
      for (const row of data) {
        const a = row.attributes ?? {}
        const dur = Number(a.duration)
        if (!Number.isFinite(dur)) continue
        sum += dur
        const rid = relId(row, "resource")
        const pid = relId(row, "project")
        if (rid) bump(perResource, `resource#${rid}`, dur)
        if (pid) bump(perProject, `project#${pid}`, dur)
        const d = String(a.startDate ?? "")
        if (d) days.add(d)
      }
      const t = total(r.payload)
      if (!data.length || (typeof t === "number" && page * 100 >= t)) break
    }
    console.log(`  Σ durations juin = ${sum} · ${days.size} date(s) distincte(s) (juin 2026 = 21 j.o.)`)
    const label = (k: string) => `${names.get(k) ?? k}`
    console.log("  Par consultant (top 15) :")
    for (const [k, n] of [...perResource.entries()].sort((x, y) => y[1] - x[1]).slice(0, 15)) {
      console.log(`    ${label(k)} : ${Math.round(n * 100) / 100}`)
    }
    console.log("  Par projet (top 10) :")
    for (const [k, n] of [...perProject.entries()].sort((x, y) => y[1] - x[1]).slice(0, 10)) {
      console.log(`    ${label(k)} : ${Math.round(n * 100) / 100}`)
    }
  } else {
    console.log("\n=== 4. (aucun filtre de dates accepté — l'agrégat de juin est sauté) ===")
  }

  // --- 5. Portes de détail + facturation (information) --------------------
  console.log("\n=== 5. Détails & facturation ===")
  const probeIds = page1.length
    ? [
        ["deliveries", relId(page1[0], "delivery")],
        ["projects", relId(page1[0], "project")],
      ]
    : []
  for (const [kind, id] of probeIds) {
    if (!id) { console.log(`  (pas de relation ${kind} sur la 1re ligne)`); continue }
    const r = await get(`${kind}/${id}`)
    const a = (dig(r.payload, "data", "attributes") as J | undefined) ?? {}
    const rels = Object.keys((dig(r.payload, "data", "relationships") as J | undefined) ?? {})
    console.log(
      `  /${kind}/${id} → HTTP ${r.status}${r.status === 200 ? ` · « ${nameish(a)} » · clés : ${Object.keys(a).slice(0, 12).join(", ")} · relations : ${rels.join(", ")}` : ""}`
    )
  }
  for (const path of ["timesreports", "invoices", "orders"]) {
    const r = await get(`${path}?page=1&maxResults=2&maxPerPage=2`)
    const data = rows(r.payload)
    console.log(
      `  /${path} → HTTP ${r.status}` +
        (r.status === 200
          ? ` · ${total(r.payload)} ligne(s) · clés : ${Object.keys(data[0]?.attributes ?? {}).slice(0, 12).join(", ") || "(aucune)"}`
          : "")
    )
  }

  console.log("\n→ Coller TOUTE cette sortie à Claude : elle décide du modèle de la synchro des jours réels.")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
