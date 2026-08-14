import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { redirect } from "next/navigation"
import Link from "next/link"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { Role } from "@/lib/types"
import { toIsoDate } from "@/lib/staffing-load"
import { todayParis } from "@/lib/staffing-ui"
import {
  caParClient,
  consultantsParClient,
  JOURS_FACTURES_PAR_AN,
  replierAutres,
  type ReportingMission,
} from "@/lib/reporting"
import { AUTRES_COLOR, clientColor, clientSlug } from "@/lib/client-brand"
import DonutChart from "@/components/DonutChart"

// Reporting par client — RÉSERVÉ AU RÔLE SIÈGE (les honoraires transitent
// ici). Deux répartitions : consultants en mission aujourd'hui, et CA par
// client selon la convention 218 j/an (cf. lib/reporting.ts).
export default async function ReportingPage({
  searchParams,
}: {
  searchParams: Promise<{ annee?: string }>
}) {
  const session = await auth()
  if (!session?.user || session.user.role !== Role.SIEGE) redirect("/accueil")

  const today = todayParis()
  const currentYear = Number(today.slice(0, 4))
  const parsed = Number((await searchParams).annee)
  const year = Number.isInteger(parsed) && parsed >= 2000 && parsed <= 2100 ? parsed : currentYear

  const missionsDb = await prisma.mission.findMany({
    select: { personId: true, client: true, startDate: true, endDate: true, fees: true },
  })
  const missions: ReportingMission[] = missionsDb.map((m) => ({
    personId: m.personId,
    client: m.client,
    start: toIsoDate(m.startDate),
    end: toIsoDate(m.endDate),
    fees: m.fees,
  }))

  const parClient = consultantsParClient(missions, today)
  const totalConsultants = parClient.reduce((n, c) => n + c.consultants, 0)
  const ca = caParClient(missions, year, today)

  const couleur = (label: string, i: number) =>
    label === "Autres" ? AUTRES_COLOR : clientColor(label, i)
  const logo = (label: string) => (label === "Autres" ? null : `/logos/${clientSlug(label)}.png`)

  const dataConsultants = replierAutres(
    parClient.map((c) => ({ label: c.client, value: c.consultants }))
  ).map((s, i) => ({ ...s, color: couleur(s.label, i), logo: logo(s.label) }))

  const dataCa = replierAutres(ca.entries.map((e) => ({ label: e.client, value: e.ca }))).map(
    (s, i) => ({ ...s, color: couleur(s.label, i), logo: logo(s.label) })
  )

  return (
    <div className="px-11 py-9 max-w-[1150px] mx-auto max-md:px-5">
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="kicker">Siège</div>
          <h1 className="titre-page mt-1.5">
            Reporting par <span className="hl">client</span>
          </h1>
          <p className="text-[13px] text-texte-2 mt-2">
            Répartition de l&rsquo;activité — visible du seul rôle Siège.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/admin/reporting?annee=${year - 1}`} className="chip inline-flex items-center gap-1">
            <ChevronLeft size={14} aria-hidden="true" /> {year - 1}
          </Link>
          <span className="chip chip-on cursor-default">{year}</span>
          <Link href={`/admin/reporting?annee=${year + 1}`} className="chip inline-flex items-center gap-1">
            {year + 1} <ChevronRight size={14} aria-hidden="true" />
          </Link>
          {year !== currentYear && (
            <Link href="/admin/reporting" className="chip">
              Aujourd&rsquo;hui
            </Link>
          )}
        </div>
      </div>

      <div className="card px-6 py-6 mb-5">
        <h2 className="titre-section">Consultants par client — aujourd&rsquo;hui</h2>
        <p className="text-[11.5px] text-label mt-1 mb-4">
          Consultants distincts en mission ce jour ; couleurs de marque des clients
          (ajustables dans <code className="font-mono text-[10.5px]">lib/client-brand.ts</code>),
          logos via <code className="font-mono text-[10.5px]">public/logos/</code>.
        </p>
        <DonutChart
          data={dataConsultants}
          unit="consultants"
          centerValue={String(totalConsultants)}
          centerLabel="en mission"
        />
      </div>

      <div className="card px-6 py-6">
        <div className="flex items-baseline justify-between gap-4 flex-wrap">
          <h2 className="titre-section">Chiffre d&rsquo;affaires par client — {year}</h2>
          {year > currentYear && <span className="tag tag-attente">prévisionnel</span>}
        </div>
        <p className="text-[11.5px] text-label mt-1 mb-4">
          {`Convention (facturation Boond indisponible en v1) : honoraires (€/jour) × mois de mission sur ${year}${year === currentYear ? " (arrêtés au mois courant)" : ""} × ${JOURS_FACTURES_PAR_AN}/12 — part d'intervention non pondérée.`}
        </p>
        {ca.entries.length === 0 ? (
          <p className="text-[13px] text-texte-2">
            Aucun honoraire renseigné sur des missions de {year} — la répartition apparaîtra dès
            les premières saisies dans le registre des missions.
          </p>
        ) : (
          <DonutChart
            data={dataCa}
            unit="euros"
            centerValue={
              ca.total >= 1_000_000
                ? `${(ca.total / 1_000_000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} M€`
                : `${Math.round(ca.total / 1000).toLocaleString("fr-FR")} k€`
            }
            centerLabel={`CA ${year}`}
          />
        )}
        {ca.sansHonoraires.length > 0 && (
          <p className="text-[11.5px] text-attente bg-beige rounded-[8px] px-3 py-2 mt-4">
            {`Hors périmètre (honoraires non renseignés) : ${ca.sansHonoraires
              .map((s) => `${s.client} (${s.missions} mission${s.missions > 1 ? "s" : ""})`)
              .join(" · ")} — à compléter dans le registre des missions.`}
          </p>
        )}
      </div>
    </div>
  )
}
