// ============================================================
//  Périmètres d'observation (s5) — module PUR, testé dans
//  tests/perimetre.test.ts. Aucune dépendance Prisma/Next : entrées =
//  chaînes simples, pour que les droits soient vérifiables sans base.
//
//  Décisions du 15/09/2026 :
//   · une personne SANS agence est rattachée à PARIS (continuité du classeur
//     « Staffing SMALL Paris » : les chiffres Paris restent ceux d'avant s5),
//     et signalée pour correction ;
//   · un CONSULTANT n'accède qu'au périmètre de SON agence ; le SIÈGE accède
//     aux deux agences et au cabinet entier ;
//   · périmètre par défaut = Paris pour le siège, sa propre agence sinon.
//  Le périmètre demandé est TOUJOURS revalidé côté serveur contre cette
//  liste : un paramètre ou un cookie bricolé ne donne accès à rien.
// ============================================================
import { Agency, Perimetre, Role } from "./types"

/** Agence retenue quand le registre n'en porte pas (décision du 15/09). */
export const AGENCE_PAR_DEFAUT: Agency = Agency.PARIS

/** Agence d'une personne, repli compris. */
export function agenceEffective(agency: string | null | undefined): Agency {
  return agency === Agency.BORDEAUX ? Agency.BORDEAUX : AGENCE_PAR_DEFAUT
}

/** Une agence connue (hors repli) ? — sert aux signalements « à renseigner ». */
export function agenceRenseignee(agency: string | null | undefined): boolean {
  return agency === Agency.PARIS || agency === Agency.BORDEAUX
}

/**
 * Périmètres qu'un compte peut observer.
 * · SIEGE : Paris, Bordeaux, Tout SMALL ;
 * · CONSULTANT : sa seule agence (repli Paris s'il n'est pas rattaché).
 */
export function perimetresAutorises(role: string, agence: string | null | undefined): Perimetre[] {
  if (role === Role.SIEGE) return [Perimetre.PARIS, Perimetre.BORDEAUX, Perimetre.TOUT]
  return [agenceEffective(agence) === Agency.BORDEAUX ? Perimetre.BORDEAUX : Perimetre.PARIS]
}

/** Périmètre affiché par défaut : Paris pour le siège, son agence sinon. */
export function perimetreParDefaut(role: string, agence: string | null | undefined): Perimetre {
  const autorises = perimetresAutorises(role, agence)
  return autorises.includes(Perimetre.PARIS) ? Perimetre.PARIS : autorises[0]
}

/**
 * Valide un périmètre DEMANDÉ (cookie, lien, formulaire) contre les droits du
 * compte. Toute valeur inconnue ou interdite retombe sur le défaut — jamais
 * d'erreur bruyante : un lien partagé entre collègues doit rester cliquable.
 */
export function resoudrePerimetre(
  demande: string | null | undefined,
  role: string,
  agence: string | null | undefined
): Perimetre {
  const autorises = perimetresAutorises(role, agence)
  const p = (demande ?? "").toUpperCase()
  return (autorises as string[]).includes(p) ? (p as Perimetre) : perimetreParDefaut(role, agence)
}

/** La personne entre-t-elle dans le périmètre observé ? */
export function dansLePerimetre(agency: string | null | undefined, perimetre: Perimetre): boolean {
  if (perimetre === Perimetre.TOUT) return true
  return agenceEffective(agency) === perimetre
}

/** Suffixe de titre de page : « — Bordeaux », vide pour Paris seul. */
export function libellePerimetre(perimetre: Perimetre): string {
  return perimetre === Perimetre.TOUT ? "Tout SMALL" : perimetre === Perimetre.BORDEAUX ? "Bordeaux" : "Paris"
}
