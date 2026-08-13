import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { redirect } from "next/navigation"
import { formatDate } from "@/lib/utils"
import { Role, roleLabels } from "@/lib/types"
import RoleSelect from "./RoleSelect"

export default async function AdminUtilisateursPage() {
  const session = await auth()
  if (!session?.user || session.user.role !== Role.SIEGE) redirect("/accueil")

  const users = await prisma.user.findMany({
    orderBy: [{ role: "asc" }, { name: "asc" }],
  })

  const admins = users.filter((u) => u.role === Role.SIEGE).length
  const actifs = users.filter((u) => u.active).length

  const kpis = [
    { label: "Utilisateurs", value: users.length, underline: "bg-jaune-doux" },
    { label: "Actifs", value: actifs, underline: "bg-rose" },
    { label: admins > 1 ? "Comptes siège" : "Compte siège", value: admins, underline: "bg-gris-moyen" },
  ]

  return (
    <div className="px-11 py-9 max-w-[1080px] mx-auto max-md:px-5">
      <div className="mb-7">
        <div className="kicker">Admin</div>
        <h1 className="titre-page mt-1.5">
          Gestion des <span className="hl">utilisateurs</span>
        </h1>
        <p className="text-[13px] text-texte-2 mt-2">
          {users.length} utilisateur{users.length > 1 ? "s" : ""} · le rôle se modifie
          directement dans le tableau
        </p>
      </div>

      {/* Statistiques */}
      <div className="grid grid-cols-3 gap-3.5 mb-6 max-sm:grid-cols-1">
        {kpis.map((k) => (
          <div key={k.label} className="card px-5 py-4">
            <span
              className={`inline-block w-6 h-1 rounded-full mb-2.5 ${k.underline}`}
              aria-hidden="true"
            />
            <div className="titre-formation text-[26px] leading-none">{k.value}</div>
            <div className="text-[11px] tracking-[0.1em] uppercase text-label mt-2">
              {k.label}
            </div>
          </div>
        ))}
      </div>

      {/* Tableau des utilisateurs */}
      <div className="card overflow-hidden">
        <div className="px-5 py-3 border-b border-fond bg-creme">
          <div className="grid grid-cols-12 text-[10.5px] font-bold text-label uppercase tracking-[0.14em]">
            <div className="col-span-4">Nom</div>
            <div className="col-span-4">Email</div>
            <div className="col-span-2">Rôle</div>
            <div className="col-span-2 text-right">Créé le</div>
          </div>
        </div>
        <div className="divide-y divide-fond">
          {users.map((u) => (
            <div key={u.id} className="px-5 py-3 grid grid-cols-12 items-center text-sm">
              <div className="col-span-4 font-bold text-anthracite">
                {u.name}
                {!u.active && (
                  <span className="badge ml-2" title="Compte désactivé">
                    inactif
                  </span>
                )}
              </div>
              <div className="col-span-4 text-texte-2 text-xs truncate">{u.email}</div>
              <div className="col-span-2">
                <RoleSelect userId={u.id} role={u.role} isSelf={u.id === session.user.id} />
              </div>
              <div className="col-span-2 text-right text-xs text-texte-2">
                {formatDate(u.createdAt)}
              </div>
            </div>
          ))}
        </div>
      </div>

      <p className="text-[12px] text-label mt-4">
        Rôles disponibles : {Object.values(roleLabels).join(" · ")} — s&rsquo;étendent dans{" "}
        <code className="font-mono text-[11px]">lib/types.ts</code>.
      </p>
    </div>
  )
}
