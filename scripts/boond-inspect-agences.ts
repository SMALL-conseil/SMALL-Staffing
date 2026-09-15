// ============================================================
//  CHASSE AU RATTACHEMENT PARIS / BORDEAUX dans Boond (s5 → a26)
//  À LANCER EN LOCAL :
//      npx tsx scripts/boond-inspect-agences.ts          (rapide : 10 fiches détaillées)
//      npx tsx scripts/boond-inspect-agences.ts --full   (les 65 fiches : ~130 appels)
//
//  Pourquoi cette version : le relevé du 15/09 concluait « aucune trace de
//  Bordeaux » — mais il tournait avec le JETON STANDARD. Le jeton financier
//  voit peut-être des objets que l'autre masque (403 silencieux côté relations).
//  Cette sonde :
//    1. rejoue TOUT avec les deux jetons et compare ;
//    2. ne se contente plus des relations devinées (`agency`, `pole`…) : elle
//       RATISSE chaque charge utile à la recherche des mots « Bordeaux / BDX /
//       Gironde / Paris » — où qu'ils soient, y compris dans un champ maison ;
//    3. descend dans les endpoints DÉTAIL (/resources/{id} et
//       /resources/{id}/information — celui où Formation a fini par trouver la
//       date d'ancienneté) ;
//    4. tente les endpoints de référentiel (agences, pôles, dictionnaire).
//  Lecture seule. AUCUN secret affiché (seulement une empreinte sha256 courte,
//  qui permet de comparer deux jetons sans jamais les montrer).
// ============================================================
import "dotenv/config"
import crypto from "crypto"
import { buildJwt, normalizeAgency, type BoondResource } from "../lib/boond"

const BASE = process.env.BOOND_BASE_URL || "https://ui.boondmanager.com/api"
const JWT_HEADER = process.env.BOOND_JWT_HEADER || "X-Jwt-Client-BoondManager"
const FULL = process.argv.includes("--full")

// Relations candidates : celles qu'on lit déjà + celles que l'API pourrait
// exposer sous un autre nom. `include` inconnu = paramètre ignoré par Boond.
const CANDIDATES = ["agency", "pole", "businessUnit", "division", "subDivision", "site", "team"]

// Mots qui trahissent une ville de rattachement, où qu'ils se cachent.
const VILLE = /bordeaux|(^|[^a-z])bdx([^a-z]|$)|gironde|nouvelle[- ]aquitaine|aquitaine/i
const PARIS = /paris|(^|[^a-z])idf([^a-z]|$)|ile[- ]de[- ]france/i
// Clés dont le NOM sent le rattachement géographique.
const CLE_GEO = /agenc|pole|p[oô]le|site|ville|city|town|region|bu$|business|division|localisation|lieu|address|adresse|zip|postal|country|pays/i

type J = Record<string, unknown>
type Hit = { path: string; value: string }

function empreinte(v?: string | null): string {
  if (!v) return "(absent)"
  return `sha256:${crypto.createHash("sha256").update(v).digest("hex").slice(0, 8)} · ${v.length} car.`
}

/** Ratisse toute la structure : chemin JSON → valeur, pour les chaînes qui matchent. */
function scan(node: unknown, path: string, out: Hit[], re: RegExp, cap = 400): void {
  if (out.length >= cap || node === null || node === undefined) return
  if (typeof node === "string") {
    if (re.test(node)) out.push({ path, value: node })
    return
  }
  if (typeof node !== "object") return
  if (Array.isArray(node)) {
    node.forEach((v, i) => scan(v, `${path}[${i}]`, out, re, cap))
    return
  }
  for (const [k, v] of Object.entries(node as J)) scan(v, path ? `${path}.${k}` : k, out, re, cap)
}

/** Chemin sans indices : data[3].attributes.x → data[].attributes.x */
const gabarit = (p: string) => p.replace(/\[\d+\]/g, "[]")

