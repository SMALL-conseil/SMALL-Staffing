// ============================================================
//  MOBILITÉ ENTRE AGENCES (a28) — « Charlotte est partie de Paris pour
//  Bordeaux : elle apparaît partie, et absente de Bordeaux. »
//  À LANCER EN LOCAL :
//      npx tsx scripts/boond-mobilite.ts                  (détection automatique)
//      npx tsx scripts/boond-mobilite.ts "Charlotte" "Anais Vanel"
//
//  Hypothèse à vérifier : un transfert d'agence crée une SECONDE fiche Boond
//  (nouvel identifiant, nouvelle agence), l'ancienne étant close. Côté app,
//  `@@unique([name, kind])` refuse alors la création de la seconde fiche
//  (« nom déjà porté par une autre fiche ») tandis que la première garde sa
//  date de départ : la personne paraît partie de SMALL, et n'arrive jamais à
//  Bordeaux. Cette sonde montre, pour chaque personne concernée, TOUTES ses
//  fiches Boond (y compris INACTIVES — la synchro, elle, les filtre) en regard
//  de ce que porte la base.
//  Lecture seule. Aucun secret affiché.
// ============================================================
import "dotenv/config"
import { PrismaClient } from "@prisma/client"
import { extractPerson, fetchResources, indexIncluded, normText, type BoondResource } from "../lib/boond"

const prisma = new PrismaClient()
const ARGS = process.argv.slice(2).filter((a) => !a.startsWith("--"))

const jour = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "—")

async function main() {
  if (!process.env.BOOND_CLIENT_TOKEN || !process.env.BOOND_CLIENT_KEY) {
    console.error(
      "\nSecrets Boond absents du .env (BOOND_CLIENT_TOKEN / BOOND_CLIENT_KEY," +
        "\net au moins un jeton utilisateur) — cette sonde lit le flux, elle ne peut" +
        "\nrien faire sans eux.\n"
    )
    process.exit(1)
  }
  const { resources, included, jeton } = await fetchResources()
  const idx = indexIncluded(included)
  console.log(`Flux lu par ${jeton} — ${resources.length} ressource(s).\n`)

  const fiches = resources.map((r: BoondResource) => ({ brut: r, p: extractPerson(r, idx) }))

  // --- Regroupement par personne : par email d'abord, sinon par nom normalisé
  const groupes = new Map<string, typeof fiches>()
  for (const f of fiches) {
    const cle = f.p.email ? `mail:${f.p.email}` : `nom:${normText(f.p.name)}`
    groupes.set(cle, [...(groupes.get(cle) ?? []), f])
  }
  // Un même nom sous deux emails différents reste une seule personne : second passage.
  const parNom = new Map<string, string[]>()
  for (const [cle, g] of groupes) {
    const n = normText(g[0].p.name)
    parNom.set(n, [...(parNom.get(n) ?? []), cle])
  }
  const fusion = new Map<string, typeof fiches>()
  for (const [nom, cles] of parNom) fusion.set(nom, cles.flatMap((c) => groupes.get(c) ?? []))

  // --- Qui regarder : les arguments, sinon toute personne à PLUSIEURS fiches
  const cibles = [...fusion.entries()].filter(([nom, g]) =>
    ARGS.length ? ARGS.some((a) => nom.includes(normText(a))) : g.length > 1
  )

  if (!cibles.length) {
    console.log(
      ARGS.length
        ? `Aucune fiche Boond ne correspond à : ${ARGS.join(", ")}`
        : "Aucune personne ne porte plusieurs fiches Boond — la mobilité ne passe donc PAS par un doublon de fiche."
    )
  }

  for (const [nom, g] of cibles) {
    console.log(`\n══ ${g[0].p.name} ══  (${g.length} fiche(s) Boond)`)
    for (const { p } of g.sort((a, b) => (a.p.arrival ?? "").localeCompare(b.p.arrival ?? ""))) {
      console.log(
        `  boondId ${String(p.boondId).padEnd(6)} agence ${String(p.agencyRaw ?? "—").padEnd(16)}` +
          ` → ${String(p.agency ?? "(non reconnue)").padEnd(10)} état ${String(p.state).padEnd(3)}` +
          `${p.activeState ? "ACTIVE " : "inactive"} titre « ${p.title ?? "—"} »`
      )
      console.log(
        `          arrivée ${p.arrival ?? "(détail)"} · départ ${p.departure ?? "—"}` +
          ` · email ${p.email ?? "—"}${p.excluded ? " · EXCLUE" : ""}`
      )
    }

    // --- Ce que porte la base, pour le même nom
    const enBase = await prisma.person.findMany({
      where: { name: { contains: g[0].p.name.split(" ")[0], mode: "insensitive" } },
      select: {
        id: true, name: true, kind: true, grade: true, agency: true,
        arrivalDate: true, departureDate: true, boondId: true, boondState: true,
      },
    })
    const mêmeNom = enBase.filter((e) => normText(e.name) === nom)
    console.log(`  — en base : ${mêmeNom.length} fiche(s)`)
    for (const e of mêmeNom) {
      const jours = await prisma.timeEntry.aggregate({
        where: { personId: e.id },
        _count: { _all: true },
        _min: { date: true },
        _max: { date: true },
      })
      console.log(
        `      ${e.kind.padEnd(10)} ${e.grade.padEnd(8)} agence ${String(e.agency ?? "(vide → Paris)").padEnd(16)}` +
          ` arrivée ${jour(e.arrivalDate)} · départ ${jour(e.departureDate)} · boondId ${e.boondId ?? "—"}`
      )
      console.log(
        `      ${jours._count._all} jour(s) de CRA` +
          (jours._count._all ? ` du ${jour(jours._min.date)} au ${jour(jours._max.date)}` : "")
      )
    }
    if (!mêmeNom.length) console.log("      (aucune — la personne n'existe pas dans le registre)")
  }

  // --- Effectif de l'agence Bordeaux vu par Boond, et son sort côté app
  const bdx = fiches.filter((f) => f.p.agency === "BORDEAUX")
  console.log(`\n══ Agence BORDEAUX vue par Boond : ${bdx.length} fiche(s) ══`)
  for (const { p } of bdx) {
    const e = await prisma.person.findFirst({
      where: { OR: [{ boondId: p.boondId }, ...(p.email ? [{ email: p.email }] : [])] },
      select: { name: true, kind: true, agency: true, departureDate: true, boondId: true },
    })
    const etat = !e
      ? "ABSENTE du registre"
      : `en base : agence ${e.agency ?? "(vide → Paris)"}${e.departureDate ? `, partie le ${jour(e.departureDate)}` : ""}` +
        `${e.boondId === p.boondId ? "" : ` (rattachée au boondId ${e.boondId ?? "—"})`}`
    console.log(
      `  ${p.name.padEnd(26)} état ${String(p.state).padEnd(3)}${p.activeState ? "ACTIVE " : "inactive"} → ${etat}`
    )
  }

  console.log(
    "\n────────────────────────────────────────────────────────" +
      "\nLecture :" +
      "\n· Plusieurs fiches Boond pour une personne = la mobilité se lit dans les" +
      "\n  DATES (fiche Paris close, fiche Bordeaux ouverte). C'est exploitable" +
      "\n  tel quel par le moteur (fenêtres arrivée/départ), à condition que la" +
      "\n  base accepte deux fiches de même nom." +
      "\n· Une seule fiche dont l'agence a changé = aucune date de transfert dans" +
      "\n  Boond : il faudra la saisir, ou accepter que l'historique suive la" +
      "\n  personne dans sa nouvelle agence."
  )
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
