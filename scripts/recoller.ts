// ============================================================
//  RECOLLER LE REGISTRE DE L'APP SUR LE CLASSEUR (a42, absences revues a43)
//      npx tsx scripts/recoller.ts "<xlsx|dossier>" [AAAA-MM] [--perimetre PARIS]
//                                  [--agences] [--personnes] [--missions] [--tout]
//                                  [--absence "NOM"] (répétable) [--appliquer]
//
//  compare-excel.ts (a21/a41) DIT où est l'écart. Ce script le CORRIGE — sans
//  jamais rien deviner. Le plan se lit avant d'écrire : sans --appliquer, rien
//  n'est touché, et seules les catégories demandées sont appliquées.
//
//  Qui a raison (règle décidée le 06/10/2026, détaillée dans lib/recollement.ts) :
//   · ABSENCES PROLONGÉES → PERSONNE, tant qu'un humain n'a pas tranché. Une
//     fenêtre du classeur peut décrire une vraie absence ou cacher un
//     INTERCONTRAT : une absence sort la personne du dénominateur et fait
//     monter le taux, un intercontrat l'y laisse et le fait baisser. Rien dans
//     le fichier ne les distingue — chaque fenêtre se confirme nommément :
//     --absence "Julie BICHON".
//   · GRADE / ARRIVÉE / DÉPART → l'app (synchro Boond). Jamais écrasés par
//     l'Excel : seulement signalés comme « classeur en retard ».
//   · Fiche ou mission MANQUANTE → créée ; mission du même client aux dates
//     différentes → AJUSTÉE (jamais dupliquée).
//   · Rien n'est JAMAIS supprimé : une absence ou une mission connue de l'app
//     seule est signalée, l'humain tranche.
//   · Les honoraires, le TJM de fiche, le boondId et le RANG de saisie ne sont
//     jamais touchés (le rang fait foi pour la carte).
//
//  Idempotent : rejoué après application, le plan est vide. Chaque écriture
//  est indépendante — un refus (doublon de nom, titulaire manquant) n'annule
//  pas les autres, il est nommé et le plan rejoué reprend le reste.
// ============================================================
import "dotenv/config"
import { readdirSync, statSync } from "fs"
import { join } from "path"
import { prisma } from "../lib/prisma"
import { loadStaffingData, toIsoDate } from "../lib/staffing-load"
import { monthlyKpis, staffableDays, staffedDays } from "../lib/staffing"
import { dansLePerimetre } from "../lib/perimetre"
import { GRADE_INDEP, GRADE_ROOKIE, Perimetre, PersonKind } from "../lib/types"
import {
  ALIAS_CLASSEUR,
  CONSULTANTS_EXCLUS,
  cleNom,
  nomCanonique,
  readRegistres,
  toEngineInputs,
  toIso,
} from "../lib/excel-registres"
import {
  CATEGORIES,
  categorieDe,
  libelleAction,
  planRecollement,
  type Action,
  type Categorie,
  type FicheApp,
  type MissionApp,
} from "../lib/recollement"
import { MOIS_LONGS, todayParis } from "../lib/staffing-ui"

const pct = (x: number) => `${(x * 100).toFixed(2).replace(".", ",")} %`
const pts = (x: number) => `${x >= 0 ? "+" : "−"}${(Math.abs(x) * 100).toFixed(2).replace(".", ",")} pt`
const titre = (t: string) => console.log(`\n${"═".repeat(78)}\n${t}\n${"═".repeat(78)}`)
/** « YYYY-MM-DD » → Date minuit UTC (colonnes @db.Date). */
const jour = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

class ErreurUtilisateur extends Error {}

function resoudreClasseur(cible: string): string {
  let st
  try {
    st = statSync(cible)
  } catch {
    throw new ErreurUtilisateur(`Chemin introuvable : ${cible}`)
  }
  if (st.isFile()) return cible
  const candidats = readdirSync(cible)
    .filter((f) => /\.xlsx$/i.test(f) && !f.startsWith("~$"))
    .map((f) => ({ f, chemin: join(cible, f), mtime: statSync(join(cible, f)).mtimeMs }))
    .sort((a, b) => Number(/staffing/i.test(b.f)) - Number(/staffing/i.test(a.f)) || b.mtime - a.mtime)
  if (!candidats.length) throw new ErreurUtilisateur(`Aucun classeur .xlsx dans ${cible}`)
  console.log(`→ classeur retenu : ${candidats[0].f}\n`)
  return candidats[0].chemin
}

