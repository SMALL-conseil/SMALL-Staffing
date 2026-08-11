import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { redirect } from "next/navigation"
import { PersonKind } from "@/lib/types"
import { toIsoDate } from "@/lib/staffing-load"
import { todayParis } from "@/lib/staffing-ui"
import { formatDateShort } from "@/lib/utils"
import AbsencesAdmin from "./AbsencesAdmin"

// Registre des personnes (ADMIN) — consultants et siège en LECTURE (la
// synchro Boond du lot s4 alimentera ce registre ; d'ici là : import Excel).
// Les absences prolongées, elles, se gèrent ici (CRUD).
export default async function AdminPersonnesPage() {
  const session = await auth()
  if (!session?.user || session.user.role !== "ADMIN") redirect("/accueil")

  const persons = await prisma.person.findMany({
    where: { active: true },
    include: {
      absences: { orderBy: { startDate: "asc" } },
      manager: { select: { name: true } },
      _count: { select: { missions: true } },
    },
    orderBy: { createdAt: "asc" },
  })

  const today = todayParis()
  const consultants = persons.filter((p) => p.kind === PersonKind.CONSULTANT)
  const siege = persons.filter((p) => p.kind === PersonKind.SIEGE)
  const presents = consultants.filter(
    (p) => !p.departureDate || toIsoDate(p.departureDate) >= today
  )
  const absences = consultants
    .flatMap((p) =>
      p.absences.map((a) => ({
        id: a.id,
        personId: p.id,
        personName: p.name,
        start: toIsoDate(a.startDate),
        end: a.endDate ? toIsoDate(a.endDate) : null,
        label: a.label,
      }))
    )
    .sort((a, b) => a.start.localeCompare(b.start))
  const absencesEnCours = absences.filter((a) => a.start <= today && (!a.end || a.end >= today))

  const kpis = [
    { label: "Consultants (présents)", value: presents.length, underline: "bg-jaune-doux" },
    { label: "Siège", value: siege.length, underline: "bg-rose" },
    { label: "Absences en cours", value: absencesEnCours.length, underline: "bg-gris-moyen" },
  ]

  const dateCell = (d: Date | null) => (d ? formatDateShort(toIsoDate(d)) : "—")

  return (
    <div className="px-11 py-9 max-w-[1150px] mx-auto max-md:px-5">
      <div className="mb-7">
        <div className="kicker">Registres</div>
        <h1 className="titre-page mt-1.5">
          Personnes &amp; <span className="hl">absences</span>
        </h1>
        <p className="text-[13px] text-texte-2 mt-2">
          Consultants et siège en lecture — ce registre sera alimenté par la synchro Boond (lot
          s4) ; d&rsquo;ici là, source : import Excel. Les absences prolongées se gèrent ici.
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

      <div className="mb-5">
        <AbsencesAdmin
          absences={absences}
          consultants={presents.map((c) => ({ id: c.id, name: c.name, grade: c.grade }))}
        />
      </div>

      <div className="card overflow-hidden mb-5">
        <div className="px-5 py-3 border-b border-fond bg-creme flex items-baseline justify-between">
          <span className="text-[12px] font-bold text-anthracite">
            Consultants ({consultants.length})
          </span>
          <span className="text-[10.5px] text-label uppercase tracking-[0.12em]">lecture seule</span>
        </div>
        <div className="px-5 py-2 border-b border-fond">
          <div className="grid grid-cols-12 gap-2 text-[10.5px] font-bold text-label uppercase tracking-[0.14em]">
            <div className="col-span-3">Nom</div>
            <div className="col-span-1">Grade</div>
            <div className="col-span-2 text-right">Arrivée</div>
            <div className="col-span-2 text-right">Départ</div>
            <div className="col-span-3">Manager</div>
            <div className="col-span-1 text-right">Missions</div>
          </div>
        </div>
        <div className="divide-y divide-fond">
          {consultants.map((p) => (
            <div key={p.id} className="px-5 py-2 grid grid-cols-12 gap-2 items-center text-[12.5px]">
              <div className="col-span-3 font-bold text-anthracite truncate">
                {p.name}
                {p.email && (
                  <span className="block text-[10.5px] text-label font-normal truncate">{p.email}</span>
                )}
              </div>
              <div className="col-span-1 text-texte">{p.grade}</div>
              <div className="col-span-2 text-right text-texte-2 text-[12px]">{dateCell(p.arrivalDate)}</div>
              <div className="col-span-2 text-right text-texte-2 text-[12px]">{dateCell(p.departureDate)}</div>
              <div className="col-span-3 text-texte-2 truncate">{p.manager?.name ?? "—"}</div>
              <div className="col-span-1 text-right text-texte">{p._count.missions}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="px-5 py-3 border-b border-fond bg-creme flex items-baseline justify-between">
          <span className="text-[12px] font-bold text-anthracite">Siège ({siege.length})</span>
          <span className="text-[10.5px] text-label uppercase tracking-[0.12em]">lecture seule</span>
        </div>
        <div className="px-5 py-2 border-b border-fond">
          <div className="grid grid-cols-12 gap-2 text-[10.5px] font-bold text-label uppercase tracking-[0.14em]">
            <div className="col-span-4">Nom</div>
            <div className="col-span-4">Grade</div>
            <div className="col-span-2 text-right">Arrivée</div>
            <div className="col-span-2 text-right">Départ</div>
          </div>
        </div>
        <div className="divide-y divide-fond">
          {siege.map((p) => (
            <div key={p.id} className="px-5 py-2 grid grid-cols-12 gap-2 items-center text-[12.5px]">
              <div className="col-span-4 font-bold text-anthracite truncate">{p.name}</div>
              <div className="col-span-4 text-texte truncate">{p.grade}</div>
              <div className="col-span-2 text-right text-texte-2 text-[12px]">{dateCell(p.arrivalDate)}</div>
              <div className="col-span-2 text-right text-texte-2 text-[12px]">{dateCell(p.departureDate)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
