// ============================================================
//  Relevé du tenant Boond — À LANCER EN LOCAL au premier branchement :
//      npx tsx scripts/boond-inspect.ts
//  (secrets BOOND_* dans .env). Affiche :
//   1. les clés d'attributs des RESSOURCES (personnes), histogrammes
//      state/typeOf, titres bruts — pour figer BOOND_TITLE_FIELD /
//      ARRIVAL / DEPARTURE / ACTIVE_STATES / INDEP_TYPEOF ;
//   2. un SONDAGE des endpoints « jours de staffing » (livraisons,
//      positionnements, projets, CRA) : statut HTTP, volumétrie, clés
//      d'attributs, échantillon — pour cadrer la synchro des jours (v2).
//  Aucune écriture en base, aucun secret affiché.
// ============================================================
import "dotenv/config"
import {
  buildJwt,
  extractPerson,
  fetchResources,
  pickArrival,
  pickDeparture,
  pickTitle,
} from "../lib/boond"

const BASE = process.env.BOOND_BASE_URL || "https://ui.boondmanager.com/api"
const JWT_HEADER = process.env.BOOND_JWT_HEADER || "X-Jwt-Client-BoondManager"

/** Sonde le DÉTAIL d'un objet : statut + clés d'attributs datées uniquement. */
async function probeDetail(path: string): Promise<void> {
  try {
    const res = await fetch(`${BASE}/${path}`, {
      headers: { [JWT_HEADER]: buildJwt(), Accept: "application/json" },
      cache: "no-store",
    })
    if (!res.ok) {
      console.log(`  /${path} → HTTP ${res.status}`)
      return
    }
    const payload = await res.json()
    const a: Record<string, unknown> = payload?.data?.attributes ?? {}
    const keys = Object.keys(a)
    console.log(`  /${path} → HTTP 200 · ${keys.length} attribut(s)`)
    const dateish = Object.fromEntries(
      Object.entries(a).filter(
        ([k, v]) => /date|entry|exit|hiring|contract|start|end/i.test(k) && v !== null && v !== ""
      )
    )
    console.log(`     champs datés non vides : ${JSON.stringify(dateish) || "(aucun)"}`)
  } catch (e) {
    console.log(`  /${path} → erreur : ${e instanceof Error ? e.message : e}`)
  }
}

/** Sonde en LECTURE un endpoint : statut, total, clés, mini-échantillon. */
async function probe(path: string): Promise<void> {
  const url = `${BASE}/${path}?page=1&maxResults=3&maxPerPage=3`
  try {
    const res = await fetch(url, {
      headers: { [JWT_HEADER]: buildJwt(), Accept: "application/json" },
      cache: "no-store",
    })
    if (!res.ok) {
      console.log(`  /${path} → HTTP ${res.status} (non exploitable en l'état)`)
      return
    }
    const payload = await res.json()
    const data: { id?: unknown; attributes?: Record<string, unknown>; relationships?: Record<string, unknown> }[] =
      payload.data ?? []
    const total = payload?.meta?.totals?.rows ?? "?"
    console.log(`  /${path} → HTTP 200 · ${total} ligne(s) au total`)
    if (data.length) {
      const a = data[0].attributes ?? {}
      console.log(`     clés d'attributs : ${Object.keys(a).join(", ") || "(aucune)"}`)
      const rels = Object.keys(data[0].relationships ?? {})
      if (rels.length) console.log(`     relations : ${rels.join(", ")}`)
      const extrait = Object.fromEntries(
        Object.entries(a)
          .filter(([k]) => /date|state|rate|occupation|day|nb|number|title/i.test(k))
          .slice(0, 8)
      )
      console.log(`     échantillon filtré : ${JSON.stringify(extrait)}`)
    }
  } catch (e) {
    console.log(`  /${path} → erreur d'appel : ${e instanceof Error ? e.message : e}`)
  }
}

async function main() {
  const { resources, pages } = await fetchResources()
  console.log(`Ressources reçues : ${resources.length} (${pages} page${pages > 1 ? "s" : ""})\n`)
  if (!resources.length) return

  const keys = new Map<string, number>()
  const states = new Map<string, number>()
  const typeofs = new Map<string, number>()
  const titles = new Map<string, number>()
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1)

  for (const r of resources) {
    const a = r.attributes ?? {}
    for (const k of Object.keys(a)) bump(keys, k)
    bump(states, String(a.state ?? "∅"))
    bump(typeofs, String(a.typeOf ?? "∅"))
    const t = pickTitle(a)
    if (t) bump(titles, t)
  }

  const show = (label: string, m: Map<string, number>) => {
    console.log(`${label} :`)
    for (const [k, n] of [...m.entries()].sort((x, y) => y[1] - x[1])) console.log(`  ${k} × ${n}`)
    console.log()
  }
  show("Clés d'attributs (fréquence)", keys)
  show("state (1 = à venir, 2 = IC, 3 = en mission — à confirmer)", states)
  show("typeOf (repérer les indépendants → BOOND_INDEP_TYPEOF)", typeofs)
  show("Titres BRUTS relevés (deviendront les grades)", titles)

  console.log("Échantillon (3 premières ressources, sans email) :")
  for (const r of resources.slice(0, 3)) {
    const p = extractPerson(r)
    const a = r.attributes ?? {}
    console.log(`  #${p.boondId} ${p.name} · titre=${p.title ?? "∅"} · state=${p.state} · typeOf=${p.typeOf}`)
    console.log(`     arrivée détectée=${pickArrival(a) ?? "∅"} · départ détecté=${pickDeparture(a) ?? "∅"}`)
  }

  console.log("\n=== Sondage « jours de staffing » (lecture seule) ===")
  for (const path of ["deliveries", "positionings", "projects", "timesreports", "times", "opportunities"]) {
    await probe(path)
  }

  // Le listing /resources n'expose pas les dates d'arrivée/départ (relevé du
  // 13/08) : on sonde le DÉTAIL d'une ressource pour voir si elles y sont.
  if (resources.length) {
    const id = resources[0].id
    console.log(`\n=== Détail d'une ressource (#${id}) — recherche des dates contrat ===`)
    for (const path of [`resources/${id}`, `resources/${id}/information`, `resources/${id}/administrative`]) {
      await probeDetail(path)
    }
  }

  console.log("\n→ figer les BOOND_* dans .env puis tester : bouton « Répétition (dry run) » de /admin/personnes.")
  console.log("→ coller TOUTE cette sortie à Claude : le sondage décidera de la synchro des jours de staffing.")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
