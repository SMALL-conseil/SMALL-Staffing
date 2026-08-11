import { auth } from "@/auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { loadStaffingData } from "@/lib/staffing-load"
import { carteStaffing, staffableDays } from "@/lib/staffing"
import { clientColorMap, MOIS_COURTS, todayParis } from "@/lib/staffing-ui"

// Carte de staffing — grille consultant × mois : LE client du mois (1re
// mission du registre chevauchant le mois, si jours staffés > 0), « IC » si
// staffable sans mission, vide si hors effectif. Année navigable.
export default async function CartePage({
  searchParams,
}: {
  searchParams: Promise<{ annee?: string }>
}) {
  const session = await auth()
  if (!session?.user) redirect("/login")

  const today = todayParis()
  const currentYear = Number(today.slice(0, 4))
  const currentMonth = Number(today.slice(5, 7))
  const param = (await searchParams).annee
  const parsed = Number(param)
  const year = Number.isInteger(parsed) && parsed >= 2000 && parsed <= 2100 ? parsed : currentYear

  const { people, missions } = await loadStaffingData()
  const rows = carteStaffing(people, missions, year)
  const byId = new Map(people.map((p) => [p.id, p]))
  const colors = clientColorMap(missions)

  const clientsAffiches = [...new Set(rows.flatMap((r) => r.clients.filter((c): c is string => !!c)))]

  return (
    <div className="px-11 py-9 max-w-[1400px] mx-auto max-md:px-5">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="kicker">SMALL Staffing</div>
          <h1 className="titre-page mt-1.5">
            Carte de <span className="hl">staffing</span>
          </h1>
          <p className="text-[13px] text-texte-2 mt-2">
            {rows.length} consultants · {clientsAffiches.length} clients sur {year}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href={`/carte?annee=${year - 1}`}
            className="chip inline-flex items-center gap-1"
            aria-label={`Année ${year - 1}`}
          >
            <ChevronLeft size={14} aria-hidden="true" /> {year - 1}
          </Link>
          <span className="chip chip-on cursor-default">{year}</span>
          <Link
            href={`/carte?annee=${year + 1}`}
            className="chip inline-flex items-center gap-1"
            aria-label={`Année ${year + 1}`}
          >
            {year + 1} <ChevronRight size={14} aria-hidden="true" />
          </Link>
          {year !== currentYear && (
            <Link href="/carte" className="chip">
              Aujourd&rsquo;hui
            </Link>
          )}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="card px-6 py-10 text-center text-sm text-texte-2">
          Aucun consultant sur {year}.
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full border-separate border-spacing-0 text-[11.5px]">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-carte text-left text-[10px] uppercase tracking-[0.1em] text-label font-bold px-3 py-3 border-b border-ligne min-w-[190px]">
                  Consultant
                </th>
                {MOIS_COURTS.map((m, i) => (
                  <th
                    key={m}
                    className={`text-center text-[10px] uppercase tracking-[0.08em] font-bold px-0.5 py-3 border-b border-ligne min-w-[66px] ${
                      year === currentYear && i + 1 === currentMonth
                        ? "bg-jaune-pale text-anthracite"
                        : "text-label"
                    }`}
                  >
                    {m}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const person = byId.get(r.personId)
                return (
                  <tr key={r.personId} className="group">
                    <td className="sticky left-0 z-10 bg-carte group-hover:bg-fond px-3 py-1.5 border-b border-ligne whitespace-nowrap">
                      <span className="text-[12px] font-bold text-anthracite">{r.name}</span>
                      <span className="text-[10.5px] text-label ml-2">{r.grade}</span>
                    </td>
                    {r.clients.map((client, i) => {
                      const highlight =
                        year === currentYear && i + 1 === currentMonth ? "bg-jaune-pale/30" : ""
                      if (client) {
                        const c = colors.get(client)
                        return (
                          <td key={i} className={`px-0.5 py-1.5 border-b border-ligne ${highlight}`}>
                            <div
                              title={`${r.name} — ${client}`}
                              className="rounded-[6px] border px-0.5 py-1 text-[10px] font-bold tracking-[-0.015em] text-anthracite text-center truncate max-w-[66px] mx-auto"
                              style={{ background: c?.bg, borderColor: c?.border }}
                            >
                              {client}
                            </div>
                          </td>
                        )
                      }
                      const staffable = person ? staffableDays(person, missions, year, i + 1) > 0 : false
                      return (
                        <td
                          key={i}
                          className={`px-1 py-1.5 border-b border-ligne text-center ${highlight}`}
                        >
                          {staffable ? (
                            <span
                              title={`${r.name} — en intercontrat`}
                              className="inline-block rounded-[6px] bg-rose-pale text-rose-texte px-2 py-1 text-[10px] font-bold"
                            >
                              IC
                            </span>
                          ) : (
                            <span className="text-ligne-forte" aria-label="hors effectif">
                              —
                            </span>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {clientsAffiches.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-4" aria-label="Légende des clients">
          {clientsAffiches.map((client) => {
            const c = colors.get(client)
            return (
              <span
                key={client}
                className="tag border text-anthracite"
                style={{ background: c?.bg, borderColor: c?.border }}
              >
                {client}
              </span>
            )
          })}
          <span className="tag bg-rose-pale text-rose-texte">IC = intercontrat</span>
        </div>
      )}
    </div>
  )
}
