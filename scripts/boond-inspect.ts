// ============================================================
//  Relevé du tenant Boond — À LANCER EN LOCAL au premier branchement :
//      npx tsx scripts/boond-inspect.ts
//  (secrets BOOND_* dans .env). Affiche les clés d'attributs réellement
//  exposées, les histogrammes state/typeOf et un échantillon anonyme, pour
//  FIGER les variables BOOND_TITLE_FIELD / BOOND_ARRIVAL_FIELD /
//  BOOND_DEPARTURE_FIELD / BOOND_ACTIVE_STATES / BOOND_INDEP_TYPEOF.
//  Aucune écriture en base, aucun secret affiché.
// ============================================================
import "dotenv/config"
import { fetchResources, extractPerson, pickArrival, pickDeparture, pickTitle } from "../lib/boond"

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
  console.log("\n→ figer les BOOND_* dans .env puis tester : bouton « Répétition (dry run) » de /admin/personnes.")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
