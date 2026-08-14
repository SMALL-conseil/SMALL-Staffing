"use client"

// Pilotage de la synchro Boond : répétition (dry run, tout est annulé) ou
// synchro réelle (confirmation en deux temps), avec rapport détaillé.
import { useState } from "react"
import { useRouter } from "next/navigation"
import { RefreshCw } from "lucide-react"
import type { SyncReport } from "@/lib/boond-sync"

export interface LastRunProps {
  date: string
  dryRun: boolean
  ok: boolean
  created: number
  updated: number
  errors: number
}

interface Props {
  lastRun: LastRunProps | null
  boondConfigured: boolean
}

export default function SyncBoondCard({ lastRun, boondConfigured }: Props) {
  const router = useRouter()
  const [running, setRunning] = useState<false | "dry" | "real">(false)
  const [confirmReal, setConfirmReal] = useState(false)
  const [report, setReport] = useState<(SyncReport & { dryRun: boolean; error?: string }) | null>(null)

  async function launch(dryRun: boolean) {
    if (!dryRun && !confirmReal) {
      setConfirmReal(true)
      return
    }
    setConfirmReal(false)
    setRunning(dryRun ? "dry" : "real")
    setReport(null)
    try {
      const res = await fetch("/api/boond/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun }),
      })
      const data = await res.json()
      setReport({ ...data, dryRun })
      if (res.ok && !dryRun) router.refresh()
    } catch {
      setReport({ error: "Appel impossible — vérifier la connexion" } as never)
    }
    setRunning(false)
  }

  const liste = (label: string, items: string[]) =>
    items.length > 0 && (
      <details className="mt-1.5">
        <summary className="cursor-pointer text-[12px] text-texte hover:text-anthracite">
          {label} ({items.length})
        </summary>
        <ul className="mt-1 ml-4 list-disc text-[12px] text-texte-2 space-y-0.5">
          {items.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      </details>
    )

  return (
    <div className="card px-6 py-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="titre-section">Synchronisation Boond</h2>
          <p className="text-[11.5px] text-label mt-1">
            {lastRun
              ? `Dernier passage : ${lastRun.date}${lastRun.dryRun ? " (répétition)" : ""} — ${
                  lastRun.ok ? `${lastRun.created} créé(s), ${lastRun.updated} mis à jour` : `${lastRun.errors} erreur(s)`
                }`
              : "Jamais synchronisé — le cron quotidien du VPS s'en chargera une fois branché."}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => launch(true)}
            disabled={running !== false || !boondConfigured}
            className="btn btn-ghost"
            title={boondConfigured ? "Tout est joué puis annulé — rien n'est écrit" : "Secrets BOOND_* absents du .env"}
          >
            Répétition (dry run)
          </button>
          <button
            type="button"
            onClick={() => launch(false)}
            disabled={running !== false || !boondConfigured}
            className={`btn ${confirmReal ? "btn-primary" : "btn-ghost"}`}
            title={boondConfigured ? undefined : "Secrets BOOND_* absents du .env"}
          >
            <RefreshCw size={14} aria-hidden="true" className={running ? "animate-spin" : ""} />
            {running === "real" ? "Synchronisation…" : confirmReal ? "Confirmer la synchro ?" : "Synchroniser"}
          </button>
        </div>
      </div>

      {running === "dry" && <p className="text-[12.5px] text-texte-2 mt-3">Répétition en cours…</p>}

      {report && (
        <div className={`mt-4 rounded-[10px] border px-4 py-3.5 ${report.error || (report.errors?.length ?? 0) > 0 ? "border-err-ligne bg-err-bg" : "border-ok-ligne bg-ok-bg"}`}>
          {report.error ? (
            <p className="text-[12.5px] text-err">{report.error}</p>
          ) : (
            <>
              <p className="text-[12.5px] font-bold text-anthracite">
                {report.dryRun ? "Répétition (rien n'a été écrit)" : "Synchronisation effectuée"} —{" "}
                {report.received} ressource(s) reçue(s)
              </p>
              <p className="text-[12px] text-texte mt-1">
                {report.created} créé(s)
                {(report.arrivalsFromDetail ?? 0) > 0 &&
                  ` (dont ${report.arrivalsFromDetail} arrivée(s) lue(s) dans Boond)`}{" "}
                · {report.updated} mis à jour · {report.adopted} rapproché(s) (boondId adopté) ·{" "}
                {report.managersLinked} lien(s) manager · {report.nonRapproches} sans boondId en base
              </p>
              {liste("Titres hors grilles (grade conservé BRUT)", report.unknownTitles ?? [])}
              {liste("Sans titre — ignorés", report.skippedNoTitle ?? [])}
              {liste("Sans date d'arrivée — non créés", report.skippedNoArrival ?? [])}
              {liste("Kind supposé consultant (titre inconnu)", (report.assumedConsultant ?? []).map((a) => `${a.name} (${a.title})`))}
              {liste("Conflits consultant/siège — non modifiés", report.kindConflicts ?? [])}
              {liste("Conflits d'unicité (email/nom) — champ conservé", report.uniqueConflicts ?? [])}
              {liste("Départs posés", (report.departuresSet ?? []).map((d) => `${d.name} → ${d.date}`))}
              {liste("Inactifs Boond — ignorés", (report.skippedInactive ?? []).map((s) => `${s.name} (état ${s.state ?? "?"})`))}
              {liste("Présents en base, absents du flux (à vérifier)", report.absentsDuFlux ?? [])}
              {liste("Erreurs", report.errors ?? [])}
            </>
          )}
        </div>
      )}
    </div>
  )
}
