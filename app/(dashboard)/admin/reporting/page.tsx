import { auth } from "@/auth"
import { redirect } from "next/navigation"

// Emplacement standard du reporting (réservé ADMIN). À alimenter avec les KPIs
// de l'outil ; le pattern SMALL : cartes KPI + tableaux dans des cards, et un
// export Excel via la lib `xlsx` (déjà en dépendance) sur une route
// /api/exports/reporting quand le besoin arrive.
export default async function ReportingPage() {
  const session = await auth()
  if (!session?.user || session.user.role !== "ADMIN") redirect("/accueil")

  return (
    <div className="px-11 py-9 max-w-[1080px] mx-auto max-md:px-5">
      <div className="mb-7">
        <div className="kicker">Admin</div>
        <h1 className="titre-page mt-1.5">
          <span className="hl">Reporting</span>
        </h1>
        <p className="text-[13px] text-texte-2 mt-2">
          Emplacement prêt à recevoir les indicateurs de l&rsquo;outil
        </p>
      </div>

      <div className="card px-6 py-10 text-center text-sm text-texte-2">
        Aucun indicateur pour le moment — construisez-les ici en suivant le pattern
        des cartes KPI de la page d&rsquo;accueil.
      </div>
    </div>
  )
}
