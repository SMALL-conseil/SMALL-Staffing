// ============================================================
//  ANNULER LES MISSIONS CRÉÉES DEPUIS LES PROPOSITIONS BOOND (a33)
//      npx tsx scripts/annuler-propositions.ts                    (répétition)
//      npx tsx scripts/annuler-propositions.ts --appliquer
//      npx tsx scripts/annuler-propositions.ts --agence PARIS --appliquer
//      npx tsx scripts/annuler-propositions.ts --depuis 2026-09-15 --appliquer
//
//  RÉPÉTITION PAR DÉFAUT : rien n'est supprimé sans --appliquer.
//
//  Pourquoi ce script existe : les missions créées par la carte « Missions
//  proposées par Boond » (s8) portent toutes la note « Prestation Boond <id> ».
//  Elles sont donc reconnaissables une par une, et REMBOBINABLES — c'est la
//  contrepartie d'un écran qui écrit au registre. Une mission SAISIE À LA MAIN
//  n'a jamais cette note : elle ne peut pas être emportée par cette commande.
//
//  `--agence` permet de ne défaire qu'un périmètre (rendre Paris exactement à
//  son état d'avant, en gardant ce qui a été fait pour Bordeaux, par exemple).
// ============================================================
import "dotenv/config"
import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()
const NOTE = "Prestation Boond"

const iso = (d: Date) => d.toISOString().slice(0, 10)

async function main() {
  const args = process.argv.slice(2)
  const appliquer = args.includes("--appliquer")
  const iAgence = args.indexOf("--agence")
  const agence = iAgence === -1 ? null : (args[iAgence + 1] ?? "").toUpperCase()
  const iDepuis = args.indexOf("--depuis")
  const depuis = iDepuis === -1 ? null : args[iDepuis + 1]

  if (agence && !["PARIS", "BORDEAUX"].includes(agence)) {
    console.error("\n--agence attend PARIS ou BORDEAUX.\n")
    process.exit(1)
  }
  if (depuis && !/^\d{4}-\d{2}-\d{2}$/.test(depuis)) {
    console.error("\n--depuis attend une date AAAA-MM-JJ (date de CRÉATION de la mission).\n")
    process.exit(1)
  }

  const toutes = await prisma.mission.findMany({
    where: {
      note: { startsWith: NOTE },
      ...(depuis ? { createdAt: { gte: new Date(`${depuis}T00:00:00.000Z`) } } : {}),
    },
    include: { person: { select: { name: true, agency: true } } },
    orderBy: { createdAt: "asc" },
  })

  // L'agence NULLE vaut Paris en lecture (décision s5) : une fiche sans agence
  // appartient au périmètre parisien, et doit donc suivre « --agence PARIS ».
  const cibles = agence
    ? toutes.filter((m) => (m.person.agency ?? "PARIS") === agence)
    : toutes

  console.log(
    `${appliquer ? "SUPPRESSION" : "RÉPÉTITION (rien n'est supprimé)"} — missions créées depuis une proposition Boond` +
      `${agence ? `, agence ${agence}` : ""}${depuis ? `, créées depuis le ${depuis}` : ""}\n`
  )
  console.log(`  ${toutes.length} mission(s) portent la note « ${NOTE} … »`)
  console.log(`  ${cibles.length} retenue(s) par les filtres\n`)

  for (const m of cibles) {
    console.log(
      `      ${m.person.name.slice(0, 22).padEnd(24)} ${m.client.slice(0, 26).padEnd(28)}` +
        ` ${iso(m.startDate)} → ${iso(m.endDate)}  part ${m.share}  ${m.fees ?? "—"} €/j` +
        `  (créée le ${iso(m.createdAt)}, agence ${m.person.agency ?? "vide → Paris"})`
    )
  }

  if (!cibles.length) {
    console.log("  Rien à annuler.")
    return
  }
  if (!appliquer) {
    console.log(
      "\n→ Relancer avec --appliquer pour supprimer ces missions." +
        "\n  (les missions SAISIES À LA MAIN ne portent pas cette note : elles ne peuvent" +
        "\n   pas être emportées par cette commande)"
    )
    return
  }

  const res = await prisma.mission.deleteMany({ where: { id: { in: cibles.map((m) => m.id) } } })
  console.log(`\n✔ ${res.count} mission(s) supprimée(s). Le registre revient à son état d'avant.`)
  console.log("  (les jours de CRA ne sont pas touchés — eux ne dépendent pas des missions)")
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
