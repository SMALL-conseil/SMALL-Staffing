// ============================================================
//  LES PRESTATIONS BOOND PEUVENT-ELLES FABRIQUER DES MISSIONS ? (a31)
//      npx tsx scripts/boond-missions-possibles.ts [nombre]
//
//  En v1, les missions se saisissent dans l'app : le classeur Excel les portait
//  pour Paris, personne ne les a jamais saisies pour Bordeaux. D'où l'attente
//  légitime : « avec le jeton financier, on devrait les voir ».
//
//  Une MISSION de l'app, c'est : une personne, un client, une date de début,
//  une date de fin, une part d'intervention (0–1) et des honoraires. Une
//  PRESTATION Boond (/deliveries) porte déjà le titre, les dates, le TJM vendu
//  et les jours vendus. Restent deux inconnues à vérifier sur pièce :
//    · la RESSOURCE (qui fait la mission) est-elle dans la charge utile ?
//    · la PART d'intervention (temps partiel, mi-temps) y figure-t-elle, ou
//      faut-il la déduire des jours vendus rapportés aux jours ouvrés ?
//
//  Cette sonde liste, pour un échantillon de prestations réellement pointées
//  dans les CRA : toutes les CLÉS d'attributs et de relations rencontrées, les
//  valeurs des candidates, et ce que donnerait la mission correspondante.
//  Lecture seule, AUCUN coût ni marge affiché (décision du 15/09).
// ============================================================
import "dotenv/config"
import { PrismaClient } from "@prisma/client"
import { buildJwt } from "../lib/boond"

const prisma = new PrismaClient()
const BASE = process.env.BOOND_BASE_URL || "https://ui.boondmanager.com/api"
const JWT_HEADER = process.env.BOOND_JWT_HEADER || "X-Jwt-Client-BoondManager"
const TOKEN = (process.env.BOOND_FINANCE_USER_TOKEN || "").trim() || undefined
const COMBIEN = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)) ?? 8)

// Clés dont le nom sent la ressource ou la quotité — ce qu'on cherche.
const CLE_UTILE = /resource|consultant|employee|staff|occupation|rate|percent|quantit|workunit|time|day|duration/i
// Jamais affiché : la décision du 15/09 interdit d'IMPORTER coûts et marges ;
// on ne les met pas non plus sous les yeux d'un relevé qui circule.
const CLE_INTERDITE = /cost|margin|profit|salary|salaire|purchase/i

type J = Record<string, unknown>

async function get(path: string): Promise<{ status: number; payload: J | null }> {
  const res = await fetch(`${BASE}/${path}`, {
    headers: { [JWT_HEADER]: buildJwt(TOKEN), Accept: "application/json" },
    cache: "no-store",
  })
  return { status: res.status, payload: res.ok ? ((await res.json()) as J) : null }
}

const court = (v: unknown, n = 42) => {
  const s = typeof v === "object" ? JSON.stringify(v) : String(v)
  return s.length > n ? `${s.slice(0, n)}…` : s
}

