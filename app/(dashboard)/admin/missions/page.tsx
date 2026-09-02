import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { redirect } from "next/navigation"
import { Role, PersonKind } from "@/lib/types"
import { toIsoDate } from "@/lib/staffing-load"
import { todayParis } from "@/lib/staffing-ui"
import MissionsAdmin from "./MissionsAdmin"

// Registre des missions (ADMIN) — la saisie qui remplace l'Excel.
export default async function AdminMissionsPage() {
  const session = await auth()
  if (!session?.user || session.user.role !== Role.SIEGE) redirect("/accueil")

  const [missions, consultants] = await Promise.all([
    prisma.mission.findMany({
      orderBy: [{ rank: "asc" }, { createdAt: "asc" }],
      include: { person: { select: { name: true, defaultDailyRate: true } } },
    }),
    prisma.person.findMany({
      where: { kind: PersonKind.CONSULTANT, active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, grade: true },
    }),
  ])

  const today = todayParis()
  // NB : fees (honoraires) n'est sérialisé QUE vers cette page, gate Siège.
  const rows = missions.map((m) => ({
    id: m.id,
    personId: m.personId,
    personName: m.person.name,
    client: m.client,
    start: toIsoDate(m.startDate),
    end: toIsoDate(m.endDate),
    share: m.share,
    note: m.note,
    rank: m.rank,
    fees: m.fees,
    defaultRate: m.person.defaultDailyRate,
  }))
  const clients = [...new Set(rows.map((m) => m.client))].sort((a, b) => a.localeCompare(b, "fr"))
  const enCours = rows.filter((m) => m.start <= today && today <= m.end)

  const kpis = [
    { label: "Missions", value: rows.length, underline: "bg-jaune-doux" },
    { label: "En cours", value: enCours.length, underline: "bg-rose" },
    { label: "Clients", value: clients.length, underline: "bg-gris-moyen" },
  ]

  return (
    <div className="px-11 py-9 max-w-[1150px] mx-auto max-md:px-5">
      <div className="mb-7">
        <div className="kicker">Registres</div>
        <h1 className="titre-page mt-1.5">
          Registre des <span className="hl">missions</span>
        </h1>
        <p className="text-[13px] text-texte-2 mt-2">
          La saisie de référence : consultant, client, dates, part d&rsquo;intervention — tout le
          reste se recalcule.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3.5 mb-6 max-sm:grid-cols-1">
        {kpis.map((k) => (
          <div key={k.label} className="card px-5 py-4">
            <span className={`inline-block w-6 h-1 rounded-full mb-2.5 ${k.underline}`} aria-hidden="true" />
            <div className="titre-formation text-[26px] leading-none">{k.value}</div>
            <div className="text-[11px] tracking-[0.1em] uppercase text-label mt-2">{k.label}</div>
          </div>
        ))}
      </div>

      <MissionsAdmin missions={rows} consultants={consultants} clients={clients} />
    </div>
  )
}