/** Toutes les clés « géographiques » rencontrées, avec un échantillon de valeurs. */
function clesGeo(node: unknown, path: string, out: Map<string, Set<string>>, prof = 0): void {
  if (prof > 6 || node === null || typeof node !== "object") return
  if (Array.isArray(node)) {
    node.slice(0, 5).forEach((v) => clesGeo(v, `${path}[]`, out, prof + 1))
    return
  }
  for (const [k, v] of Object.entries(node as J)) {
    const p = path ? `${path}.${k}` : k
    if (CLE_GEO.test(k) && (typeof v === "string" || typeof v === "number")) {
      const s = String(v).trim()
      if (s && s !== "0") {
        if (!out.has(p)) out.set(p, new Set())
        const set = out.get(p)!
        if (set.size < 8) set.add(s)
      }
    }
    clesGeo(v, p, out, prof + 1)
  }
}

async function get(url: string, jwt: string): Promise<{ status: number; body: unknown }> {
  try {
    const res = await fetch(url, { headers: { [JWT_HEADER]: jwt, Accept: "application/json" }, cache: "no-store" })
    if (!res.ok) return { status: res.status, body: null }
    return { status: res.status, body: await res.json() }
  } catch (e) {
    console.log(`   ! ${url} → ${e instanceof Error ? e.message : String(e)}`)
    return { status: 0, body: null }
  }
}

const nomDe = (r: BoondResource) =>
  `${String(r.attributes?.firstName ?? "")} ${String(r.attributes?.lastName ?? "")}`.trim() || `#${r.id}`

// ------------------------------------------------------------
//  Phase 1 — la LISTE /resources, avec toutes les relations candidates
// ------------------------------------------------------------
async function phaseListe(jwt: string, label: string) {
  const resources: BoondResource[] = []
  const included: BoondResource[] = []
  const brut: unknown[] = []
  for (let page = 1; page <= 20; page++) {
    const url =
      `${BASE}/resources?page=${page}&maxResults=100&maxPerPage=100` +
      `&include=${encodeURIComponent(CANDIDATES.join(","))}`
    const { status, body } = await get(url, jwt)
    if (status !== 200 || !body) {
      console.log(`  /resources → HTTP ${status} (page ${page}) — jeton « ${label} »`)
      return null
    }
    brut.push(body)
    const payload = body as J
    const data = (payload.data ?? []) as BoondResource[]
    resources.push(...data)
    included.push(...((payload.included ?? []) as BoondResource[]))
    const total = ((payload.meta as J)?.totals as J)?.rows
    if (!data.length || (typeof total === "number" && resources.length >= total)) break
  }

  console.log(`  ${resources.length} ressource(s) · included : ${included.length} objet(s)`)

  // Types réellement renvoyés dans `included`
  const types = new Map<string, number>()
  for (const i of included) types.set(String(i.type), (types.get(String(i.type)) ?? 0) + 1)
  console.log(`  included : ${[...types].map(([t, n]) => `${t}×${n}`).join(" · ") || "(vide)"}`)

  // TOUTES les clés de relations présentes (pas seulement celles qu'on devine)
  const rels = new Map<string, number>()
  for (const r of resources)
    for (const k of Object.keys(r.relationships ?? {})) rels.set(k, (rels.get(k) ?? 0) + 1)
  console.log(
    `  relations exposées : ${[...rels.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}(${n})`).join(" · ")}`
  )

  // Histogramme des libellés par relation candidate
  const idx = new Map<string, BoondResource>()
  for (const i of included) idx.set(`${String(i.type)}#${String(i.id)}`, i)
  for (const rel of CANDIDATES) {
    const hist = new Map<string, number>()
    for (const r of resources) {
      const id = r.relationships?.[rel]?.data?.id
      if (id === undefined || id === null) continue
      const obj = idx.get(`${rel}#${String(id)}`) ?? idx.get(`agency#${String(id)}`) ?? idx.get(`pole#${String(id)}`)
      const nom = obj?.attributes?.name ? String(obj.attributes.name) : `(#${String(id)}, nom non résolu)`
      hist.set(nom, (hist.get(nom) ?? 0) + 1)
    }
    if (!hist.size) continue
    const detail = [...hist.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([nom, n]) => `${nom}×${n}→${normalizeAgency(nom) ?? "NON RECONNU"}`)
      .join(" · ")
    console.log(`  « ${rel} » : ${detail}`)
  }

  // Ratissage des mots-clés sur la charge utile COMPLÈTE
  const hitsV: Hit[] = []
  const hitsP: Hit[] = []
  for (const b of brut) {
    scan(b, "", hitsV, VILLE)
    scan(b, "", hitsP, PARIS)
  }
  resume("Bordeaux & co", hitsV, resources)
  resume("Paris & co", hitsP, resources)
  return { resources, hitsV }
}

