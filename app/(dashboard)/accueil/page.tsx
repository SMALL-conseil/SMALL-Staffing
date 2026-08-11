import { auth } from "@/auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import { ChevronLeft, ChevronRight, Hourglass } from "lucide-react"
import { loadStaffingData } from "@/lib/staffing-load"
import { headcount, icAtDate, monthlyKpis, yearKpis, ytdRates } from "@/lib/staffing"
import { CONSULTANT_GRADES, SIEGE_GRADES } from "@/lib/types"
import {
  formatEtp,
  formatPct,
  libelleMois,
  MOIS_COURTS,
  todayParis,
  variationEtp,
  variationTaux,
} from "@/lib/staffing-ui"
import { formatDateShort } from "@/lib/utils"
import TauxChart from "@/components/TauxChart"
import KpiTiles, { type KpiTile } from "@/components/KpiTiles"

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

// Tableau de bord — année navigable. Année en cours : KPIs du mois + YTD ;
// autre année : agrégats annuels (taux de l'année, ETP moyens pondérés par
// les jours ouvrés — même convention que l'Excel). Les chiffres sortent du
// moteur (lib/staffing.ts), jamais recalculés à la main ici.
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ annee?: string }>
}) {
  const session = await auth()
  if (!session?.user) redirect("/login")

  const { people, missions, siege } = await loadStaffingData()
  const today = todayParis()
  const currentYear = Number(today.slice(0, 4))
  const currentMonth = Number(today.slice(5, 7))
  const parsed = Number((await searchParams).annee)
  const year = Number.isInteger(parsed) && parsed >= 2000 && parsed <= 2100 ? parsed : currentYear
  const isCurrentYear = year === currentYear

  const yearNav = (
    <div className="flex items-center gap-2">
      <Link href={`/accueil?annee=${year - 1}`} className="chip inline-flex items-center gap-1" aria-label={`Année ${year - 1}`}>
        <ChevronLeft size={14} aria-hidden="true" /> {year - 1}
      </Link>
      <span className="chip chip-on cursor-default">{year}</span>
      <Link href={`/accueil?annee=${year + 1}`} className="chip inline-flex items-center gap-1" aria-label={`Année ${year + 1}`}>
        {year + 1} <ChevronRight size={14} aria-hidden="true" />
      </Link>
      {!isCurrentYear && (
        <Link href="/accueil" className="chip">
          Aujourd&rsquo;hui
        </Link>
      )}
    </div>
  )

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

  // Sous-titre « personnes » : mois courant sur l'année en cours, décembre sinon.
  const headsMonth = isCurrentYear ? currentMonth : 12
  const headsSiege = SIEGE_GRADES.reduce((n, g) => n + headcount(siege, g, year, headsMonth), 0)
  const headsCons = CONSULTANT_GRADES.reduce((n, g) => n + headcount(people, g, year, headsMonth), 0)

  let tiles: KpiTile[]
  if (isCurrentYear) {
    const current = kpis[currentMonth - 1]
    const ytd = ytdRates(people, missions, year, today)
    const icList = icAtDate(people, missions, today)

    // Références de comparaison : même mois N-1, et mois précédent.
    const pmYear = currentMonth === 1 ? year - 1 : year
    const pmMonth = currentMonth === 1 ? 12 : currentMonth - 1
    const moisN1 = monthlyKpis(people, missions, year - 1, currentMonth)
    const moisPrec = monthlyKpis(people, missions, pmYear, pmMonth)
    const mm = String(currentMonth).padStart(2, "0")
    const ytdN1 = ytdRates(people, missions, year - 1, `${year - 1}-${mm}-01`)
    const ytdPrec =
      pmYear === year
        ? ytdRates(people, missions, year, `${year}-${String(pmMonth).padStart(2, "0")}-01`)
        : ytdRates(people, missions, year - 1, `${year - 1}-12-01`)

    tiles = [
      {
        label: `Taux de staffing — ${libelleMois(year, currentMonth)}`,
        value: formatPct(current.tauxSalaries, 1),
        sub: `salariés + indép : ${formatPct(current.tauxSalariesIndep, 1)}`,
        underline: "bg-jaune-vif",
        comparisons: [
          {
            label: cap(libelleMois(year - 1, currentMonth)),
            value: formatPct(moisN1.tauxSalaries, 1),
            variation: variationTaux(current.tauxSalaries, moisN1.tauxSalaries),
          },
          {
            label: cap(libelleMois(pmYear, pmMonth)),
            value: formatPct(moisPrec.tauxSalaries, 1),
            variation: variationTaux(current.tauxSalaries, moisPrec.tauxSalaries),
          },
        ],
      },
      {
        label: `Taux YTD (au ${formatDateShort(ytd.cutoff)})`,
        value: formatPct(ytd.tauxSalaries, 1),
        sub: `salariés + indép : ${formatPct(ytd.tauxSalariesIndep, 1)}`,
        underline: "bg-jaune-doux",
        comparisons: [
          {
            label: `YTD ${libelleMois(year - 1, currentMonth)}`,
            value: formatPct(ytdN1.tauxSalaries, 1),
            variation: variationTaux(ytd.tauxSalaries, ytdN1.tauxSalaries),
          },
          {
            label: `YTD ${libelleMois(pmYear, pmMonth)}`,
            value: formatPct(ytdPrec.tauxSalaries, 1),
            variation: variationTaux(ytd.tauxSalaries, ytdPrec.tauxSalaries),
          },
        ],
      },
      {
        label: "Effectif salariés (ETP)",
        value: formatEtp(current.effectifSalaries),
        sub: `avec indép : ${formatEtp(current.effectifSalariesIndep)} · facturés : ${formatEtp(current.factures)}`,
        underline: "bg-rose",
        comparisons: [
          {
            label: cap(libelleMois(year - 1, currentMonth)),
            value: formatEtp(moisN1.effectifSalaries),
            variation: variationEtp(current.effectifSalaries, moisN1.effectifSalaries),
          },
          {
            label: cap(libelleMois(pmYear, pmMonth)),
            value: formatEtp(moisPrec.effectifSalaries),
            variation: variationEtp(current.effectifSalaries, moisPrec.effectifSalaries),
          },
        ],
      },
      {
        label: "Intercontrat (ETP)",
        value: formatEtp(current.intercontrat),
        sub: `${icList.length} consultant${icList.length > 1 ? "s" : ""} en IC à date`,
        underline: "bg-gris-moyen",
        href: "/intercontrat",
      },
    ]
  } else {
    // Agrégats annuels pondérés par les jours ouvrés (Σ jours / Σ jours ouvrés).
    const annual = ytdRates(people, missions, year, `${year}-12-31`)
    const totalWd = kpis.reduce((n, k) => n + k.workingDays, 0)
    const moyenne = (get: (k: (typeof kpis)[number]) => number) =>
      kpis.reduce((n, k) => n + get(k) * k.workingDays, 0) / totalWd
    const regime = year < currentYear ? "réalisé" : "prévisionnel (missions saisies)"
    tiles = [
      {
        label: `Taux de staffing ${year}`,
        value: formatPct(annual.tauxSalaries, 1),
        sub: `salariés + indép : ${formatPct(annual.tauxSalariesIndep, 1)} — ${regime}`,
        underline: "bg-jaune-vif",
      },
      {
        label: "Effectif salariés moyen (ETP)",
        value: formatEtp(moyenne((k) => k.effectifSalaries)),
        sub: `avec indép : ${formatEtp(moyenne((k) => k.effectifSalariesIndep))}`,
        underline: "bg-jaune-doux",
      },
      {
        label: "Facturés moyens (ETP)",
        value: formatEtp(moyenne((k) => k.factures)),
        sub: `sur ${totalWd} jours ouvrés dans l'année`,
        underline: "bg-rose",
      },
      {
        label: "Intercontrat moyen (ETP)",
        value: formatEtp(moyenne((k) => k.intercontrat)),
        sub: "moyenne pondérée par les jours ouvrés",
        underline: "bg-gris-moyen",
        href: "/intercontrat",
      },
    ]
  }

  return (
    <div className="px-11 py-9 max-w-[1080px] mx-auto max-md:px-5">
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="kicker">SMALL Staffing</div>
          <h1 className="titre-page mt-1.5">
            Tableau de <span className="hl">bord</span>
          </h1>
          <p className="text-[13px] text-texte-2 mt-2">
            {`${headsSiege + headsCons} personnes en ${libelleMois(year, headsMonth)} (${headsSiege} siège, ${headsCons} consultants)`}
          </p>
        </div>
        {yearNav}
      </div>

      <KpiTiles tiles={tiles} />

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
            currentMonth={isCurrentYear ? currentMonth : null}
            forecastFrom={isCurrentYear ? currentMonth : year > currentYear ? 1 : null}
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
                  className={`border-t border-ligne ${isCurrentYear && k.month === currentMonth ? "bg-jaune-pale/50 font-bold text-anthracite" : "text-texte"}`}
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
        {isCurrentYear ? (
          <p className="text-[11px] text-label mt-3">
            Mois au-delà de {libelleMois(year, currentMonth)} : prévisionnel sur les missions saisies.
          </p>
        ) : year > currentYear ? (
          <p className="text-[11px] text-label mt-3">
            Année entièrement prévisionnelle, sur les missions saisies.
          </p>
        ) : null}
      </div>
    </div>
  )
}
