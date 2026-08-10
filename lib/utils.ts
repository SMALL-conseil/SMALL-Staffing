// Utilitaires transverses du gabarit — volontairement minimal.
// Convention SMALL : dates affichées en français, heures « murales »
// Europe/Paris (le serveur tourne en UTC : ne jamais construire d'affichage
// d'heure sans passer par un formatteur à timeZone explicite).

export function formatDate(date: Date | string): string {
  return new Date(date).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  })
}

export function formatDateShort(date: Date | string): string {
  return new Date(date).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  })
}

export function formatDateTimeParis(date: Date | string): string {
  return new Date(date).toLocaleString("fr-FR", {
    timeZone: "Europe/Paris",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}
