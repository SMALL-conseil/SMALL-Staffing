// ============================================================
//  POSER LES AGENCES EN LOT (a26) — quand BoondManager ne porte pas encore
//  le rattachement Paris / Bordeaux, la liste se saisit une fois ici plutôt
//  qu'au menu déroulant, personne par personne, dans /admin/personnes.
//
//      npx tsx scripts/agences.ts BORDEAUX "Alice TRENQUIER" "bob@small-conseil.com"
//      npx tsx scripts/agences.ts BORDEAUX --fichier bordeaux.txt       (1 par ligne)
//      npx tsx scripts/agences.ts BORDEAUX --fichier bordeaux.txt --appliquer
//      npx tsx scripts/agences.ts --etat                                (photo actuelle)
//
//  RÉPÉTITION PAR DÉFAUT : rien n'est écrit sans --appliquer.
//  Rapprochement par EMAIL d'abord, puis par NOM normalisé (accents/casse
//  ignorés). Une entrée qui ne tombe sur personne — ou sur plusieurs fiches —
//  est signalée et N'ÉCRIT RIEN : jamais de devinette sur un registre.
//  Idempotent : une fiche déjà à la bonne agence est comptée « inchangée ».
//  La synchro Boond ne réécrira pas ces valeurs tant qu'aucun libellé de ville
//  n'existe côté Boond (a24/a25) — la saisie survit aux synchros.
// ============================================================
import "dotenv/config"
import { readFileSync } from "fs"
import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()
const AGENCES = ["PARIS", "BORDEAUX"]

const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toLowerCase()

class ErreurUtilisateur extends Error {}

async function etat() {
  const gens = await prisma.person.findMany({
    select: { name: true, kind: true, agency: true, departureDate: true },
    orderBy: [{ agency: "asc" }, { name: "asc" }],
  })
  const hist = new Map<string, number>()
  for (const g of gens) hist.set(g.agency ?? "(vide)", (hist.get(g.agency ?? "(vide)") ?? 0) + 1)
  console.log("Répartition actuelle :")
  for (const [a, n] of [...hist.entries()].sort((x, y) => y[1] - x[1])) console.log(`  ${a.padEnd(12)} ${n}`)
  const posees = gens.filter((g) => g.agency)
  if (posees.length) {
    console.log("\nFiches avec une agence :")
    for (const g of posees) console.log(`  ${g.agency!.padEnd(10)} ${g.name} (${g.kind})${g.departureDate ? " — partie" : ""}`)
  }
  console.log(
    "\nRappel : une fiche SANS agence est comptée dans le périmètre par défaut (Paris)," +
      "\net reste visible dans « Tout SMALL »."
  )
}

async function main() {
  const args = process.argv.slice(2)
  if (args.includes("--etat")) return etat()

  const appliquer = args.includes("--appliquer")
  // Le chemin qui SUIT --fichier n'est ni l'agence ni une personne : on l'écarte.
  const iFichier = args.indexOf("--fichier")
  const positionnels = args.filter(
    (a, i) => !a.startsWith("--") && !(iFichier !== -1 && i === iFichier + 1)
  )
  const agence = (positionnels.find((a) => AGENCES.includes(a.toUpperCase())) ?? positionnels[0] ?? "").toUpperCase()
  if (!AGENCES.includes(agence)) {
    throw new ErreurUtilisateur(
      `Première valeur attendue : ${AGENCES.join(" ou ")}.\n` +
        `  ex. npx tsx scripts/agences.ts BORDEAUX --fichier bordeaux.txt\n` +
        `      npx tsx scripts/agences.ts --etat`
    )
  }

  // Entrées : les positionnels restants + le contenu de --fichier.
  let premierVu = false
  const entrees: string[] = positionnels.filter((a) => {
    if (!premierVu && a.toUpperCase() === agence) {
      premierVu = true
      return false
    }
    return true
  })
  const iF = iFichier
  if (iF !== -1) {
    const chemin = args[iF + 1]
    if (!chemin) throw new ErreurUtilisateur("--fichier attend un chemin de fichier texte (une personne par ligne).")
    let contenu: string
    try {
      contenu = readFileSync(chemin, "utf8")
    } catch {
      throw new ErreurUtilisateur(`Fichier introuvable ou illisible : ${chemin}`)
    }
    entrees.push(
      ...contenu
        .split(/\r?\n/)
        .map((l) => l.replace(/^[\s;,-]+|[\s;,]+$/g, ""))
        .filter((l) => l && !l.startsWith("#"))
    )
  }
  if (!entrees.length) throw new ErreurUtilisateur("Aucune personne fournie (arguments ou --fichier).")

  const gens = await prisma.person.findMany({ select: { id: true, name: true, email: true, kind: true, agency: true } })
  const parEmail = new Map<string, typeof gens>()
  const parNom = new Map<string, typeof gens>()
  for (const g of gens) {
    if (g.email) {
      const k = norm(g.email)
      parEmail.set(k, [...(parEmail.get(k) ?? []), g])
    }
    const k = norm(g.name)
    parNom.set(k, [...(parNom.get(k) ?? []), g])
  }

  const aEcrire: { id: string; libelle: string }[] = []
  const inchangees: string[] = []
  const problemes: string[] = []
  for (const e of entrees) {
    const cles = norm(e)
    const trouves = parEmail.get(cles) ?? parNom.get(cles) ?? []
    if (!trouves.length) {
      problemes.push(`${e} → aucune fiche (vérifier l'orthographe, ou l'email)`)
      continue
    }
    // Plusieurs fiches au même nom = consultant + siège : les deux sont légitimes,
    // on pose l'agence sur toutes (même personne physique).
    for (const t of trouves) {
      const libelle = `${t.name} (${t.kind})`
      if (t.agency === agence) inchangees.push(libelle)
      else aEcrire.push({ id: t.id, libelle: `${libelle}${t.agency ? ` : ${t.agency} → ${agence}` : ""}` })
    }
  }

  console.log(`${appliquer ? "ÉCRITURE" : "RÉPÉTITION (rien n'est écrit)"} — agence « ${agence} »\n`)
  console.log(`  ${entrees.length} entrée(s) fournie(s)`)
  console.log(`  ${aEcrire.length} fiche(s) à mettre à jour`)
  for (const a of aEcrire) console.log(`      ${a.libelle}`)
  if (inchangees.length) {
    console.log(`  ${inchangees.length} déjà à « ${agence} »`)
    for (const i of inchangees) console.log(`      ${i}`)
  }
  if (problemes.length) {
    console.log(`  ${problemes.length} entrée(s) NON RAPPROCHÉE(S) — rien n'est écrit pour elles :`)
    for (const p of problemes) console.log(`      ${p}`)
  }

  if (!appliquer) {
    console.log("\n→ Relancer avec --appliquer pour écrire.")
    return
  }
  if (!aEcrire.length) {
    console.log("\nRien à écrire.")
    return
  }
  await prisma.person.updateMany({ where: { id: { in: aEcrire.map((a) => a.id) } }, data: { agency: agence } })
  console.log(`\n✔ ${aEcrire.length} fiche(s) rattachée(s) à « ${agence} ».`)
  console.log("  (le périmètre est relu à chaque page — rafraîchir l'onglet suffit)")
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