function lirePerimetre(args: string[]): Perimetre {
  const valeurs = Object.values(Perimetre) as string[]
  const i = args.findIndex((a) => a === "--perimetre")
  const brut = (
    args.find((a) => a.startsWith("--perimetre="))?.split("=")[1] ??
    (i >= 0 ? args[i + 1] : undefined) ??
    Perimetre.PARIS
  )
    .trim()
    .toUpperCase()
  if (!valeurs.includes(brut)) {
    throw new ErreurUtilisateur(`Périmètre inconnu : « ${brut} » — attendu ${valeurs.join(", ")}.`)
  }
  return brut as Perimetre
}

async function main() {
  const args = process.argv.slice(2)
  const moisArg = args.find((a) => /^\d{4}-\d{2}$/.test(a))
  const perimetre = lirePerimetre(args)
  // Les valeurs qui SUIVENT un drapeau ne sont pas le chemin du classeur.
  const apresDrapeau = new Set(
    args.flatMap((a, k) => (a === "--perimetre" || a === "--absence" ? [k + 1] : []))
  )
  const cible = args.find((a, k) => !a.startsWith("--") && a !== moisArg && !apresDrapeau.has(k))
  if (!cible) {
    throw new ErreurUtilisateur(
      `Usage : npx tsx scripts/recoller.ts "<xlsx|dossier>" [AAAA-MM] [--perimetre PARIS]\n` +
        `        [--agences] [--personnes] [--missions] [--tout] [--appliquer]\n` +
        `        [--absence "NOM"]   (répétable — une absence ne s'applique que nommément)`
    )
  }
  if (args.includes("--absences")) {
    throw new ErreurUtilisateur(
      `--absences n'existe plus (06/10/2026).\n` +
        `  Une fenêtre « Absence » du classeur peut décrire une vraie absence ou cacher un\n` +
        `  INTERCONTRAT, et les deux jouent en sens inverse : une absence sort la personne du\n` +
        `  dénominateur et fait MONTER le taux, un intercontrat l'y laisse et le fait baisser.\n` +
        `  Rien dans le fichier ne les distingue — seul un humain sait.\n` +
        `  Chaque absence se confirme donc nommément : --absence "Julie BICHON"`
    )
  }
  const chemin = resoudreClasseur(cible)
  const today = todayParis()
  const year = Number((moisArg ?? today).slice(0, 4))
  const month = Number((moisArg ?? today).slice(5, 7))
  const tout = args.includes("--tout")
  // « absences » n'entre JAMAIS dans --tout : elle se confirme personne par
  // personne (--absence "NOM"), pour la raison dite plus haut.
  const demandees = new Set<Categorie>(
    CATEGORIES.filter((c) => c !== "absences" && (tout || args.includes(`--${c}`)))
  )
  const confirmees = args.flatMap((a, k) => (a === "--absence" && args[k + 1] ? [args[k + 1]] : []))
  if (confirmees.length) demandees.add("absences")
  const appliquer = args.includes("--appliquer")

  // --- Les deux côtés -------------------------------------------------------
  const reg = readRegistres(chemin)
  const classeur = {
    consultants: reg.consultants.map((c) => ({
      nom: nomCanonique(c.name),
      grade: c.grade,
      arrival: toIso(c.arrival),
      departure: c.departure ? toIso(c.departure) : null,
      absence: c.absenceStart
        ? { start: toIso(c.absenceStart), end: c.absenceEnd ? toIso(c.absenceEnd) : null }
        : null,
    })),
    missions: reg.missions.map((m) => ({
      nom: nomCanonique(m.consultant),
      client: m.client,
      start: toIso(m.start),
      end: toIso(m.end),
      share: m.share,
    })),
  }

  const personnes = (
    await prisma.person.findMany({
      where: { active: true, kind: PersonKind.CONSULTANT },
      include: { absences: true },
      orderBy: { createdAt: "asc" },
    })
  ).filter((p) => dansLePerimetre(p.agency, perimetre))
  const fiches: FicheApp[] = personnes.map((p) => ({
    id: p.id,
    nom: p.name,
    grade: p.grade,
    arrival: toIsoDate(p.arrivalDate),
    departure: p.departureDate ? toIsoDate(p.departureDate) : null,
    agency: p.agency,
    absences: p.absences.map((a) => ({
      id: a.id,
      start: toIsoDate(a.startDate),
      end: a.endDate ? toIsoDate(a.endDate) : null,
    })),
  }))
  // Fiches EN COURS hors périmètre : une personne au classeur parisien qui est
  // rattachée à Bordeaux dans l'app n'est pas manquante — elle est ailleurs.
  const horsPerimetre = (
    await prisma.person.findMany({
      where: { active: true, kind: PersonKind.CONSULTANT, departureDate: null },
      select: { name: true, agency: true },
    })
  )
    .filter((p) => !dansLePerimetre(p.agency, perimetre))
    .map((p) => ({ nom: p.name, agence: p.agency }))
  const retenus = new Set(fiches.map((f) => f.id))
  const missionsApp: MissionApp[] = (
    await prisma.mission.findMany({ orderBy: [{ rank: "asc" }] })
  )
    .filter((m) => retenus.has(m.personId))
    .map((m) => ({
      id: m.id,
      personId: m.personId,
      client: m.client,
      start: toIsoDate(m.startDate),
      end: toIsoDate(m.endDate),
      share: m.share,
    }))

  const plan = planRecollement(classeur, { fiches, missions: missionsApp }, {
    cle: cleNom,
    agence: perimetre === Perimetre.TOUT ? null : perimetre,
    exclus: CONSULTANTS_EXCLUS,
    horsPerimetre,
    absencesConfirmees: confirmees,
  })

  // --- L'état des lieux -----------------------------------------------------
  titre(`RECOLLEMENT — ${MOIS_LONGS[month - 1]} ${year} · périmètre ${perimetre}`)
  console.log(`Classeur : ${chemin}`)
  console.log(`           modifié le ${statSync(chemin).mtime.toLocaleString("fr-FR")}`)
  const alias = Object.entries(ALIAS_CLASSEUR)
  if (alias.length) console.log(`Alias    : ${alias.map(([a, b]) => `${a} → ${b}`).join(" · ")}`)

  const cotéClasseur = toEngineInputs(reg)
  const kClasseur = monthlyKpis(cotéClasseur.people, cotéClasseur.missions, year, month)
  const avant = await loadStaffingData(perimetre)
  const kAvant = monthlyKpis(avant.people, avant.missions, year, month)
  console.log(
    `\nTaux hors indépendants — classeur ${pct(kClasseur.tauxSalaries)} · app ${pct(kAvant.tauxSalaries)}` +
      ` · écart ${pts(kAvant.tauxSalaries - kClasseur.tauxSalaries)}`
  )

  // --- Le plan --------------------------------------------------------------
  titre(`PLAN — ${plan.actions.length} correction(s)`)
  if (!plan.actions.length) console.log("  (rien à corriger : le registre de l'app colle au classeur)")
  for (const c of CATEGORIES) {
    const lot = plan.actions.filter((a) => categorieDe(a) === c)
    if (!lot.length) continue
    const retenue = demandees.has(c)
    console.log(
      `\n  ${c.toUpperCase()} (${lot.length})` +
        (retenue ? (appliquer ? "  → À APPLIQUER" : "  → retenue, mais --appliquer manquant") : `  → ignorée (ajouter --${c})`)
    )
    for (const a of lot) console.log(`    ${libelleAction(a)}`)
  }

  // --- Les absences : une proposition chiffrée, à confirmer nommément -------
  if (plan.absencesAConfirmer.length) {
    titre(`ABSENCES — ${plan.absencesAConfirmer.length} proposition(s) à confirmer`)
    console.log(
      `  Une fenêtre « Absence » du classeur peut décrire une vraie absence ou cacher un\n` +
        `  INTERCONTRAT, et les deux jouent en sens INVERSE : une absence SORT la personne du\n` +
        `  dénominateur et fait MONTER le taux ; un intercontrat l'y laisse et le fait baisser\n` +
        `  — c'est tout l'intérêt du KPI. Rien dans le fichier ne les distingue : d'où la\n` +
        `  confirmation, une par une.\n`
    )
    let sta = 0
    let stf = 0
    for (const p of avant.people) {
      if (p.grade !== GRADE_ROOKIE && p.grade !== GRADE_INDEP)
        sta += staffableDays(p, avant.missions, year, month)
      if (p.grade !== GRADE_INDEP) stf += staffedDays(p, avant.missions, year, month)
    }
    for (const prop of plan.absencesAConfirmer) {
      const p = avant.people.find((x) => x.id === prop.personId)
      const compte = p ? p.grade !== GRADE_ROOKIE && p.grade !== GRADE_INDEP : false
      // Dans les cas divergents, l'app porte 0 ou 1 absence : la fenêtre du
      // classeur remplace donc exactement ce qu'elle connaît.
      const delta =
        p && compte
          ? staffableDays({ ...p, absences: [prop.apres] }, avant.missions, year, month) -
            staffableDays(p, avant.missions, year, month)
          : 0
      const tauxSi = sta + delta > 0 ? stf / (sta + delta) : 0
      console.log(
        `  ${prop.nom}\n` +
          `      classeur ${prop.apres.start} → ${prop.apres.end ?? "ouverte"}` +
          ` · app ${prop.avant ? `${prop.avant.start} → ${prop.avant.end ?? "ouverte"}` : "aucune absence"}\n` +
          `      effet sur ${MOIS_LONGS[month - 1]} : ${delta >= 0 ? "+" : "−"}${Math.abs(delta)} j staffables` +
          (delta !== 0 ? ` → taux ${pct(kAvant.tauxSalaries)} → ${pct(tauxSi)}` : " → taux inchangé") +
          `\n      si c'est une VRAIE absence :  --absence "${prop.nom}" --appliquer\n` +
          `      si c'est un INTERCONTRAT :     ne rien faire ici, et retirer la fenêtre du classeur`
      )
    }
  }

  if (plan.signalements.length) {
    titre(`À TRANCHER À LA MAIN — ${plan.signalements.length} signalement(s)`)
    console.log(`  (jamais écrits par ce script : une suppression ou un arbitrage demande un humain)\n`)
    for (const s of plan.signalements) console.log(`  ${s.nom} — ${s.quoi}\n      ${s.detail}`)
  }

  const aEcrire = plan.actions.filter((a) => demandees.has(categorieDe(a)))
  if (!appliquer || !aEcrire.length) {
    console.log(
      `\nRien n'a été écrit.` +
        (plan.actions.length
          ? ` Pour appliquer : ajouter les catégories voulues (ou --tout) et --appliquer.`
          : "")
    )
    return
  }

  // --- L'application --------------------------------------------------------
  titre(`APPLICATION — ${aEcrire.length} écriture(s)`)
  const refus: string[] = []
  const faites: string[] = []
  const dernierRang = (await prisma.mission.aggregate({ _max: { rank: true } }))._max.rank ?? -1
  let rang = dernierRang
  // Les missions dont le titulaire vient d'être créé attendent son id.
  const idsCrees = new Map<string, string>()

  for (const a of aEcrire) {
    try {
      await appliquerUne(a, { rang: () => ++rang, idsCrees, perimetre })
      faites.push(libelleAction(a))
    } catch (e) {
      refus.push(`${libelleAction(a)}\n      ↳ ${(e as Error).message}`)
    }
  }
  for (const f of faites) console.log(`  ✔ ${f}`)
  if (refus.length) {
    console.log(`\n  ${refus.length} refus — rien n'a été forcé :`)
    for (const r of refus) console.log(`  ✖ ${r}`)
  }

  // --- Le taux après --------------------------------------------------------
  const apres = await loadStaffingData(perimetre)
  const kApres = monthlyKpis(apres.people, apres.missions, year, month)
  titre("APRÈS")
  console.log(
    `  Taux hors indépendants : ${pct(kAvant.tauxSalaries)} → ${pct(kApres.tauxSalaries)}` +
      ` (${pts(kApres.tauxSalaries - kAvant.tauxSalaries)})` +
      `\n  Cible — le classeur sur ses propres registres : ${pct(kClasseur.tauxSalaries)}` +
      ` · reste ${pts(kApres.tauxSalaries - kClasseur.tauxSalaries)}`
  )
  console.log(
    `\n  Rappel : le reste éventuel se lit avec` +
      `\n  npx tsx scripts/compare-excel.ts "${chemin}" ${year}-${String(month).padStart(2, "0")} --perimetre ${perimetre}`
  )
}

