// ============================================================
//  LE CRA D'UNE PERSONNE, JOUR PAR JOUR (a43)
//      npx tsx scripts/cra-personne.ts "<nom ou email>" [AAAA-MM | AAAA]
//
//  POURQUOI : une absence prolongée ne se devine pas depuis le classeur — ses
//  colonnes « Absence » servent aussi de parking à un intercontrat (cas Danny
//  Gaurat, 06/10/2026). Mais le CRA Boond, lui, sait ce que la personne a
//  POINTÉ : production, congés, absence, interne. Quand la question est
//  « à quelle date son absence commence-t-elle, au fait ? », la réponse est
//  là — pas dans un souvenir.
//
//  Le script affiche la fiche, le CRA jour par jour, puis les SÉRIES de jours
//  ouvrés sans production : celles qui portent des jours d'absence sont des
//  fenêtres candidates (à confirmer dans l'app), celles qui ne portent rien
//  du tout ne disent qu'une chose — le CRA n'est pas saisi.
//
//  Limite honnête : le CRA se remplit après coup. Une absence qui commence le
//  mois prochain n'y est pas. Ce script rattrape un oubli, il n'anticipe rien.
//  Lecture seule.
// ============================================================
import "dotenv/config"
import { prisma } from "../lib/prisma"
import { toIsoDate } from "../lib/staffing-load"
import { workingDays } from "../lib/staffing"
import { MOIS_LONGS, todayParis } from "../lib/staffing-ui"
import { cleNom } from "../lib/excel-registres"

const JOURS = ["lun", "mar", "mer", "jeu", "ven", "sam", "dim"]
const jr = (n: number) => n.toFixed(n % 1 ? 1 : 0).replace(".", ",")
const titre = (t: string) => console.log(`\n${"═".repeat(78)}\n${t}\n${"═".repeat(78)}`)
/** Jour ouvré français (lundi de Pentecôte travaillé — calendrier du moteur). */
const ouvre = (iso: string) => workingDays(iso, iso) === 1
const libelleJour = (iso: string) => {
  const d = new Date(`${iso}T00:00:00.000Z`)
  return `${JOURS[(d.getUTCDay() + 6) % 7]} ${iso.slice(8, 10)}/${iso.slice(5, 7)}`
}

class ErreurUtilisateur extends Error {}

/** Toutes les dates ISO d'un intervalle inclus. */
function jours(du: string, au: string): string[] {
  const out: string[] = []
  for (let t = Date.parse(`${du}T00:00:00Z`); t <= Date.parse(`${au}T00:00:00Z`); t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10))
  }
  return out
}

