// ============================================================
//  TRANSFERT D'AGENCE (s7) — découpe une fiche en DEUX périodes datées :
//  l'agence d'origine jusqu'à la veille, la nouvelle à partir du jour dit.
//
//      npx tsx scripts/transfert.ts                                  (candidats)
//      npx tsx scripts/transfert.ts "Charlotte Guay" --vers BORDEAUX --le 2025-11-15
//      npx tsx scripts/transfert.ts "Charlotte Guay" --vers BORDEAUX --le 2025-11-15 --appliquer
//      npx tsx scripts/transfert.ts --tous --vers BORDEAUX           (tous les candidats)
//
//  RÉPÉTITION PAR DÉFAUT : rien n'est écrit sans --appliquer.
//
//  Sans argument, le script propose les CANDIDATS : les fiches que la base
//  croit parties alors que Boond les dit actives. C'est la signature d'un
//  transfert — le classeur « Staffing SMALL Paris » enregistrait un départ dès
//  qu'on quittait Paris, et sa date de départ EST la date du transfert. Le
//  script la reprend par défaut (le lendemain du départ enregistré) : aucune
//  date à retrouver.
//
//  Ce qui bouge :
//   · la fiche existante devient la période D'ORIGINE : agence d'avant, départ
//     à la veille, et elle rend son boondId et son email à la période courante
//     (un seul porteur possible — et c'est la fiche en cours qui doit répondre
//     aux synchros comme au rapprochement des comptes) ;
//   · une NOUVELLE fiche porte la période courante, reliée par `previousId` ;
//   · missions, absences et jours de CRA sont répartis par DATE. Une mission ou
//     une absence À CHEVAL sur la date de transfert n'est pas coupée d'office :
//     elle reste sur la période d'origine et elle est SIGNALÉE — au siège de
//     décider (les deux moitiés n'ont pas le même client ni le même sens).
// ============================================================
import "dotenv/config"
import { PrismaClient } from "@prisma/client"
import { lendemainDe, planifieTransfert } from "../lib/mobilite"

const prisma = new PrismaClient()
const AGENCES = ["PARIS", "BORDEAUX"]
const ETATS_ACTIFS = (process.env.BOOND_ACTIVE_STATES || "1,2,3,5,7").split(",").map((s) => s.trim())

class ErreurUtilisateur extends Error {}

const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null)
const jour = (s: string) => new Date(`${s}T00:00:00.000Z`)

function arg(nom: string): string | undefined {
  const i = process.argv.indexOf(nom)
  return i === -1 ? undefined : process.argv[i + 1]
}

/** Fiches que la base croit parties alors que Boond les dit actives. */
async function candidats() {
  const gens = await prisma.person.findMany({
    where: { departureDate: { not: null }, boondId: { not: null }, previousId: null },
    select: {
      id: true, name: true, kind: true, grade: true, agency: true,
      arrivalDate: true, departureDate: true, boondId: true, boondState: true,
    },
    orderBy: { name: "asc" },
  })
  return gens.filter((g) => g.boondState && ETATS_ACTIFS.includes(g.boondState))
}

