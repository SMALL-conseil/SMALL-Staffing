// ============================================================
//  LES HONORAIRES DES MISSIONS FACE À BOOND (a36)
//      npx tsx scripts/tjm-missions.ts                    (répétition, tout)
//      npx tsx scripts/tjm-missions.ts --ecarts           (seulement ce qui diffère)
//      npx tsx scripts/tjm-missions.ts --modifiees 2026-09-15
//      npx tsx scripts/tjm-missions.ts --appliquer        (corrige les cas nets)
//      npx tsx scripts/tjm-missions.ts --appliquer --sans-completer
//                         (ne touche QUE les honoraires déjà saisis, sans en
//                          poser sur les missions qui n'en avaient pas)
//
//  RÉPÉTITION PAR DÉFAUT : rien n'est écrit sans --appliquer.
//
//  Problème : des honoraires ont été saisis à la main pendant la recette, sans
//  certitude sur les valeurs. Or la bonne réponse existe ailleurs : chaque JOUR
//  de CRA pointé dans la fenêtre d'une mission porte sa prestation Boond, donc
//  son TJM VENDU. On confronte donc l'honoraire saisi au taux réellement
//  pratiqué sur ces jours-là — ce n'est pas une opinion, c'est le contrat.
//
//  Ce que le script NE FAIT PAS, volontairement :
//   · il n'écrit rien quand la mission couvre PLUSIEURS TJM différents (deux
//     prestations, un avenant en cours de route) : c'est un arbitrage, pas une
//     correction — il l'affiche et s'arrête ;
//   · il n'écrit rien quand aucun jour n'a été pointé sur la fenêtre : Boond
//     n'a alors rien à en dire, et une absence de preuve n'est pas une preuve ;
//   · il ne touche JAMAIS une mission dont l'honoraire est déjà celui de Boond.
// ============================================================
import "dotenv/config"
import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

const iso = (d: Date) => d.toISOString().slice(0, 10)
const eur = (n: number | null) => (n === null ? "—" : `${n} €`)
const jr = (n: number) => n.toFixed(2).replace(".", ",")

type Verdict =
  | { type: "IDENTIQUE" }
  | { type: "A_CORRIGER"; tjm: number; jours: number }
  | { type: "A_POSER"; tjm: number; jours: number }
  | { type: "PLUSIEURS"; taux: { tjm: number; jours: number }[] }
  | { type: "SANS_JOUR" }
  | { type: "SANS_TJM"; jours: number }

function arg(nom: string): string | undefined {
  const i = process.argv.indexOf(nom)
  return i === -1 ? undefined : process.argv[i + 1]
}

