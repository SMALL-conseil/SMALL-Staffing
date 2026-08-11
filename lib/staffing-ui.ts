// Aides d'affichage du staffing — pur (utilisable côté serveur et client).
// Convention SMALL : dates « murales » Europe/Paris, formats français.
import type { StaffMission } from "./staffing"

/** Date du jour en Europe/Paris, « YYYY-MM-DD » (le serveur tourne en UTC). */
export function todayParis(): string {
  return new Intl.DateTimeFormat("fr-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
}

export const MOIS_LONGS = [
  "janvier",
  "février",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "décembre",
] as const

export const MOIS_COURTS = [
  "Janv",
  "Févr",
  "Mars",
  "Avr",
  "Mai",
  "Juin",
  "Juil",
  "Août",
  "Sept",
  "Oct",
  "Nov",
  "Déc",
] as const

/** « 84,97 % » (décimales françaises). */
export function formatPct(x: number, decimals = 2): string {
  return `${(100 * x).toLocaleString("fr-FR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })} %`
}

/** ETP en français : « 29,24 ». */
export function formatEtp(x: number, decimals = 2): string {
  return x.toLocaleString("fr-FR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

// ------------------------------------------------------------
// Couleurs clients de la carte de staffing.
// Le nom du client est TOUJOURS écrit dans la cellule : la couleur est une
// aide au balayage, jamais le seul porteur d'identité. Fonds pastel clairs
// (texte anthracite ≥ AA), bordure du même ton, attribution STABLE par ordre
// de première apparition dans le registre des missions (jamais recyclée au
// fil des filtres).
// ------------------------------------------------------------

export interface ClientColor {
  bg: string
  border: string
}

const CLIENT_PALETTE: ClientColor[] = [
  { bg: "#f1f8bc", border: "#c2d26a" }, // jaune Brume
  { bg: "#f2e4dd", border: "#d3b7ab" }, // rose Brume
  { bg: "#e3edda", border: "#b8cfa9" }, // amande
  { bg: "#ddeaf2", border: "#a9c4d6" }, // bleu brume
  { bg: "#efe3f0", border: "#cfaed2" }, // lilas
  { bg: "#f6e7cf", border: "#dcc294" }, // sable
  { bg: "#e8f0e9", border: "#b9d1bc" }, // céladon
  { bg: "#e5e9f5", border: "#b3bce0" }, // pervenche
  { bg: "#f3e0e4", border: "#d8a8b4" }, // dragée
  { bg: "#e9f4f2", border: "#aed3cd" }, // aqua pâle
  { bg: "#f0eadf", border: "#cdc0a8" }, // grège
  { bg: "#eef2d9", border: "#c6d194" }, // tilleul
  { bg: "#f0e2d8", border: "#d8b394" }, // pêche
  { bg: "#e4e7ee", border: "#b6bdd0" }, // gris bleuté
  { bg: "#f5ecf3", border: "#d4b3cc" }, // mauve pâle
  { bg: "#f9eee4", border: "#ddc3a8" }, // beige Brume
]

/**
 * Couleur par client, stable : ordre de première apparition dans le registre
 * des missions (rank). Au-delà de la palette, on boucle — le nom écrit dans
 * chaque cellule reste l'identité première.
 */
export function clientColorMap(missions: StaffMission[]): Map<string, ClientColor> {
  const map = new Map<string, ClientColor>()
  const ordered = [...missions].sort((a, b) => a.rank - b.rank)
  for (const m of ordered) {
    if (!map.has(m.client)) {
      map.set(m.client, CLIENT_PALETTE[map.size % CLIENT_PALETTE.length])
    }
  }
  return map
}

/** « août 2026 » pour un couple (année, mois 1-12). */
export function libelleMois(year: number, month: number): string {
  return `${MOIS_LONGS[month - 1]} ${year}`
}

// ------------------------------------------------------------
// Variations des KPIs (tuiles comparatives du tableau de bord).
// Taux : variation en POINTS de pourcentage (usage métier) ;
// ETP : variation relative en %. Tendance selon le « bon sens » :
// un taux qui monte est bon, un effectif qui monte est bon.
// ------------------------------------------------------------

export type Tendance = "hausse" | "baisse" | "stable"

export interface Variation {
  /** ex. « +5,3 pts » ou « −8,2 % » — null si non calculable (référence nulle). */
  texte: string | null
  tendance: Tendance
  /** true = évolution dans le bon sens (vert), false = mauvais sens (rouge). */
  bonSens: boolean
}

/** Variation d'un TAUX (0–1) en points de pourcentage (référence nulle → non calculable). */
export function variationTaux(actuel: number, precedent: number): Variation {
  if (precedent <= 0) return { texte: null, tendance: "stable", bonSens: true }
  const deltaPts = (actuel - precedent) * 100
  const tendance: Tendance = Math.abs(deltaPts) < 0.05 ? "stable" : deltaPts > 0 ? "hausse" : "baisse"
  const signe = deltaPts > 0 ? "+" : deltaPts < 0 ? "−" : "±"
  return {
    texte: `${signe}${Math.abs(deltaPts).toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} pts`,
    tendance,
    bonSens: tendance !== "baisse",
  }
}

/** Variation relative d'un ETP (référence nulle → non calculable). */
export function variationEtp(actuel: number, precedent: number): Variation {
  if (precedent <= 0) return { texte: null, tendance: "stable", bonSens: true }
  const deltaPct = ((actuel - precedent) / precedent) * 100
  const tendance: Tendance = Math.abs(deltaPct) < 0.05 ? "stable" : deltaPct > 0 ? "hausse" : "baisse"
  const signe = deltaPct > 0 ? "+" : deltaPct < 0 ? "−" : "±"
  return {
    texte: `${signe}${Math.abs(deltaPct).toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`,
    tendance,
    bonSens: tendance !== "baisse",
  }
}
