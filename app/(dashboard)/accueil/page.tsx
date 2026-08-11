import { auth } from "@/auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import { Hourglass } from "lucide-react"
import { loadStaffingData } from "@/lib/staffing-load"
import { headcount, icAtDate, yearKpis, ytdRates } from "@/lib/staffing"
import { CONSULTANT_GRADES, SIEGE_GRADES } from "@/lib/types"
import { formatEtp, formatPct, libelleMois, MOIS_COURTS, todayParis } from "@/lib/staffing-ui"
import { formatDateShort } from "@/lib/utils"
import TauxChart from "@/components/TauxChart"

// Tableau de bord — KPIs du mois courant + YTD, évolution du taux sur l'année,
// effectifs. Lecture pour tous les connectés ; les chiffres sortent du moteur
// (lib/staffing.ts), jamais recalculés à la main ici.
export default async function DashboardPage() {
  const session = await auth()
  if (!session?.user) redirect("/login")

  const { people, missions, siege } = await loadStaffingData()
  const today = todayParis()
  const year = Number(today.slice(0, 4))
  const month = Number(today.slice(5, 7))

  if (people.length === 0) {
    return (
      <div className="px-11 py-9 max-w-[1080px] mx-auto max-md:px-5">
        <div className="kicker">SMALL Staffing</div>
        <h1 className="titre-page mt-1.5">
          Tableau de <span className="hl">bord</span>
        </h1>
        <div className="card px-6 py-10 text-center text-sm text-texte-2 mt-7">
          Aucune donnée de staffing pour le moment. Lancer l&rsquo;import initial :{" "}
          <code className="font-mono text-[12px]">
            npx tsx scripts/import-excel.ts &quot;&lt;chemin du xlsx&gt;&quot;
          </code>
        </div>
      </div>
    )
  }

  const kpis = yearKpis(people, missions, year)
  const current = kpis[month - 1]
  const ytd = ytdRates(people, missions, year, today)
  const icList = icAtDate(people, missions, today)

  const headsSiege = SIEGE_GRADES.reduce((n, g) => n + headcount(siege, g, year, month), 0)
  const headsCons = CONSULTANT_GRADES.reduce((n, g) => n + headcount(people, g, year, month), 0)

  const tiles = [
    {
      label: `Taux de staffing — ${libelleMois(year, month)}`,
      value: formatPct(current.tauxSalaries, 1),
      sub: `salariés + indép : ${formatPct(current.tauxSalariesIndep, 1)}`,
      underline: "bg-jaune-vif",
    },
    {
      label: `Taux YTD (au ${formatDateShort(ytd.cutoff)})`,
      value: formatPct(ytd.tauxSalaries, 1),
      sub: `salariés + indép : ${formatPct(ytd.tauxSalariesIndep, 1)}`,
      underline: "bg-jaune-doux",
    },
    {
      label: "Effectif salariés (ETP)",
      value: formatEtp(current.effectifSalaries),
      sub: `avec indép : ${formatEtp(current.effectifSalariesIndep)} · facturés : ${formatEtp(current.factures)}`,
      underline: "bg-rose",
    },
    {
      label: "Intercontrat (ETP)",
      value: formatEtp(current.intercontrat),
      sub: `${icList.length} consultant${icList.length > 1 ? "s" : ""} en IC à date`,
      underline: "bg-gris-moyen",
      href: "/intercontrat",
    },
  ]

  return (
    <div className="px-11 py-9 max-w-[1080px] mx-auto max-md:px-5">
      <div className="mb-7">
        <div className="kicker">SMALL Staffing</div>
        <h1 className="titre-page mt-1.5">
          Tableau de <span className="hl">bord</span>
        </h1>
        <p className="text-[13px] text-texte-2 mt-2">
          {headsSiege + headsCons} têtes en {libelleMois(year, month)} — {headsSiege} siège,{" "}
          {headsCons} consultants
        </p>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3.5 mb-5">
        {tiles.map((k) => {
          const inner = (
            <>
              <span className={`inline-block w-6 h-1 rounded-full mb-3 ${k.underline}`} aria-hidden="true" />
              <div className="titre-formation text-[29px] leading-none whitespace-nowrap">{k.value}</div>
              <div className="text-[11px] tracking-[0.08em] uppercase text-label mt-2">{k.label}</div>
              <div className="text-[11.5px] text-texte-2 mt-1.5">{k.sub}</div>
            </>
          )
          return k.href ? (
            <Link key={k.label} href={k.href} className="card card-hover px-5 py-5 block">
              {inner}
            </Link>
          ) : (
            <div key={k.label} className="card px-5 py-5">
              {inner}
            </div>
          )
        })}
      </div>

      <div className="card px-6 py-6">
        <div className="flex items-baseline justify-between gap-4 flex-wrap">
          <h2 className="titre-section">Évolution du taux de staffing — {year}</h2>
          <Link
            href="/intercontrat"
            className="text-[12px] text-texte-2 hover:text-anthracite inline-flex items-center gap-1.5"
          >
            <Hourglass size={13} aria-hidden="true" /> Voir l&rsquo;intercontrat
          </Link>
        </div>

        <div className="mt-4">
          <TauxChart
            year={year}
            currentMonth={month}
            points={kpis.map((k) => ({ sal: k.tauxSalaries, salIndep: k.tauxSalariesIndep }))}
          />
        </div>

        {/* Vue table (accessibilité + contrôle fin, façon onglet Staffing de l'Excel) */}
        <div className="overflow-x-auto mt-5">
          <table className="w-full text-[11.5px]">
            <thead>
              <tr className="text-label uppercase tracking-[0.08em] text-[10px]">
                <th className="text-left font-bold py-1.5 pr-3">Mois</th>
                <th className="text-right font-bold py-1.5 px-2">J. ouvrés</th>
                <th className="text-right font-bold py-1.5 px-2">Eff. sal. (ETP)</th>
                <th className="text-right font-bold py-1.5 px-2">Facturés</th>
                <th className="text-right font-bold py-1.5 px-2">IC</th>
                <th className="text-right font-bold py-1.5 px-2">Tx salariés</th>
                <th className="text-right font-bold py-1.5 pl-2">Tx sal. + indép</th>
              </tr>
            </thead>
            <tbody>
              {kpis.map((k) => (
                <tr
                  key={k.month}
                  className={`border-t border-ligne ${k.month === month ? "bg-jaune-pale/50 font-bold text-anthracite" : "text-texte"}`}
                >
                  <td className="py-1.5 pr-3">{MOIS_COURTS[k.month - 1]}</td>
                  <td className="text-right py-1.5 px-2">{k.workingDays}</td>
                  <td className="text-right py-1.5 px-2">{formatEtp(k.effectifSalaries)}</td>
                  <td className="text-right py-1.5 px-2">{formatEtp(k.factures)}</td>
                  <td className="text-right py-1.5 px-2">{formatEtp(k.intercontrat)}</td>
                  <td className="text-right py-1.5 px-2">{formatPct(k.tauxSalaries)}</td>
                  <td className="text-right py-1.5 pl-2">{formatPct(k.tauxSalariesIndep)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-label mt-3">
          Mois au-delà de {libelleMois(year, month)} : prévisionnel sur les missions saisies.
        </p>
      </div>
    </div>
  )
}