async function main() {
  const args = process.argv.slice(2)
  const periode = args.find((a) => /^\d{4}(-\d{2})?$/.test(a))
  const qui = args.find((a) => !a.startsWith("--") && a !== periode)
  if (!qui) {
    throw new ErreurUtilisateur(
      `Usage : npx tsx scripts/cra-personne.ts "<nom ou email>" [AAAA-MM | AAAA]\n` +
        `  Exemple : npx tsx scripts/cra-personne.ts "Julie BICHON" 2026-10`
    )
  }
  const today = todayParis()
  const annee = Number((periode ?? today).slice(0, 4))
  const mois = periode && periode.length === 7 ? Number(periode.slice(5, 7)) : null
  const du = mois ? `${annee}-${String(mois).padStart(2, "0")}-01` : `${annee}-01-01`
  const au = mois
    ? new Date(Date.UTC(annee, mois, 0)).toISOString().slice(0, 10)
    : `${annee}-12-31`

  // --- La personne ----------------------------------------------------------
  const toutes = await prisma.person.findMany({
    include: { absences: { orderBy: { startDate: "asc" } } },
    orderBy: { createdAt: "asc" },
  })
  const cible = cleNom(qui).trim()
  const candidats = toutes.filter(
    (p) => cleNom(p.name) === cible || (p.email ?? "").toLowerCase() === qui.toLowerCase()
  )
  if (!candidats.length) {
    const proches = toutes
      .filter((p) => cleNom(p.name).includes(cible.split(" ")[0] ?? ""))
      .map((p) => p.name)
      .slice(0, 8)
    throw new ErreurUtilisateur(
      `Personne introuvable : « ${qui} »` +
        (proches.length ? `\n  Peut-être : ${proches.join(" · ")}` : "")
    )
  }
  if (candidats.length > 1) {
    console.log(
      `⚠ ${candidats.length} fiches portent ce nom (transfert s7 ou changement de rôle) —` +
        ` toutes sont lues :\n` +
        candidats
          .map(
            (p) =>
              `    ${p.kind} · ${p.grade} · ${p.agency ?? "agence vide"} · arrivée ${toIsoDate(p.arrivalDate)}` +
              `${p.departureDate ? ` · départ ${toIsoDate(p.departureDate)}` : ""}`
          )
          .join("\n")
    )
  }

  const p0 = candidats[candidats.length - 1]
  titre(
    `${p0.name} — CRA du ${du} au ${au}` + (mois ? ` (${MOIS_LONGS[mois - 1]} ${annee})` : ` (${annee})`)
  )
  console.log(
    `  ${p0.kind} · ${p0.grade} · ${p0.agency ?? "agence vide (comptée PARIS, s5)"}` +
      ` · arrivée ${toIsoDate(p0.arrivalDate)}` +
      `${p0.departureDate ? ` · départ ${toIsoDate(p0.departureDate)}` : " · pas de départ"}` +
      `${p0.boondId ? ` · Boond ${p0.boondId}` : " · AUCUN boondId (hors synchro)"}`
  )
  const absences = candidats.flatMap((p) => p.absences)
  console.log(
    `  Absences prolongées connues de l'app : ` +
      (absences.length
        ? absences
            .map((a) => `${toIsoDate(a.startDate)} → ${a.endDate ? toIsoDate(a.endDate) : "ouverte"}`)
            .join(" ; ")
        : "aucune")
  )

  // --- Le CRA ---------------------------------------------------------------
  const lignes = await prisma.timeEntry.findMany({
    where: {
      personId: { in: candidats.map((p) => p.id) },
      date: { gte: new Date(`${du}T00:00:00.000Z`), lte: new Date(`${au}T00:00:00.000Z`) },
    },
    orderBy: { date: "asc" },
  })
  if (!lignes.length) {
    console.log(
      `\n  Aucune ligne de CRA sur la période.` +
        `\n  Soit la personne n'a rien pointé, soit l'historique n'est pas chargé` +
        `\n  (bouton « historique CRA » de /admin, ou synchro quotidienne).`
    )
    return
  }

  const parJour = new Map<string, typeof lignes>()
  for (const l of lignes) {
    const k = toIsoDate(l.date)
    parJour.set(k, [...(parJour.get(k) ?? []), l])
  }
  const parType = new Map<string, number>()
  for (const l of lignes) parType.set(l.activityType, (parType.get(l.activityType) ?? 0) + l.duration)
  console.log(
    `\n  ${jr(lignes.reduce((n, l) => n + l.duration, 0))} jour(s) pointé(s) — ` +
      [...parType.entries()].map(([t, n]) => `${t} ${jr(n)}`).join(" · ")
  )

  titre("JOUR PAR JOUR")
  console.log(
    `  ${"Jour".padEnd(12)}${"durée".padStart(6)}  ${"type".padEnd(12)}${"unité".padEnd(18)}client / projet`
  )
  for (const d of jours(du, au)) {
    const lot = parJour.get(d)
    if (!lot) {
      // Un jour ouvré non pointé mérite d'être vu ; un week-end, non.
      if (ouvre(d)) console.log(`  ${libelleJour(d).padEnd(12)}${"—".padStart(6)}  (non pointé)`)
      continue
    }
    for (const l of lot) {
      console.log(
        `  ${libelleJour(d).padEnd(12)}${jr(l.duration).padStart(6)}  ${l.activityType.padEnd(12)}` +
          `${l.workUnit.slice(0, 16).padEnd(18)}${l.clientName ?? l.projectName ?? ""}` +
          `${l.craState ? `   [CRA ${l.craState}]` : ""}`
      )
    }
  }

  // --- Les séries sans production -------------------------------------------
  titre("SÉRIES DE JOURS OUVRÉS SANS PRODUCTION")
  interface Serie {
    du: string
    au: string
    ouvres: number
    absence: number
    nonPointes: number
    types: Set<string>
    /** Premier et dernier jour PORTANT une absence pointée — la fenêtre à saisir. */
    premierAbs: string | null
    dernierAbs: string | null
  }
  const series: Serie[] = []
  let courante: Serie | null = null
  for (const d of jours(du, au)) {
    if (!ouvre(d)) continue
    const lot = parJour.get(d) ?? []
    const production = lot.some((l) => l.activityType === "production")
    if (production) {
      courante = null
      continue
    }
    if (!courante) {
      courante = {
        du: d, au: d, ouvres: 0, absence: 0, nonPointes: 0,
        types: new Set(), premierAbs: null, dernierAbs: null,
      }
      series.push(courante)
    }
    courante.au = d
    courante.ouvres++
    if (!lot.length) courante.nonPointes++
    for (const l of lot) {
      courante.types.add(l.activityType)
      if (l.activityType !== "production" && l.activityType !== "internal") {
        courante.absence += l.duration
        courante.premierAbs ??= d
        courante.dernierAbs = d
      }
    }
  }
  const retenues = series.filter((s) => s.ouvres >= 3)
  if (!retenues.length) {
    console.log("  (aucune série de 3 jours ouvrés ou plus sans production)")
  }
  for (const s of retenues) {
    const nature = s.absence > 0 ? "FENÊTRE CANDIDATE" : "CRA non saisi — ne conclut rien"
    console.log(
      `  ${s.du} → ${s.au}  ·  ${s.ouvres} j ouvrés  ·  ${nature}` +
        `\n      ${jr(s.absence)} j d'absence pointés · ${s.nonPointes} j non pointés` +
        `${s.types.size ? ` · types : ${[...s.types].join(", ")}` : ""}` +
        (s.premierAbs
          ? `\n      absence POINTÉE du ${s.premierAbs} au ${s.dernierAbs}` +
            `${s.dernierAbs !== s.au ? ` (la suite n'est pas pointée — fin inconnue)` : ""}` +
            `\n      à confirmer dans l'app : /admin/personnes → absences prolongées`
          : "")
    )
  }
  console.log(
    `\n  Le CRA se remplit APRÈS coup : une absence qui commence plus tard n'y est pas.` +
      `\n  Et un jour « non pointé » ne prouve rien — ni présence, ni absence.`
  )
}

main()
  .catch((e) => {
    if (e instanceof ErreurUtilisateur) console.error(`\n${e.message}\n`)
    else console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