async function main() {
  const appliquer = process.argv.includes("--appliquer")
  const ecartsSeuls = process.argv.includes("--ecarts")
  const modifieesDepuis = arg("--modifiees")
  if (modifieesDepuis && !/^\d{4}-\d{2}-\d{2}$/.test(modifieesDepuis)) {
    console.error("\n--modifiees attend une date AAAA-MM-JJ.\n")
    process.exit(1)
  }

  const missions = await prisma.mission.findMany({
    where: modifieesDepuis
      ? { updatedAt: { gte: new Date(`${modifieesDepuis}T00:00:00.000Z`) } }
      : {},
    include: { person: { select: { name: true, agency: true, defaultDailyRate: true } } },
    orderBy: [{ startDate: "desc" }],
  })
  const prestations = await prisma.delivery.findMany({ select: { boondId: true, dailyRate: true } })
  const tjmParPrestation = new Map(prestations.map((d) => [d.boondId, d.dailyRate]))

  console.log(
    `${appliquer ? "ÉCRITURE" : "RÉPÉTITION (rien n'est écrit)"} — honoraires des missions face aux prestations Boond` +
      `${modifieesDepuis ? `, modifiées depuis le ${modifieesDepuis}` : ""}\n`
  )
  console.log(`  ${missions.length} mission(s) examinée(s)\n`)

  const aEcrire: { id: string; tjm: number; ligne: string; pose: boolean }[] = []
  const compteur = new Map<string, number>()

  for (const m of missions) {
    // Les jours de CRA de CETTE personne dans la fenêtre de CETTE mission.
    const jours = await prisma.timeEntry.findMany({
      where: {
        personId: m.personId,
        activityType: "production",
        date: { gte: m.startDate, lte: m.endDate },
      },
      select: { duration: true, deliveryBoondId: true },
    })

    // Répartition des jours par TJM observé.
    const parTjm = new Map<number, number>()
    let joursSansTjm = 0
    for (const j of jours) {
      const t = j.deliveryBoondId ? tjmParPrestation.get(j.deliveryBoondId) : null
      if (t === null || t === undefined) {
        joursSansTjm += j.duration
        continue
      }
      parTjm.set(t, (parTjm.get(t) ?? 0) + j.duration)
    }

    let verdict: Verdict
    if (!jours.length) verdict = { type: "SANS_JOUR" }
    else if (!parTjm.size) verdict = { type: "SANS_TJM", jours: joursSansTjm }
    else if (parTjm.size > 1) {
      verdict = {
        type: "PLUSIEURS",
        taux: [...parTjm.entries()]
          .map(([tjm, j]) => ({ tjm, jours: j }))
          .sort((a, b) => b.jours - a.jours),
      }
    } else {
      const [tjm, j] = [...parTjm.entries()][0]
      if (m.fees === tjm) verdict = { type: "IDENTIQUE" }
      else if (m.fees === null) verdict = { type: "A_POSER", tjm, jours: j }
      else verdict = { type: "A_CORRIGER", tjm, jours: j }
    }
    compteur.set(verdict.type, (compteur.get(verdict.type) ?? 0) + 1)
    if (ecartsSeuls && (verdict.type === "IDENTIQUE" || verdict.type === "SANS_JOUR")) continue

    const tete =
      `  ${m.person.name.slice(0, 20).padEnd(22)} ${m.client.slice(0, 20).padEnd(22)}` +
      ` ${iso(m.startDate)} → ${iso(m.endDate)}  saisi ${eur(m.fees).padStart(8)}`
    const modifiee =
      m.updatedAt.getTime() - m.createdAt.getTime() > 60_000
        ? `  (modifiée le ${iso(m.updatedAt)})`
        : ""

    switch (verdict.type) {
      case "IDENTIQUE":
        console.log(`${tete}   = Boond ✓${modifiee}`)
        break
      case "A_CORRIGER":
        console.log(
          `${tete}   ⚠ Boond dit ${verdict.tjm} € sur ${jr(verdict.jours)} j pointés${modifiee}`
        )
        aEcrire.push({ id: m.id, tjm: verdict.tjm, ligne: `${m.person.name} / ${m.client}`, pose: false })
        break
      case "A_POSER":
        console.log(`${tete}   → Boond dit ${verdict.tjm} € sur ${jr(verdict.jours)} j pointés${modifiee}`)
        aEcrire.push({ id: m.id, tjm: verdict.tjm, ligne: `${m.person.name} / ${m.client}`, pose: true })
        break
      case "PLUSIEURS":
        console.log(
          `${tete}   ✋ ${verdict.taux.map((t) => `${t.tjm} € (${jr(t.jours)} j)`).join(" · ")}` +
            ` — plusieurs taux sur la période, À TRANCHER À LA MAIN${modifiee}`
        )
        break
      case "SANS_TJM":
        console.log(`${tete}   · ${jr(verdict.jours)} j pointés, aucune prestation avec TJM${modifiee}`)
        break
      case "SANS_JOUR":
        console.log(`${tete}   · aucun jour pointé sur la période — Boond ne peut rien dire${modifiee}`)
        break
    }
  }

  console.log(
    `\n  Bilan : ` +
      [...compteur.entries()]
        .map(([t, n]) => `${t.toLowerCase().replace(/_/g, " ")} ${n}`)
        .join(" · ")
  )

  if (!aEcrire.length) {
    console.log("\n  Aucun honoraire à corriger automatiquement.")
    return
  }
  const corriges = aEcrire.filter((a) => !a.pose)
  const poses = aEcrire.filter((a) => a.pose)
  console.log(
    `\n  ${aEcrire.length} honoraire(s) alignable(s) sur Boond sans ambiguïté :` +
      `\n      ${corriges.length} valeur(s) SAISIE(S) à corriger` +
      `\n      ${poses.length} mission(s) SANS honoraire à compléter` +
      (poses.length ? `\n      (--sans-completer pour ne toucher que les valeurs déjà saisies)` : "")
  )
  if (!appliquer) {
    console.log("→ Relancer avec --appliquer pour les écrire.")
    return
  }
  const cibles = process.argv.includes("--sans-completer") ? corriges : aEcrire
  for (const a of cibles) {
    await prisma.mission.update({ where: { id: a.id }, data: { fees: a.tjm } })
  }
  console.log(`\n✔ ${cibles.length} honoraire(s) aligné(s) sur le TJM vendu.`)
  console.log("  (le CA se recalcule à l'affichage — rafraîchir /admin/reporting)")
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