async function main() {
  if (!process.env.BOOND_CLIENT_TOKEN || !process.env.BOOND_CLIENT_KEY) {
    console.error(
      "\nSecrets Boond absents du .env (BOOND_CLIENT_TOKEN / BOOND_CLIENT_KEY et un" +
        "\njeton utilisateur) — cette sonde lit les prestations, elle ne peut rien" +
        "\nfaire sans eux.\n"
    )
    process.exit(1)
  }
  if (!TOKEN) {
    console.log(
      "⚠ BOOND_FINANCE_USER_TOKEN absent : les prestations répondront 403 " +
        "(le jeton standard ne voit pas le financier).\n"
    )
  }

  // Les prestations réellement pointées : c'est le seul moyen de les énumérer
  // (le listing /deliveries répond 405, relevé du 15/09).
  const lignes = await prisma.timeEntry.groupBy({
    by: ["deliveryBoondId", "clientName"],
    where: { deliveryBoondId: { not: null }, activityType: "production" },
    _count: { _all: true },
    orderBy: { _count: { deliveryBoondId: "desc" } },
    take: COMBIEN,
  })
  if (!lignes.length) {
    console.log(
      "Aucune prestation dans les jours de CRA en base.\n" +
        "→ appliquer s6 puis RECHARGER l'historique des CRA (les lignes d'avant s6\n" +
        "  ne portent pas l'identifiant de prestation)."
    )
    return
  }
  console.log(`${lignes.length} prestation(s) échantillonnée(s), les plus pointées d'abord.\n`)

  const clesAttr = new Map<string, Set<string>>()
  const clesRel = new Map<string, Set<string>>()

  for (const l of lignes) {
    const id = String(l.deliveryBoondId)
    const { status, payload } = await get(`deliveries/${id}`)
    if (status !== 200 || !payload) {
      console.log(`  deliveries/${id} → HTTP ${status}`)
      continue
    }
    const data = (payload.data ?? {}) as J
    const attrs = (data.attributes ?? {}) as J
    const rels = (data.relationships ?? {}) as J

    for (const [k, v] of Object.entries(attrs)) {
      if (CLE_INTERDITE.test(k)) continue
      if (!clesAttr.has(k)) clesAttr.set(k, new Set())
      const s = clesAttr.get(k)!
      if (s.size < 4) s.add(court(v, 30))
    }
    for (const [k, v] of Object.entries(rels)) {
      if (CLE_INTERDITE.test(k)) continue
      if (!clesRel.has(k)) clesRel.set(k, new Set())
      const s = clesRel.get(k)!
      const d = (v as J)?.data as J | null
      if (s.size < 4) s.add(d ? `${String(d.type ?? "?")}#${String(d.id ?? "?")}` : "∅")
    }

    // Ce que donnerait la mission
    const nomRessource = await (async () => {
      const rel = (rels.resource ?? rels.dependsOn) as J | undefined
      const rid = (rel?.data as J | undefined)?.id
      if (rid === undefined || rid === null) return "(aucune relation ressource)"
      const r = await get(`resources/${String(rid)}`)
      if (r.status !== 200) return `#${String(rid)} (HTTP ${r.status})`
      const a = ((r.payload?.data as J)?.attributes ?? {}) as J
      return `${String(a.firstName ?? "")} ${String(a.lastName ?? "")}`.trim() || `#${String(rid)}`
    })()

    console.log(
      `  prestation ${id.padEnd(6)} « ${court(attrs.title, 34)} »  ${court(attrs.startDate, 10)} → ${court(attrs.endDate, 10)}` +
        `\n      client CRA : ${l.clientName ?? "—"} · ${l._count._all} jour(s) pointé(s)` +
        `\n      ressource  : ${nomRessource}` +
        `\n      TJM vendu  : ${court(attrs.averageDailyPriceExcludingTax)} · jours vendus : ${court(attrs.numberOfDaysInvoicedOrQuantity)}`
    )
  }

  console.log("\n── Clés d'ATTRIBUTS rencontrées (coûts et marges volontairement masqués) ──")
  for (const [k, v] of [...clesAttr.entries()].sort()) {
    const marque = CLE_UTILE.test(k) ? " ←" : ""
    console.log(`  ${k.padEnd(38)} ${[...v].join(" | ")}${marque}`)
  }
  console.log("\n── Clés de RELATIONS rencontrées ──")
  for (const [k, v] of [...clesRel.entries()].sort()) {
    const marque = CLE_UTILE.test(k) ? " ←" : ""
    console.log(`  ${k.padEnd(38)} ${[...v].join(" | ")}${marque}`)
  }
  console.log(
    "\nLecture :" +
      "\n· une relation « resource » renseignée = les missions sont fabricables" +
      "\n  automatiquement (personne + client + dates + TJM), Bordeaux compris ;" +
      "\n· sinon, il reste le rapprochement par les CRA (scripts/missions-suggerees.ts)," +
      "\n  qui sait tout dire SAUF la date de fin." +
      "\n· une clé de quotité (occupationRate, percent…) éviterait de déduire la part" +
      "\n  d'intervention des jours vendus."
  )
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
