import { auth } from "@/auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { loadStaffingData } from "@/lib/staffing-load"
import { headcount, type HeadcountPerson } from "@/lib/staffing"
import { CONSULTANT_GRADES, SIEGE_GRADES } from "@/lib/types"
import { MOIS_COURTS, todayParis } from "@/lib/staffing-ui"

// Suivi des effectifs — réplique de l'onglet Suivi_Effectif : têtes présentes
// par grade × mois (janvier → janvier n+1), siège puis consultants, totaux.
// Une personne dont le grade est hors grilles (ex. « DG SMALL Bordeaux »)
// n'est comptée nulle part — fidèle à l'Excel.
export default async function EffectifsPage({
  searchParams,
}: {
  searchParams: Promise<{ annee?: string }>
}) {
  const session = await auth()
  if (!session?.user) redirect("/login")

  const today = todayParis()
  const currentYear = Number(today.slice(0, 4))
  const currentMonth = Number(today.slice(5, 7))
  const parsed = Number((await searchParams).annee)
  const year = Number.isInteger(parsed) && parsed >= 2000 && parsed <= 2100 ? parsed : currentYear

  const { people, siege } = await loadStaffingData()
  const months: { y: number; m: number; label: string }[] = [
    ...Array.from({ length: 12 }, (_, i) => ({ y: year, m: i + 1, label: MOIS_COURTS[i] })),
    { y: year + 1, m: 1, label: `Janv ${String(year + 1).slice(2)}` },
  ]
  const isCurrent = (c: { y: number; m: number }) => c.y === currentYear && c.m === currentMonth

  const ligne = (pool: HeadcountPerson[], grade: string) =>
    months.map((c) => headcount(pool, grade, c.y, c.m))
  const somme = (rows: number[][]) =>
    months.map((_, i) => rows.reduce((n, r) => n + r[i], 0))

  const siegeRows = SIEGE_GRADES.map((g) => ({ label: g, values: ligne(siege, g) }))
  const consRows = CONSULTANT_GRADES.map((g) => ({ label: g, values: ligne(people, g) }))
  const totalSiege = somme(siegeRows.map((r) => r.values))
  const totalCons = somme(consRows.map((r) => r.values))
  const total = months.map((_, i) => totalSiege[i] + totalCons[i])

  const horsGrilles =
    siege.filter((p) => !(SIEGE_GRADES as readonly string[]).includes(p.grade)).length +
    people.filter((p) => !(CONSULTANT_GRADES as readonly string[]).includes(p.grade)).length

  const cell = (v: number, strong = false) => (
    <span className={v === 0 ? "text-gris-moyen" : strong ? "" : "text-texte"}>{v}</span>
  )

  const rowClass = (c: { y: number; m: number }) =>
    isCurrent(c) ? "bg-jaune-pale/40" : ""

  return (
    <div className="px-11 py-9 max-w-[1200px] mx-auto max-md:px-5">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="kicker">SMALL Staffing</div>
          <h1 className="titre-page mt-1.5">
            Suivi des <span className="hl">effectifs</span>
          </h1>
          <p className="text-[13px] text-texte-2 mt-2">
            Têtes présentes par grade — arrivés au plus tard en fin de mois, départ après le 1er
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/effectifs?annee=${year - 1}`} className="chip inline-flex items-center gap-1">
            <ChevronLeft size={14} aria-hidden="true" /> {year - 1}
          </Link>
          <span className="chip chip-on cursor-default">{year}</span>
          <Link href={`/effectifs?annee=${year + 1}`} className="chip inline-flex items-center gap-1">
            {year + 1} <ChevronRight size={14} aria-hidden="true" />
          </Link>
          {year !== currentYear && (
            <Link href="/effectifs" className="chip">
              Aujourd&rsquo;hui
            </Link>
          )}
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full border-separate border-spacing-0 text-[12px]">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-carte text-left text-[10px] uppercase tracking-[0.1em] text-label font-bold px-4 py-3 border-b border-ligne min-w-[190px]">
                Effectif
              </th>
              {months.map((c) => (
                <th
                  key={`${c.y}-${c.m}`}
                  className={`text-center text-[10px] uppercase tracking-[0.06em] font-bold px-1 py-3 border-b border-ligne min-w-[58px] ${
                    isCurrent(c) ? "bg-jaune-pale text-anthracite" : "text-label"
                  }`}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="font-bold text-anthracite bg-creme">
              <td className="sticky left-0 z-10 bg-creme px-4 py-2 border-b border-ligne">
                Effectif total
              </td>
              {total.map((v, i) => (
                <td key={i} className={`text-center py-2 border-b border-ligne ${rowClass(months[i])}`}>
                  {v}
                </td>
              ))}
            </tr>

            <tr className="font-bold text-anthracite">
              <td className="sticky left-0 z-10 bg-carte px-4 py-2 border-b border-ligne">Siège</td>
              {totalSiege.map((v, i) => (
                <td key={i} className={`text-center py-2 border-b border-ligne ${rowClass(months[i])}`}>
                  {v}
                </td>
              ))}
            </tr>
            {siegeRows.map((r) => (
              <tr key={`s-${r.label}`}>
                <td className="sticky left-0 z-10 bg-carte px-4 py-1.5 border-b border-ligne text-texte-2 pl-7">
                  {r.label}
                </td>
                {r.values.map((v, i) => (
                  <td
                    key={i}
                    className={`text-center py-1.5 border-b border-ligne ${rowClass(months[i])}`}
                  >
                    {cell(v)}
                  </td>
                ))}
              </tr>
            ))}

            <tr className="font-bold text-anthracite">
              <td className="sticky left-0 z-10 bg-carte px-4 py-2 border-b border-ligne">
                Consultants
              </td>
              {totalCons.map((v, i) => (
                <td key={i} className={`text-center py-2 border-b border-ligne ${rowClass(months[i])}`}>
                  {v}
                </td>
              ))}
            </tr>
            {consRows.map((r) => (
              <tr key={`c-${r.label}`}>
                <td className="sticky left-0 z-10 bg-carte px-4 py-1.5 border-b border-ligne text-texte-2 pl-7">
                  {r.label}
                </td>
                {r.values.map((v, i) => (
                  <td
                    key={i}
                    className={`text-center py-1.5 border-b border-ligne ${rowClass(months[i])}`}
                  >
                    {cell(v)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {horsGrilles > 0 && (
        <p className="text-[11px] text-label mt-3">
          {`${horsGrilles} personne${horsGrilles > 1 ? "s" : ""} au grade hors grilles (ex. « DG SMALL Bordeaux ») — comptée${horsGrilles > 1 ? "s" : ""} nulle part, fidèle à l'Excel.`}
        </p>
      )}
    </div>
  )
}
