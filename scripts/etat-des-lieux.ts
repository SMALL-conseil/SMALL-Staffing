// ============================================================
//  ÉTAT DES LIEUX (a33) — ce que les derniers lots ont RÉELLEMENT écrit.
//      npx tsx scripts/etat-des-lieux.ts
//
//  LECTURE SEULE, rien n'est modifié. À lancer avant toute correction :
//  il faut savoir ce qui a bougé avant de décider quoi défaire.
//
//  Répond à trois questions, dans l'ordre où elles font mal :
//   1. des missions ont-elles été créées en double sur Paris ? (les missions
//      issues des propositions s8 portent la note « Prestation Boond … » :
//      elles sont donc identifiables une par une, et annulables) ;
//   2. le CA a-t-il une raison de monter à chaque rechargement de CRA ?
//   3. pourquoi les bordelais apparaissent-ils tous en intercontrat ?
// ============================================================
import "dotenv/config"
import { prisma } from "../lib/prisma"
import { toIsoDate } from "../lib/staffing-load"
import { todayParis } from "../lib/staffing-ui"
import { Agency, PersonKind } from "../lib/types"

const titre = (t: string) => console.log(`\n${"═".repeat(78)}\n${t}\n${"═".repeat(78)}`)
const jr = (n: number) => n.toFixed(2).replace(".", ",")
const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "")

