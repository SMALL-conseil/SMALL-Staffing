// ============================================================
//  MOBILITÉ INTER-AGENCES (s7) — logique PURE, testée.
//
//  Une personne transférée de Paris à Bordeaux porte DEUX fiches datées :
//  la période parisienne, close à la veille du transfert, et la période
//  bordelaise, ouverte le jour du transfert. Décision du 15/09 : chaque agence
//  garde ses chiffres justes, passé compris, et « Tout SMALL » reste continu
//  (aucun trou, aucun recouvrement).
//
//  Pourquoi DEUX fiches plutôt qu'une appartenance datée : le moteur sait
//  déjà découper une présence par fenêtre arrivée/départ. Le transfert se dit
//  donc dans le vocabulaire qu'il connaît, et `lib/staffing.ts` — réplique
//  certifiée de l'Excel — n'est pas touché d'une ligne.
//
//  Les deux fiches sont reliées par `Person.previousId` (la fiche EN COURS
//  pointe vers la précédente). Cette chaîne sert à rattacher chaque jour de
//  CRA à la BONNE période : le flux Boond ne connaît qu'un identifiant de
//  ressource, porté par la fiche en cours — sans la chaîne, une pleine charge
//  de l'historique reverserait les jours parisiens dans les chiffres de
//  Bordeaux.
// ============================================================

import { agenceEffective } from "./perimetre"

/** Un maillon de la chaîne : une fiche datée d'une même personne. */
export interface FicheChainon {
  id: string
  /** Identifiant Boond — porté par la seule fiche EN COURS. */
  boondId: string | null
  /** Fiche précédente de la même personne (null = début de chaîne). */
  previousId: string | null
  /** « YYYY-MM-DD » */
  arrival: string
  /** « YYYY-MM-DD », null = en cours. */
  departure: string | null
}

const jourValide = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d)

/** Veille (J−1) d'une date ISO. */
export function veilleDe(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

/** Lendemain (J+1) d'une date ISO. */
export function lendemainDe(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

/** La chaîne complète d'une fiche (elle-même + toutes ses devancières). */
export function chaineDe(fiches: FicheChainon[], id: string): FicheChainon[] {
  const parId = new Map(fiches.map((f) => [f.id, f]))
  const out: FicheChainon[] = []
  let courante = parId.get(id)
  const vus = new Set<string>()
  while (courante && !vus.has(courante.id)) {
    vus.add(courante.id)
    out.push(courante)
    courante = courante.previousId ? parId.get(courante.previousId) : undefined
  }
  return out
}

/**
 * À quelle fiche rattacher un jour de CRA ?
 *
 * Le flux Boond ne porte que l'identifiant de ressource : il désigne la fiche
 * EN COURS. On remonte sa chaîne et on retient la période qui CONTIENT le jour.
 * Aucun jour n'est jamais perdu : faute de période correspondante (trou de
 * chaîne, jour antérieur à la toute première arrivée), on retombe sur la fiche
 * qui porte l'identifiant — le comportement d'avant s7.
 */
export function ficheAuJour(
  fiches: FicheChainon[],
  boondId: string,
  date: string
): string | null {
  const porteuse = fiches.find((f) => f.boondId === boondId)
  if (!porteuse) return null
  if (!jourValide(date)) return porteuse.id
  for (const f of chaineDe(fiches, porteuse.id)) {
    if (date < f.arrival) continue
    if (f.departure && date > f.departure) continue
    return f.id
  }
  return porteuse.id
}

/**
 * Une fiche ACTIVE dans Boond que la base croit PARTIE : deux histoires très
 * différentes derrière le même symptôme.
 *
 *  · TRANSFERT — Boond la rattache à une AUTRE agence que celle de sa période :
 *    elle n'a pas quitté SMALL, elle a changé de maison (Charlotte, Anaïs).
 *  · DEPART_NON_CLOS — Boond la laisse dans la MÊME agence : elle est bien
 *    partie, et c'est la fiche Boond qui n'a pas été clôturée (Mélanie).
 *    Rien à faire dans l'app : le geste est dans BoondManager.
 *
 * La distinction se lit dans la donnée, elle ne se devine pas — et c'est elle
 * qui empêche `--tous` d'expédier à Bordeaux quelqu'un qui est simplement parti.
 */
export type NatureEcart = "TRANSFERT" | "DEPART_NON_CLOS"

export function natureEcart(
  agenceCourante: string | null | undefined,
  agenceOrigine: string
): NatureEcart {
  return agenceEffective(agenceCourante) === agenceEffective(agenceOrigine)
    ? "DEPART_NON_CLOS"
    : "TRANSFERT"
}

export interface Transfert {
  /** Fiche existante, qui porte l'historique. */
  arrival: string
  departure: string | null
  /** Premier jour dans la NOUVELLE agence. */
  dateTransfert: string
  agenceAvant: string
  agenceApres: string
}

export interface PlanTransfert {
  /** Période close, laissée à l'agence d'origine. */
  historique: { arrival: string; departure: string; agency: string }
  /** Période ouverte dans la nouvelle agence. */
  courante: { arrival: string; departure: null; agency: string }
}

/**
 * Vérifie et calcule le découpage. Les deux périodes sont JOINTIVES : la
 * première se clôt la veille du transfert, la seconde s'ouvre le jour même —
 * ni trou (qui ferait perdre des jours ouvrés au consolidé) ni recouvrement
 * (qui compterait la personne deux fois le même jour).
 */
export function planifieTransfert(t: Transfert): PlanTransfert {
  if (!jourValide(t.dateTransfert)) throw new Error(`Date de transfert invalide : ${t.dateTransfert}`)
  if (!jourValide(t.arrival)) throw new Error(`Date d'arrivée invalide : ${t.arrival}`)
  if (t.agenceAvant === t.agenceApres) {
    throw new Error(`Transfert sans changement d'agence (${t.agenceAvant}).`)
  }
  if (t.dateTransfert <= t.arrival) {
    throw new Error(
      `Le transfert (${t.dateTransfert}) doit être POSTÉRIEUR à l'arrivée (${t.arrival}) — ` +
        `sinon la période d'origine serait vide : c'est une correction d'agence, pas un transfert.`
    )
  }
  if (t.departure && t.departure > t.dateTransfert) {
    throw new Error(
      `La fiche porte un départ (${t.departure}) postérieur au transfert (${t.dateTransfert}) — ` +
        `à trancher à la main : départ réel ou transfert ?`
    )
  }
  return {
    historique: { arrival: t.arrival, departure: veilleDe(t.dateTransfert), agency: t.agenceAvant },
    courante: { arrival: t.dateTransfert, departure: null, agency: t.agenceApres },
  }
}
