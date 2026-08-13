// Couleurs de marque des clients pour le reporting — meilleure approximation
// des chartes publiques, À AJUSTER librement (la lisibilité ne repose jamais
// sur la couleur seule : nom + valeur figurent dans la légende et l'infobulle).
// Un client absent de la carte reçoit une couleur stable de la palette de
// secours. Logos : déposer un fichier public/logos/<slug>.png (ou .svg) —
// cf. public/logos/README.md ; les parts les plus grosses l'affichent.

export const CLIENT_BRAND: Record<string, string> = {
  GROUPAMA: "#009550", // vert Groupama
  ACCOR: "#1E1852", // bleu nuit Accor
  BPI: "#FFCD00", // jaune Bpifrance
  FDJ: "#003DA5", // bleu FDJ
  SUEZ: "#0C1C8C", // bleu Suez
  CNP: "#00937B", // vert CNP Assurances
  LBP: "#FFD100", // jaune La Banque Postale
  MH: "#E62D87", // rose Malakoff Humanis
  CNOEC: "#1B365D", // bleu Ordre des experts-comptables
  ONEY: "#81BC00", // vert Oney
  CARAC: "#9E1B32", // grenat Carac
  BROADCOM: "#CC092F", // rouge Broadcom
  CCF: "#00447C", // bleu CCF
  Dior: "#1A1A1A", // noir Dior
  DIOR: "#1A1A1A",
  LOREAL: "#3D3A35", // anthracite L'Oréal
  EDENRED: "#F72717", // rouge Edenred
  "PERNOD RICARD": "#001E62", // bleu Pernod Ricard
  PLUXEE: "#221C46", // violet Pluxee
  PMF: "#6E4A38", // brun (charte inconnue — placeholder)
}

// Palette de secours (tons soutenus, lisibles en tranche de donut).
const FALLBACK = [
  "#c2d26a",
  "#d3b7ab",
  "#8fae7e",
  "#7fa3bd",
  "#b08fb5",
  "#c9a06a",
  "#7fb3a4",
  "#8f9bc9",
  "#c98f9d",
  "#a3a48e",
]

/** Couleur d'un client : marque connue, sinon couleur stable de secours. */
export function clientColor(client: string, fallbackIndex: number): string {
  return CLIENT_BRAND[client] ?? CLIENT_BRAND[client.toUpperCase()] ?? FALLBACK[fallbackIndex % FALLBACK.length]
}

/** « PERNOD RICARD » → « pernod-ricard » (nom de fichier logo). */
export function clientSlug(client: string): string {
  return client
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

/** Couleur « Autres » (repli des petites parts). */
export const AUTRES_COLOR = "#acacab"
