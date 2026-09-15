// ============================================================
//  MISSIONS SUGGÉRÉES PAR LES CRA — a23.
//      npx tsx scripts/missions-suggerees.ts [AAAA]
//  (année par défaut : l'année courante)
//
//  La synchro Boond ne crée JAMAIS de mission (invariant du projet : les
//  missions sont saisies dans l'app). Mais les jours de CRA, eux, sont
//  synchronisés — et ils portent le client et le projet. Un consultant qui
//  pointe des jours de production qu'aucune mission du registre ne couvre
//  révèle donc une mission MANQUANTE : c'est le cas des recrues arrivées
//  après l'import du classeur.
//  Le script liste ces manques (à saisir dans /admin/missions), puis le
//  symétrique : les missions du registre qui ne reçoivent aucun jour de CRA
//  — souvent des missions à clôturer, qui gonflent le CA conventionnel.
//  Lecture seule.
// ============================================================
import "dotenv/config"
import { prisma } from "../lib/prisma"
import { toIsoDate } from "../lib/staffing-load"
import { todayParis } from "../lib/staffing-ui"

const fr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}`
const jr = (x: number) => x.toFixed(2).replace(".", ",")

function titre(n: string) {
  console.log(`\n${"═".repeat(78)}\n${n}\n${"═".repeat(78)}`)
}

async function main() {
  const today = todayParis()
  const arg = process.argv.slice(2).find((a) => /^\d{4}$/.test(a))
  const year = Number(arg ?? today.slice(0, 4))
  const debut = `${year}-01-01`
  const fin = `${year}-12-31`

  const persons = await prisma.person.findMany({
    where: { kind: "CONSULTANT" },
    include: { missions: { orderBy: { rank: "asc" } } },
    orderBy: { name: "asc" },
  })
  const jours = await prisma.timeEntry.findMany({
    where: {
      activityType: "production",
      date: { gte: new Date(`${debut}T00:00:00Z`), lte: new Date(`${fin}T00:00:00Z`) },
    },
    select: { personId: true, date: true, duration: true, clientName: true, projectName: true },
  })

  if (!jours.length) {
    console.log(
      `Aucun jour de CRA « production » en ${year} — lancer d'abord la synchro des jours ` +
        `(/admin/reporting, carte « Jours de CRA »).`
    )
    return
  }

  const parPersonne = new Map<string, typeof jours>()
  for (const j of jours) {
    const l = parPersonne.get(j.personId) ?? []
    l.push(j)
    parPersonne.set(j.personId, l)
  }

  // --- 1. Jours pointés qu'aucune mission ne couvre --------------------------
  interface Manque {
    consultant: string
    client: string
    jours: number
    premier: string
    dernier: string
    projets: Set<string>
    aucuneMission: boolean
  }
  const manques = new Map<string, Manque>()

  for (const p of persons) {
    const fenetres = p.missions.map((m) => ({ de: toIsoDate(m.startDate), a: toIsoDate(m.endDate) }))
    for (const j of parPersonne.get(p.id) ?? []) {
      const d = toIsoDate(j.date)
      if (fenetres.some((f) => f.de <= d && d <= f.a)) continue
      const client = j.clientName ?? "(client non renseigné dans Boond)"
      const cle = `${p.id}|${client}`
      const m = manques.get(cle) ?? {
        consultant: p.name,
        client,
        jours: 0,
        premier: d,
        dernier: d,
        projets: new Set<string>(),
        aucuneMission: p.missions.length === 0,
      }
      m.jours += j.duration
      if (d < m.premier) m.premier = d
      if (d > m.dernier) m.dernier = d
      if (j.projectName) m.projets.add(j.projectName)
      manques.set(cle, m)
    }
  }

  titre(`1. MISSIONS MANQUANTES AU REGISTRE — suggérées par les CRA ${year}`)
  const liste = [...manques.values()].sort((a, b) => b.jours - a.jours)
  if (!liste.length) {
    console.log("  Aucun jour de production orphelin : le registre couvre tous les CRA. 👍")
  } else {
    const total = liste.reduce((n, m) => n + m.jours, 0)
    console.log(
      `  ${liste.length} rapprochement(s) à faire · ${jr(total)} jour(s) de production non couverts\n`
    )
    console.log(
      `${"Consultant".padEnd(24)}${"Client (Boond)".padEnd(32)}${"jours".padStart(8)}   ${"du".padEnd(9)}${"au".padEnd(11)}projet(s)`
    )
    for (const m of liste) {
      console.log(
        `${m.consultant.slice(0, 23).padEnd(24)}${m.client.slice(0, 31).padEnd(32)}${jr(m.jours).padStart(8)}   ` +
          `${fr(m.premier).padEnd(9)}${fr(m.dernier).padEnd(11)}${[...m.projets].join(" · ").slice(0, 60)}` +
          (m.aucuneMission ? "   ← AUCUNE mission au registre" : "")
      )
    }
    console.log(
      `\n  → à saisir dans /admin/missions (le client de l'app peut porter un autre libellé :\n` +
        `    « Groupama » côté Boond, « GROUPAMA » au registre — garder celui du registre).`
    )
  }

  // --- 2. Missions du registre sans aucun jour de CRA -----------------------
  titre(`2. MISSIONS DU REGISTRE SANS AUCUN JOUR DE CRA EN ${year}`)
  // Garde-fous : sans CRA synchronisés pour une personne (ou hors de la
  // fenêtre réellement synchronisée), l'absence de jours ne prouve RIEN —
  // on ne dénonce que ce qui est vérifiable.
  const toutesDates = jours.map((j) => toIsoDate(j.date)).sort()
  const craDe = toutesDates[0]
  const craA = toutesDates[toutesDates.length - 1]
  const sansCra = persons.filter(
    (p) => p.missions.length > 0 && !(parPersonne.get(p.id) ?? []).length
  )
  const fantomes: { consultant: string; client: string; de: string; a: string; encours: boolean }[] = []
  for (const p of persons) {
    if (!(parPersonne.get(p.id) ?? []).length) continue // aucun CRA : non exploitable
    for (const m of p.missions) {
      const de = toIsoDate(m.startDate)
      const a = toIsoDate(m.endDate)
      if (a < debut || de > fin) continue // mission hors de l'année analysée
      if (de > today) continue // pas encore commencée : normal qu'elle soit vide
      if (a < craDe || de > craA) continue // hors de la fenêtre CRA synchronisée
      const borneDebut = de < debut ? debut : de
      const borneFin = a > today ? today : a
      const pointes = (parPersonne.get(p.id) ?? []).filter((j) => {
        const d = toIsoDate(j.date)
        return d >= borneDebut && d <= borneFin
      })
      if (pointes.length === 0) {
        fantomes.push({ consultant: p.name, client: m.client, de, a, encours: de <= today && today <= a })
      }
    }
  }
  if (!fantomes.length) {
    console.log("  Aucune : toutes les missions commencées reçoivent des jours. 👍")
  } else {
    console.log(
      `  ${fantomes.length} mission(s) commencée(s) sans un seul jour pointé sur la période —\n` +
        `  souvent des missions terminées mais laissées ouvertes (elles gonflent le CA conventionnel\n` +
        `  du mois courant et le taux de staffing) :\n`
    )
    for (const f of fantomes.slice(0, 40)) {
      console.log(
        `    ${f.consultant.slice(0, 23).padEnd(24)}${f.client.slice(0, 24).padEnd(26)}${fr(f.de)} → ${fr(f.a)}` +
          (f.encours ? "   ← EN COURS au registre" : "")
      )
    }
    if (fantomes.length > 40) console.log(`    … et ${fantomes.length - 40} autre(s)`)
    console.log(`\n  → vérifier la date de fin dans /admin/missions.`)
  }

  console.log(
    `\n  Fenêtre CRA réellement synchronisée : ${fr(craDe)} → ${fr(craA)}` +
      (sansCra.length
        ? `\n  ${sansCra.length} consultant(s) avec des missions mais AUCUN jour de CRA en ${year} —` +
          ` non exploitables ici :\n    ${sansCra.map((p) => p.name).slice(0, 12).join(" · ")}` +
          (sansCra.length > 12 ? ` …` : "")
        : "")
  )

  titre("RAPPEL")
  console.log(
    `  La synchro Boond n'écrit JAMAIS de mission (invariant du projet) : le registre des\n` +
      `  missions de l'app est alimenté par l'import initial du classeur, puis à la main.\n` +
      `  Les CRA, eux, viennent de Boond — d'où ce recoupement.`
  )
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