function resume(titre: string, hits: Hit[], resources: BoondResource[]) {
  if (!hits.length) {
    console.log(`  « ${titre} » : AUCUNE occurrence dans la charge utile`)
    return
  }
  const parGabarit = new Map<string, Set<string>>()
  for (const h of hits) {
    const g = gabarit(h.path)
    if (!parGabarit.has(g)) parGabarit.set(g, new Set())
    const s = parGabarit.get(g)!
    if (s.size < 6) s.add(h.value)
  }
  console.log(`  « ${titre} » : ${hits.length} occurrence(s)`)
  for (const [g, vals] of parGabarit) console.log(`      ${g} = ${[...vals].join(" | ")}`)
  // Qui est concerné ? (index de data[] → personne)
  const gens = new Set<string>()
  for (const h of hits) {
    const m = /^data\[(\d+)\]/.exec(h.path)
    if (m && resources[Number(m[1])]) gens.add(nomDe(resources[Number(m[1])]))
  }
  if (gens.size) console.log(`      personnes : ${[...gens].join(", ")}`)
}

// ------------------------------------------------------------
//  Phase 2 — les endpoints DÉTAIL, fiche par fiche
// ------------------------------------------------------------
async function phaseDetail(jwt: string, resources: BoondResource[]) {
  const cibles = FULL ? resources : resources.slice(0, 10)
  console.log(`\n  Fiches détaillées : ${cibles.length}/${resources.length}${FULL ? "" : "  (--full pour toutes)"}`)
  const geo = new Map<string, Set<string>>()
  const trouves: string[] = []
  let ko = 0
  for (const r of cibles) {
    for (const suffixe of ["", "/information"]) {
      const { status, body } = await get(`${BASE}/resources/${r.id}${suffixe}`, jwt)
      if (status !== 200 || !body) {
        ko++
        continue
      }
      clesGeo(body, `resources/{id}${suffixe}`, geo)
      const hits: Hit[] = []
      scan(body, "", hits, VILLE)
      if (hits.length)
        trouves.push(`${nomDe(r)} — ${hits.slice(0, 3).map((h) => `${gabarit(h.path)}=${h.value}`).join(" | ")}`)
    }
  }
  if (ko) console.log(`  (${ko} appel(s) détail sans réponse exploitable)`)
  console.log(`  Champs « géographiques » rencontrés dans le détail :`)
  if (!geo.size) console.log("      (aucun)")
  for (const [p, vals] of [...geo.entries()].sort()) console.log(`      ${p} = ${[...vals].join(" | ")}`)
  console.log(`  Occurrences « Bordeaux & co » dans le détail : ${trouves.length}`)
  for (const t of trouves.slice(0, 30)) console.log(`      ${t}`)
}

// ------------------------------------------------------------
//  Phase 3 — endpoints de référentiel (existent-ils seulement ?)
// ------------------------------------------------------------
async function phaseReferentiel(jwt: string, unId: string) {
  const urls = [
    `${BASE}/agencies`,
    `${BASE}/poles`,
    `${BASE}/application/dictionary`,
    `${BASE}/application/settings`,
    `${BASE}/dictionary`,
    `${BASE}/resources/${unId}/administrative`,
    `${BASE}/resources/${unId}/rights`,
    `${BASE}/projects?maxResults=100&include=${encodeURIComponent("agency,pole,company")}`,
  ]
  for (const u of urls) {
    const { status, body } = await get(u, jwt)
    const court = u.replace(BASE, "")
    if (status !== 200 || !body) {
      console.log(`  ${court.padEnd(52)} HTTP ${status}`)
      continue
    }
    const hits: Hit[] = []
    scan(body, "", hits, VILLE)
    const g = new Map<string, Set<string>>()
    clesGeo(body, "", g)
    console.log(
      `  ${court.padEnd(52)} HTTP 200 · « Bordeaux » ${hits.length ? `TROUVÉ ×${hits.length}` : "absent"}`
    )
    for (const h of hits.slice(0, 6)) console.log(`        ${gabarit(h.path)} = ${h.value}`)
    for (const [p, vals] of [...g.entries()].slice(0, 8)) console.log(`        ${p} = ${[...vals].join(" | ")}`)
  }
}