/** Une action, une écriture. Les garde-fous qui demandent la base vivent ici. */
async function appliquerUne(
  a: Action,
  ctx: { rang: () => number; idsCrees: Map<string, string>; perimetre: Perimetre }
) {
  switch (a.type) {
    case "ABSENCE_AJOUT":
      await prisma.longAbsence.create({
        data: {
          personId: a.personId,
          startDate: jour(a.fenetre.start),
          endDate: a.fenetre.end ? jour(a.fenetre.end) : null,
          label: "repris du classeur",
        },
      })
      return
    case "ABSENCE_MAJ":
      await prisma.longAbsence.update({
        where: { id: a.absenceId },
        data: {
          startDate: jour(a.apres.start),
          endDate: a.apres.end ? jour(a.apres.end) : null,
        },
      })
      return
    case "AGENCE":
      await prisma.person.update({ where: { id: a.personId }, data: { agency: a.agence } })
      return
    case "PERSONNE_CREE": {
      // L'unicité (name, kind) est PARTIELLE (s7) : une fiche en cours du même
      // nom hors périmètre interdit la création — et c'est heureux, ce serait
      // un doublon. On refuse en nommant la fiche existante.
      const homonyme = await prisma.person.findFirst({
        where: { name: a.nom, kind: PersonKind.CONSULTANT },
        select: { id: true, agency: true, departureDate: true },
      })
      if (homonyme && !homonyme.departureDate) {
        throw new Error(
          `fiche déjà existante hors périmètre (agence ${homonyme.agency ?? "vide"}) — ` +
            `à rattacher à la main plutôt qu'à dupliquer`
        )
      }
      const cree = await prisma.person.create({
        data: {
          name: a.nom,
          kind: PersonKind.CONSULTANT,
          grade: a.grade,
          arrivalDate: jour(a.arrival),
          departureDate: a.departure ? jour(a.departure) : null,
          agency: a.agence || null,
          absences: a.absence
            ? {
                create: {
                  startDate: jour(a.absence.start),
                  endDate: a.absence.end ? jour(a.absence.end) : null,
                  label: "repris du classeur",
                },
              }
            : undefined,
        },
        select: { id: true },
      })
      ctx.idsCrees.set(cleNom(a.nom), cree.id)
      return
    }
    case "MISSION_CREE": {
      const personId = a.personId ?? ctx.idsCrees.get(cleNom(a.nom))
      if (!personId) {
        throw new Error(`titulaire absent du registre — ajouter --personnes pour créer sa fiche d'abord`)
      }
      await prisma.mission.create({
        data: {
          personId,
          client: a.client,
          startDate: jour(a.start),
          endDate: jour(a.end),
          share: a.share,
          rank: ctx.rang(),
        },
      })
      return
    }
    case "MISSION_MAJ":
      // Dates et part SEULEMENT : ni rang (il fait foi pour la carte), ni
      // honoraires (saisis dans l'app, le classeur ne les connaît pas).
      await prisma.mission.update({
        where: { id: a.missionId },
        data: {
          startDate: jour(a.apres.start),
          endDate: jour(a.apres.end),
          share: a.apres.share,
        },
      })
      return
  }
}

main()
  .catch((e) => {
    if (e instanceof ErreurUtilisateur) console.error(`\n${e.message}\n`)
    else console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
