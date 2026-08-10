import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { roleLabels } from "@/lib/types"

// Page d'accueil du gabarit — à remplacer par la première vraie page de
// l'outil. Elle montre les briques de la charte Brume : kicker, titre avec
// surlignage, cartes KPI, carte de contenu.
export default async function AccueilPage() {
  const session = await auth()
  if (!session?.user) redirect("/login")

  return (
    <div className="px-11 py-9 max-w-[1080px] mx-auto max-md:px-5">
      <div className="mb-7">
        <div className="kicker">SMALL Big Change</div>
        <h1 className="titre-page mt-1.5">
          Bienvenue sur <span className="hl">SMALL Staffing</span>
        </h1>
        <p className="text-[13px] text-texte-2 mt-2">
          Connecté en tant que {session.user.name} — {roleLabels[session.user.role] ?? session.user.role}
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5 mb-8">
        {[
          { label: "Indicateur 1", value: "—", underline: "bg-jaune-doux" },
          { label: "Indicateur 2", value: "—", underline: "bg-rose" },
          { label: "Indicateur 3", value: "—", underline: "bg-gris-moyen" },
          { label: "Indicateur 4", value: "—", underline: "bg-jaune-vif" },
        ].map((k) => (
          <div key={k.label} className="card px-5 py-5">
            <span
              className={`inline-block w-6 h-1 rounded-full mb-3 ${k.underline}`}
              aria-hidden="true"
            />
            <div className="titre-formation text-[30px] leading-none">{k.value}</div>
            <div className="text-[11px] tracking-[0.1em] uppercase text-label mt-2">
              {k.label}
            </div>
          </div>
        ))}
      </div>

      <div className="card px-6 py-6">
        <h2 className="titre-section text-[16px]!">Par où commencer</h2>
        <div className="text-[13.5px] text-texte mt-3 space-y-2.5 max-w-2xl">
          <p>
            Ce gabarit embarque tout l&rsquo;invariant du framework SMALL : la charte
            graphique Brume, l&rsquo;authentification (email/mot de passe + SSO Microsoft
            optionnel), la gestion des utilisateurs et des rôles, la base PostgreSQL avec
            migrations versionnées, et la chaîne de déploiement complète
            (préprod sur la branche <code className="font-mono text-[12px]">preprod</code>,
            production sur les tags <code className="font-mono text-[12px]">v*</code>).
          </p>
          <p>
            Développez vos pages dans <code className="font-mono text-[12px]">app/(dashboard)/</code>,
            ajoutez vos modèles dans <code className="font-mono text-[12px]">prisma/schema.prisma</code>
            (toujours avec une migration versionnée !), et référez-vous au
            <code className="font-mono text-[12px]"> CLAUDE.md</code> et au
            <code className="font-mono text-[12px]"> README.md</code> pour les conventions
            et les pièges connus.
          </p>
        </div>
      </div>
    </div>
  )
}