// ------------------------------------------------------------
//  Phase 4 — recherche PLEIN TEXTE côté serveur : si le mot « Bordeaux » est
//  indexé quelque part (champ maison, commentaire, adresse…), Boond le sait.
// ------------------------------------------------------------
async function phaseMotCle(jwt: string) {
  for (const ressource of ["resources", "companies", "projects", "opportunities"]) {
    const { status, body } = await get(
      `${BASE}/${ressource}?maxResults=50&keywords=${encodeURIComponent("bordeaux")}`,
      jwt
    )
    if (status !== 200 || !body) {
      console.log(`  ${`${ressource}?keywords=bordeaux`.padEnd(40)} HTTP ${status}`)
      continue
    }
    const data = ((body as J).data ?? []) as BoondResource[]
    const total = (((body as J).meta as J)?.totals as J)?.rows
    const noms = data
      .slice(0, 12)
      .map((d) => nomDe(d) !== `#${d.id}` ? nomDe(d) : String(d.attributes?.name ?? d.attributes?.title ?? `#${d.id}`))
    console.log(
      `  ${`${ressource}?keywords=bordeaux`.padEnd(40)} ${data.length} résultat(s)` +
        `${typeof total === "number" ? ` / ${total}` : ""}${noms.length ? ` : ${noms.join(", ")}` : ""}`
    )
  }
}

// ------------------------------------------------------------
async function main() {
  const jetons: { label: string; token?: string }[] = [
    { label: "standard (BOOND_USER_TOKEN)", token: process.env.BOOND_USER_TOKEN },
    { label: "financier (BOOND_FINANCE_USER_TOKEN)", token: process.env.BOOND_FINANCE_USER_TOKEN },
  ]
  console.log("Jetons disponibles :")
  for (const j of jetons) console.log(`  ${j.label.padEnd(40)} ${empreinte(j.token)}`)
  const utilisables = jetons.filter((j) => j.token)
  if (!utilisables.length) {
    console.log("\nAucun jeton dans .env — rien à sonder.")
    return
  }
  if (utilisables.length === 2 && utilisables[0].token === utilisables[1].token)
    console.log("  ⚠ les deux jetons sont IDENTIQUES (même empreinte) : la comparaison sera vide.")

  for (const j of utilisables) {
    console.log(`\n════════ JETON ${j.label.toUpperCase()} ════════`)
    const jwt = buildJwt(j.token)
    const liste = await phaseListe(jwt, j.label)
    if (!liste) continue
    await phaseDetail(jwt, liste.resources)
    console.log("\n  Recherche plein texte « bordeaux » :")
    await phaseMotCle(jwt)
    console.log("\n  Référentiels :")
    await phaseReferentiel(jwt, String(liste.resources[0]?.id ?? "1"))
  }

  console.log(
    "\n────────────────────────────────────────────────────────" +
      "\nLecture du relevé :" +
      "\n· « Bordeaux » trouvé quelque part → me coller le CHEMIN affiché : la" +
      "\n  synchro ira le lire (une ligne dans lib/boond.ts + un test)." +
      "\n· « Bordeaux » absent avec LES DEUX jetons → BoondManager ne porte pas" +
      "\n  l'information : elle se saisit dans l'app (colonne Agence de /admin/" +
      "\n  personnes) ou se crée dans Boond (pôles « Paris » / « Bordeaux »)," +
      "\n  ce qui rallume aussi l'app Formation sans une ligne de code."
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