async function main() {
  const appliquer = process.argv.includes("--appliquer")
  const tous = process.argv.includes("--tous")
  const vers = (arg("--vers") ?? "").toUpperCase()
  const le = arg("--le")
  const noms = process.argv
    .slice(2)
    .filter((a, i, t) => !a.startsWith("--") && !(i > 0 && ["--vers", "--le"].includes(t[i - 1])))

  const liste = await candidats()

  if (!noms.length && !tous) {
    console.log(`Candidats au transfert — ${liste.length} fiche(s)`)
    console.log("(parties en base, ACTIVES dans Boond : signature d'un changement d'agence)\n")
    for (const c of liste) {
      console.log(
        `  ${c.name.padEnd(28)} ${c.kind.padEnd(10)} agence ${String(c.agency ?? "—").padEnd(10)}` +
          ` arrivée ${iso(c.arrivalDate)} · départ ${iso(c.departureDate)} · état Boond ${c.boondState}`
      )
      console.log(
        `      → transfert proposé le ${lendemainDe(iso(c.departureDate) as string)}` +
          ` (lendemain du départ enregistré)`
      )
    }
    if (!liste.length) console.log("  (aucun)")
    console.log(
      `\n→ npx tsx scripts/transfert.ts "${liste[0]?.name ?? "Nom Prénom"}" --vers BORDEAUX` +
        `\n  (ajouter --le AAAA-MM-JJ pour forcer une autre date, --appliquer pour écrire,` +
        `\n   --tous pour traiter tous les candidats d'un coup)`
    )
    return
  }

  if (!AGENCES.includes(vers)) throw new ErreurUtilisateur(`--vers attend ${AGENCES.join(" ou ")}.`)

  const cibles = tous
    ? liste
    : liste.filter((c) => noms.some((n) => c.name.toLowerCase().includes(n.toLowerCase())))
  if (!cibles.length) {
    const inconnus = noms.join(", ")
    throw new ErreurUtilisateur(
      `Aucun candidat ne correspond à : ${inconnus}\n` +
        `  (lancer le script sans argument pour voir la liste des candidats)`
    )
  }

  console.log(`${appliquer ? "ÉCRITURE" : "RÉPÉTITION (rien n'est écrit)"} — transfert vers « ${vers} »\n`)

  for (const c of cibles) {
    const depart = iso(c.departureDate) as string
    const dateTransfert = le ?? lendemainDe(depart)
    const agenceAvant = c.agency && c.agency !== vers ? c.agency : vers === "BORDEAUX" ? "PARIS" : "BORDEAUX"

    let plan
    try {
      plan = planifieTransfert({
        arrival: iso(c.arrivalDate) as string,
        departure: depart,
        dateTransfert,
        agenceAvant,
        agenceApres: vers,
      })
    } catch (e) {
      console.log(`  ✗ ${c.name} : ${e instanceof Error ? e.message : "plan impossible"}`)
      continue
    }

    // Répartition par date
    const veille = jour(plan.historique.departure)
    const bascule = jour(plan.courante.arrival)
    const [missions, absences, joursAvant, joursApres] = await Promise.all([
      prisma.mission.findMany({ where: { personId: c.id }, select: { id: true, client: true, startDate: true, endDate: true } }),
      prisma.longAbsence.findMany({ where: { personId: c.id }, select: { id: true, startDate: true, endDate: true } }),
      prisma.timeEntry.count({ where: { personId: c.id, date: { lte: veille } } }),
      prisma.timeEntry.count({ where: { personId: c.id, date: { gte: bascule } } }),
    ])
    const missionsApres = missions.filter((m) => m.startDate >= bascule)
    const missionsACheval = missions.filter((m) => m.startDate < bascule && (!m.endDate || m.endDate >= bascule))
    const absencesApres = absences.filter((a) => a.startDate >= bascule)
    const absencesACheval = absences.filter((a) => a.startDate < bascule && (!a.endDate || a.endDate >= bascule))

    console.log(`  ${c.name} (${c.kind}, ${c.grade})`)
    console.log(
      `      ${agenceAvant.padEnd(9)} ${plan.historique.arrival} → ${plan.historique.departure}` +
        `   (période close, conservée)`
    )
    console.log(
      `      ${vers.padEnd(9)} ${plan.courante.arrival} → en cours   ` +
        `(nouvelle fiche : boondId ${c.boondId}, email et TJM repris)`
    )
    console.log(
      `      jours de CRA : ${joursAvant} avant / ${joursApres} après · ` +
        `missions déplacées : ${missionsApres.length} · absences déplacées : ${absencesApres.length}`
    )
    for (const m of missionsACheval) {
      console.log(
        `      ⚠ mission à cheval — ${m.client} (${iso(m.startDate)} → ${iso(m.endDate) ?? "…"}) :` +
          ` laissée sur ${agenceAvant}, à couper à la main si elle doit l'être`
      )
    }
    for (const a of absencesACheval) {
      console.log(`      ⚠ absence à cheval (${iso(a.startDate)} → ${iso(a.endDate) ?? "…"}) : laissée sur ${agenceAvant}`)
    }

    if (!appliquer) continue

    await prisma.$transaction(async (tx) => {
      const source = await tx.person.findUnique({ where: { id: c.id } })
      if (!source) throw new Error(`Fiche ${c.name} introuvable`)

      // 1. La fiche existante redevient la période D'ORIGINE et rend ses clés.
      await tx.person.update({
        where: { id: source.id },
        data: {
          agency: plan.historique.agency,
          departureDate: jour(plan.historique.departure),
          boondId: null,
          email: null,
          boondState: null,
        },
      })

      // 2. La période courante, reliée à la précédente.
      const courante = await tx.person.create({
        data: {
          name: source.name,
          email: source.email,
          kind: source.kind,
          grade: source.grade,
          arrivalDate: jour(plan.courante.arrival),
          departureDate: null,
          managerId: source.managerId,
          boondId: source.boondId,
          boondState: source.boondState,
          agency: plan.courante.agency,
          defaultDailyRate: source.defaultDailyRate,
          boondSyncedAt: source.boondSyncedAt,
          previousId: source.id,
        },
      })

      // 3. Répartition par date — ce qui commence APRÈS la bascule suit la personne.
      if (missionsApres.length)
        await tx.mission.updateMany({ where: { id: { in: missionsApres.map((m) => m.id) } }, data: { personId: courante.id } })
      if (absencesApres.length)
        await tx.longAbsence.updateMany({ where: { id: { in: absencesApres.map((a) => a.id) } }, data: { personId: courante.id } })
      await tx.timeEntry.updateMany({ where: { personId: source.id, date: { gte: bascule } }, data: { personId: courante.id } })

      // 4. Les managées suivent la fiche en cours (le lien hiérarchique est vivant).
      await tx.person.updateMany({ where: { managerId: source.id }, data: { managerId: courante.id } })
    })
    console.log(`      ✔ transfert écrit.`)
  }

  if (!appliquer) console.log("\n→ Relancer avec --appliquer pour écrire.")
  else
    console.log(
      "\nPenser à recharger les jours de CRA (les jours antérieurs au transfert" +
        "\nse rattacheront alors d'eux-mêmes à la période d'origine)."
    )
}

main()
  .catch((e) => {
    if (e instanceof ErreurUtilisateur) {
      console.error(`\n${e.message}\n`)
      process.exit(1)
    }
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