async function main() {
  const today = todayParis()

  // ---------------------------------------------------------------- 1. Missions
  titre("1. MISSIONS — ce qui a été créé, et ce qui se chevauche")
  const missions = await prisma.mission.findMany({
    include: { person: { select: { name: true, agency: true, kind: true } } },
    orderBy: [{ rank: "asc" }],
  })
  const issuesDeBoond = missions.filter((m) => (m.note ?? "").startsWith("Prestation Boond"))
  console.log(`  ${missions.length} mission(s) au registre`)
  console.log(`  ${issuesDeBoond.length} créée(s) depuis une proposition Boond (note « Prestation Boond … »)`)
  if (issuesDeBoond.length) {
    const parAgence = new Map<string, number>()
    for (const m of issuesDeBoond) {
      const a = m.person.agency ?? "(vide → Paris)"
      parAgence.set(a, (parAgence.get(a) ?? 0) + 1)
    }
    console.log(`      par agence : ${[...parAgence.entries()].map(([a, n]) => `${a} ${n}`).join(" · ")}`)
    console.log("      détail :")
    for (const m of issuesDeBoond.slice(0, 40)) {
      console.log(
        `        ${m.person.name.slice(0, 22).padEnd(24)} ${m.client.slice(0, 24).padEnd(26)}` +
          ` ${toIsoDate(m.startDate)} → ${toIsoDate(m.endDate)}  part ${m.share}` +
          `  ${m.fees ?? "—"} €/j`
      )
    }
    if (issuesDeBoond.length > 40) console.log(`        … et ${issuesDeBoond.length - 40} autre(s)`)
  }

  // Chevauchements : deux missions de la MÊME personne qui se recouvrent.
  const parPersonne = new Map<string, typeof missions>()
  for (const m of missions) parPersonne.set(m.personId, [...(parPersonne.get(m.personId) ?? []), m])
  const chevauchements: string[] = []
  for (const [, liste] of parPersonne) {
    for (let i = 0; i < liste.length; i++) {
      for (let j = i + 1; j < liste.length; j++) {
        const a = liste[i]
        const b = liste[j]
        if (a.startDate <= b.endDate && b.startDate <= a.endDate) {
          const memeClient = norm(a.client) === norm(b.client) || norm(a.client).includes(norm(b.client)) || norm(b.client).includes(norm(a.client))
          const issu = (a.note ?? "").startsWith("Prestation Boond") || (b.note ?? "").startsWith("Prestation Boond")
          chevauchements.push(
            `${a.person.name.slice(0, 20).padEnd(22)} ${a.client.slice(0, 18).padEnd(20)}` +
              `(${toIsoDate(a.startDate)}→${toIsoDate(a.endDate)}, part ${a.share})` +
              ` ✕ ${b.client.slice(0, 18).padEnd(20)}(${toIsoDate(b.startDate)}→${toIsoDate(b.endDate)}, part ${b.share})` +
              `${memeClient ? "   ⚠ MÊME CLIENT = DOUBLON" : ""}${issu ? "   [issu d'une proposition Boond]" : ""}`
          )
        }
      }
    }
  }
  console.log(`\n  ${chevauchements.length} chevauchement(s) de missions (même personne, fenêtres qui se recouvrent) :`)
  for (const c of chevauchements.slice(0, 60)) console.log(`      ${c}`)
  if (chevauchements.length > 60) console.log(`      … et ${chevauchements.length - 60} autre(s)`)
  const doublons = chevauchements.filter((c) => c.includes("DOUBLON")).length
  if (doublons) {
    console.log(
      `\n  ⚠ ${doublons} ressemble(nt) à de VRAIS doublons (même client, période qui se recouvre).` +
        `\n    Si les missions en cause portent « [issu d'une proposition Boond] », elles s'annulent` +
        `\n    d'une commande : npx tsx scripts/annuler-propositions.ts`
    )
  }

  // ------------------------------------------------------------------ 2. CRA
  titre("2. JOURS DE CRA — volume, et pourquoi le CA bouge")
  const [total, parAnnee, dernieres] = await Promise.all([
    prisma.timeEntry.count(),
    prisma.$queryRaw<{ annee: number; jours: number; lignes: bigint }[]>`
      SELECT EXTRACT(YEAR FROM "date")::int AS annee,
             SUM("duration")::float AS jours,
             COUNT(*) AS lignes
      FROM "TimeEntry" WHERE "activityType" = 'production'
      GROUP BY 1 ORDER BY 1`,
    prisma.syncRun.findMany({ where: { kind: "BOOND_TIMES" }, orderBy: { startedAt: "desc" }, take: 5 }),
  ])
  console.log(`  ${total} ligne(s) en base (toutes activités)`)
  for (const a of parAnnee) {
    console.log(`      ${a.annee}  ${jr(a.jours).padStart(9)} jour(s) de production  (${a.lignes} lignes)`)
  }
  console.log("\n  5 derniers passages de la synchro des jours :")
  for (const r of dernieres) {
    const rep = r.report as { fullLoad?: boolean; deleted?: number; created?: number; rowsFetched?: number } | null
    console.log(
      `      ${r.startedAt.toISOString().slice(0, 16).replace("T", " ")}` +
        `${r.dryRun ? " (répétition)" : ""}  ${rep?.fullLoad ? "pleine charge" : "fenêtre"}` +
        `  lues ${rep?.rowsFetched ?? "?"} · supprimées ${rep?.deleted ?? "?"} · écrites ${rep?.created ?? "?"}`
    )
  }
  const prestations = await prisma.delivery.count()
  const avecTjm = await prisma.delivery.count({ where: { dailyRate: { not: null } } })
  console.log(`\n  ${prestations} prestation(s) connue(s), dont ${avecTjm} avec un TJM vendu.`)
  console.log(
    "  → Le CA monte quand DES JOURS SE VALORISENT : soit ils entrent (périmètre du jeton),\n" +
      "    soit ils trouvent enfin un taux (prestation synchronisée). La ligne « supprimées/écrites »\n" +
      "    ci-dessus dit si un passage a remplacé la fenêtre ou tout rechargé.\n" +
      "  → Détail chiffré : npx tsx scripts/ca-decomposition.ts"
  )

  // -------------------------------------------------------------- 3. Bordeaux
  titre("3. BORDEAUX — pourquoi les consultants sont en intercontrat")
  const bordelais = await prisma.person.findMany({
    where: { kind: PersonKind.CONSULTANT, agency: Agency.BORDEAUX },
    include: { missions: { orderBy: { startDate: "asc" } }, previous: { select: { name: true } } },
    orderBy: { name: "asc" },
  })
  console.log(`  ${bordelais.length} consultant(s) rattaché(s) à Bordeaux`)
  for (const p of bordelais) {
    const couvre = p.missions.filter((m) => toIsoDate(m.startDate) <= today && today <= toIsoDate(m.endDate))
    const jours = await prisma.timeEntry.count({ where: { personId: p.id, activityType: "production" } })
    console.log(
      `      ${p.name.slice(0, 24).padEnd(26)} ${p.missions.length} mission(s)` +
        ` · ${couvre.length} couvrant aujourd'hui` +
        ` · ${jours} jour(s) de production` +
        `${p.departureDate ? ` · PARTIE le ${toIsoDate(p.departureDate)}` : ""}` +
        `${p.previous ? " · fiche issue d'un transfert" : ""}`
    )
    for (const m of p.missions.slice(0, 3)) {
      console.log(
        `          ${m.client.slice(0, 26).padEnd(28)} ${toIsoDate(m.startDate)} → ${toIsoDate(m.endDate)}` +
          `${(m.note ?? "").startsWith("Prestation Boond") ? "  [proposition Boond]" : ""}`
      )
    }
  }
  console.log(
    "\n  Un consultant est « en intercontrat » quand AUCUNE mission du registre ne couvre\n" +
      "  aujourd'hui. Zéro mission, ou des missions terminées, donnent le même affichage."
  )

  // ---------------------------------------------------------- 4. Transferts
  titre("4. MOBILITÉ — fiches issues d'un transfert")
  const transferees = await prisma.person.findMany({
    where: { previousId: { not: null } },
    include: { previous: { select: { name: true, agency: true, arrivalDate: true, departureDate: true } } },
  })
  if (!transferees.length) console.log("  Aucune — aucun transfert n'a été appliqué.")
  for (const p of transferees) {
    console.log(
      `  ${p.name.padEnd(26)} ${p.previous?.agency ?? "?"} ${toIsoDate(p.previous!.arrivalDate)} → ${p.previous?.departureDate ? toIsoDate(p.previous.departureDate) : "?"}` +
        `   puis ${p.agency} depuis ${toIsoDate(p.arrivalDate)}`
    )
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
