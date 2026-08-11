"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { signOut } from "next-auth/react"
import {
  Users,
  BarChart3,
  LogOut,
  CalendarDays,
  Hourglass,
  Briefcase,
  ClipboardList,
  KeyRound,
} from "lucide-react"
import { roleLabels } from "@/lib/types"

type NavItem = {
  label: string
  href: string
  icon: React.ElementType
}

// Navigation — le groupe « Menu » est visible de tous, le groupe
// « Registres & admin » réservé au rôle ADMIN.
const NAV_MENU: NavItem[] = [
  { label: "Tableau de bord", href: "/accueil", icon: BarChart3 },
  { label: "Carte de staffing", href: "/carte", icon: CalendarDays },
  { label: "Intercontrat", href: "/intercontrat", icon: Hourglass },
  { label: "Effectifs", href: "/effectifs", icon: Users },
]

const NAV_ADMIN: NavItem[] = [
  { label: "Missions", href: "/admin/missions", icon: Briefcase },
  { label: "Personnes & absences", href: "/admin/personnes", icon: ClipboardList },
  { label: "Utilisateurs", href: "/admin/utilisateurs", icon: KeyRound },
]

interface SidebarProps {
  user: { name?: string | null; email?: string | null; role: string }
}

export default function Sidebar({ user }: SidebarProps) {
  const pathname = usePathname()
  const groups: { kicker: string; items: NavItem[] }[] = [
    { kicker: "Menu", items: NAV_MENU },
    ...(user.role === "ADMIN" ? [{ kicker: "Registres & admin", items: NAV_ADMIN }] : []),
  ]

  return (
    <aside className="w-60 min-h-screen bg-carte border-r border-ligne flex flex-col shrink-0">
      {/* Marque */}
      <div className="px-6 pt-7 pb-5">
        <div className="text-anthracite text-[22px] font-bold tracking-[0.18em]">SMALL</div>
        <div className="text-label text-[10px] tracking-[0.32em] uppercase mt-1">
          Staffing
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3.5 py-2" aria-label="Navigation principale">
        {groups.map((group) => (
          <div key={group.kicker}>
            <div className="text-label text-[10px] tracking-[0.2em] uppercase px-3.5 pt-3 pb-2">
              {group.kicker}
            </div>
            {group.items.map((item) => {
              const isActive = pathname.startsWith(item.href)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={isActive ? "page" : undefined}
                  className={`flex items-center gap-3 px-3.5 py-2.5 rounded-[9px] text-[13.5px] mb-0.5 transition-colors ${
                    isActive
                      ? "bg-jaune-pale text-anthracite font-bold"
                      : "text-texte-2 hover:text-anthracite hover:bg-fond"
                  }`}
                >
                  <item.icon size={16} aria-hidden="true" />
                  <span className="flex-1">{item.label}</span>
                </Link>
              )
            })}
          </div>
        ))}
      </nav>

      {/* Utilisateur */}
      <div className="m-3.5 px-3 py-3 border border-ligne rounded-xl flex items-center gap-2.5">
        <div className="w-[33px] h-[33px] rounded-full bg-fond border border-ligne text-encre flex items-center justify-center font-bold text-[13px] shrink-0">
          {user.name?.[0]?.toUpperCase() ?? "U"}
        </div>
        <div className="min-w-0">
          <div className="text-anthracite text-[12.5px] font-bold truncate">{user.name}</div>
          <div className="text-label text-[11px] mt-px truncate">
            {roleLabels[user.role] ?? user.role}
          </div>
        </div>
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          aria-label="Déconnexion"
          title="Déconnexion"
          className="ml-auto text-label hover:text-anthracite transition-colors shrink-0 p-1 rounded"
        >
          <LogOut size={15} aria-hidden="true" />
        </button>
      </div>
    </aside>
  )
}
