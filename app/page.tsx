import { redirect } from "next/navigation"

// La racine renvoie vers la page d'accueil du tableau de bord (la protection
// d'authentification est assurée par le middleware + le layout (dashboard)).
export default function RootPage() {
  redirect("/accueil")
}
