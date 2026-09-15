// ============================================================
//  Relevé des AGENCES du tenant Boond (s5) — À LANCER EN LOCAL :
//      npx tsx scripts/boond-inspect-agences.ts
//  Le tenant expose deux relations candidates sur 65/65 ressources :
//  « agency » et « pole ». Laquelle porte Paris / Bordeaux ? Ce relevé les
//  affiche toutes les deux, par personne et en histogramme, pour figer
//  BOOND_AGENCY_REL (.env) avant la première synchro des agences.
//  Lecture seule, aucun secret affiché.
// ============================================================
import "dotenv/config"
import { buildJwt, normalizeAgency, type BoondResource } from "../lib/boond"

const BASE = process.env.BOOND_BASE_URL || "https://ui.boondmanager.com/api"
const JWT_HEADER = process.env.BOOND_JWT_HEADER || "X-Jwt-Client-BoondManager"
const CANDIDATES = ["agency", "pole", "businessUnit", "division"]

type J = Record<string, unknown>

async function main() {
  const headers = { [JWT_HEADER]: buildJwt(), Accept: "application/json" }
  const resources: BoondResource[] = []
  const included: BoondResource[] = []
  for (let page = 1; page <= 20; page++) {
    const url =
      `${BASE}/resources?page=${page}&maxResults=100&maxPerPage=100` +
      `&include=${encodeURIComponent(CANDIDATES.join(","))}`
    const res = await fetch(url, { headers, cache: "no-store" })
    if (!res.ok) {
      console.log(`/resources → HTTP ${res.status} (page ${page})`)
      return
    }
    const payload = (await res.json()) as J
    const data = (payload.data ?? []) as BoondResource[]
    resources.push(...data)
    included.push(...((payload.included ?? []) as BoondResource[]))
    const total = ((payload.meta as J)?.totals as J)?.rows
    if (!data.length || (typeof total === "number" && resources.length >= total)) break
  }

  const idx = new Map<string, BoondResource>()
  for (const i of included) idx.set(`${String(i.type)}#${String(i.id)}`, i)
  console.log(`Ressources : ${resources.length} · section included : ${included.length} objet(s)\n`)

  const types = new Map<string, number>()
  for (const i of included) types.set(String(i.type), (types.get(String(i.type)) ?? 0) + 1)
  console.log("Types présents dans `included` :")
  for (const [t, n] of types) console.log(`  ${t} × ${n}`)

  // Histogramme par relation candidate
  for (const rel of CANDIDATES) {
    const hist = new Map<string, number>()
    let presents = 0
    for (const r of resources) {
      const id = r.relationships?.[rel]?.data?.id
      if (id === undefined || id === null) continue
      presents++
      const obj = idx.get(`${rel}#${String(id)}`) ?? idx.get(`agency#${String(id)}`)
      const nom = obj?.attributes?.name ? String(obj.attributes.name) : `(#${String(id)}, nom non résolu)`
      hist.set(nom, (hist.get(nom) ?? 0) + 1)
    }
    console.log(`\nRelation « ${rel} » — présente sur ${presents}/${resources.length} ressource(s) :`)
    if (!hist.size) {
      console.log("  (aucun contenu — relation absente ou non incluse)")
      continue
    }
    for (const [nom, n] of [...hist.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${nom.padEnd(40)} × ${String(n).padStart(3)}   → normalisé : ${normalizeAgency(nom) ?? "NON RECONNU"}`)
    }
  }

  // Échantillon nominatif : 12 personnes, leurs deux relations
  console.log("\nÉchantillon (12 personnes) :")
  for (const r of resources.slice(0, 12)) {
    const a = r.attributes ?? {}
    const nom = `${String(a.firstName ?? "")} ${String(a.lastName ?? "")}`.trim()
    const parRel = CANDIDATES.map((rel) => {
      const id = r.relationships?.[rel]?.data?.id
      if (id === undefined || id === null) return `${rel}=∅`
      const obj = idx.get(`${rel}#${String(id)}`) ?? idx.get(`agency#${String(id)}`)
      return `${rel}=${obj?.attributes?.name ? String(obj.attributes.name) : `#${String(id)}`}`
    }).join(" · ")
    console.log(`  ${nom.padEnd(28)} ${parRel}`)
  }

  console.log(
    "\n→ Figer la bonne relation dans .env : BOOND_AGENCY_REL=\"agency\" (ou \"pole\"…)." +
      "\n→ Un libellé « NON RECONNU » n'écrit rien (les agences saisies dans l'app" +
      "\n  survivent). S'il ne porte simplement AUCUNE ville — cas d'un tenant à une" +
      "\n  seule agence —, le déclarer sans information pour qu'il cesse d'être" +
      "\n  signalé à chaque synchro :   BOOND_AGENCY_MAP=\"SMALL=\"" +
      "\n  (et pour forcer un libellé :  BOOND_AGENCY_MAP=\"SMALL Sud-Ouest=BORDEAUX\")" +
      "\n→ Puis relancer une RÉPÉTITION de la synchro des personnes."
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
