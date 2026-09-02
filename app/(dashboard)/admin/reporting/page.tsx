import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { redirect } from "next/navigation"
import Link from "next/link"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { Role } from "@/lib/types"
import { toIsoDate } from "@/lib/staffing-load"
import { MOIS_LONGS, todayParis } from "@/lib/staffing-ui"
import { formatDateTimeParis } from "@/lib/utils"
import {
  caParClient,
  caParClientReel,
  consultantsParClient,
  JOURS_FACTURES_PAR_AN,
  replierAutres,
  type ReportingJour,
  type ReportingMission,
} from "@/lib/reporting"
import { AUTRES_COLOR, clientColor, clientSlug } from "@/lib/client-brand"
import DonutChart from "@/components/DonutChart"
import SyncTimesCard from "./SyncTimesCard"

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

  // Missions triées par rank : le départage jour → mission en dépend (a12).
  // TJM fiche du titulaire (a17) : cascade fees ?? defaultDailyRate — cette
  // page est gate Siège, seule à recevoir ces valeurs (avec /admin/missions).
  const missionsDb = await prisma.mission.findMany({
    select: {
      personId: true, client: true, startDate: true, endDate: true, fees: true,
      person: { select: { defaultDailyRate: true } },
    },
    orderBy: { rank: "asc" },
  })
  const missions: ReportingMission[] = missionsDb.map((m) => ({
    personId: m.personId,
    client: m.client,
    start: toIsoDate(m.startDate),
    end: toIsoDate(m.endDate),
    fees: m.fees,
    defaultRate: m.person.defaultDailyRate,
  }))

  // Jours de CRA « production » de l'année affichée (synchro Boond a12).
  const joursDb = await prisma.timeEntry.findMany({
    where: {
      activityType: "production",
      date: { gte: new Date(Date.UTC(year, 0, 1)), lte: new Date(Date.UTC(year, 11, 31)) },
    },
    select: { personId: true, date: true, duration: true, clientName: true },
  })
  const jours: ReportingJour[] = joursDb.map((j) => ({
    personId: j.personId,
    date: toIsoDate(j.date),
    duration: j.duration,
    clientName: j.clientName,
  }))

  const parClient = consultantsParClient(missions, today)
  const totalConsultants = parClient.reduce((n, c) => n + c.consultants, 0)
  // Jours réels disponibles → CA mêlant réel (mois écoulés) et convention ;
  // sinon (jamais synchronisé) : convention seule, comme avant a12.
  const reel = jours.length > 0 ? caParClientReel(missions, jours, year, today) : null
  const ca = reel ?? caParClient(missions, year, today)

  // Dernier passage de la synchro des jours + configuration Boond.
  const hasEntries = (await prisma.timeEntry.count()) > 0
  const lastTimesRunRow = await prisma.syncRun.findFirst({
    where: { kind: "BOOND_TIMES" },
    orderBy: { startedAt: "desc" },
  })
  const lastTimesReport = (lastTimesRunRow?.report ?? null) as { created?: number; errors?: string[] } | null
  const lastTimesRun = lastTimesRunRow
    ? {
        date: formatDateTimeParis(lastTimesRunRow.startedAt),
        dryRun: lastTimesRunRow.dryRun,
        ok: lastTimesRunRow.ok,
        created: lastTimesReport?.created ?? 0,
        errors: lastTimesReport?.errors?.length ?? 0,
      }
    : null
  const boondConfigured = Boolean(
    process.env.BOOND_USER_TOKEN && process.env.BOOND_CLIENT_TOKEN && process.env.BOOND_CLIENT_KEY
  )

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
          {reel && reel.moisReelMax > 0 && <span className="tag tag-ok">réel CRA</span>}
        </div>
        <p className="text-[11.5px] text-label mt-1 mb-4">
          {!reel
            ? `Convention (jours CRA non synchronisés) : honoraires (€/jour) × mois de mission sur ${year}${year === currentYear ? " (arrêtés au mois courant)" : ""} × ${JOURS_FACTURES_PAR_AN}/12 — part d'intervention non pondérée.`
            : reel.moisReelMax === 0
              ? `Convention : honoraires (€/jour) × mois de mission sur ${year} × ${JOURS_FACTURES_PAR_AN}/12 — part d'intervention non pondérée.`
              : year === currentYear
                ? `Réel CRA de janvier à ${MOIS_LONGS[reel.moisReelMax - 1]} (jours de production × honoraires €/jour) : ${fmtCa(reel.caReel)} · convention ${JOURS_FACTURES_PAR_AN}/12 pour ${MOIS_LONGS[Number(today.slice(5, 7)) - 1]} : ${fmtCa(reel.caConvention)}.`
                : `Réel CRA sur les 12 mois de ${year} : jours de production × honoraires (€/jour) des missions.`}
          {" Taux journalier : honoraires saisis sur la mission, sinon TJM de la fiche Boond (synchro quotidienne)."}
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
            {`Hors périmètre (aucun taux : ni honoraires saisis, ni TJM sur la fiche Boond) : ${ca.sansHonoraires
              .map((s) => `${s.client} (${s.missions} mission${s.missions > 1 ? "s" : ""})`)
              .join(" · ")} — saisir les honoraires au registre ou compléter le TJM dans Boond.`}
          </p>
        )}
        {reel && reel.joursSansMission > 0 && (
          <p className="text-[11.5px] text-attente bg-beige rounded-[8px] px-3 py-2 mt-2">
            {`${reel.joursSansMission.toLocaleString("fr-FR")} jour(s) de production au CRA sans mission correspondante dans l'app — à rapprocher dans le registre des missions.`}
          </p>
        )}
      </div>

      <SyncTimesCard lastRun={lastTimesRun} boondConfigured={boondConfigured} hasEntries={hasEntries} />
    </div>
  )
}

/** Format compact d'un montant (k€ / M€) pour les notes. */
function fmtCa(v: number): string {
  return v >= 1_000_000
    ? `${(v / 1_000_000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} M€`
    : `${Math.round(v / 1000).toLocaleString("fr-FR")} k€`
}
