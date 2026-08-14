"use client"

// Pilotage de la synchro des jours de CRA Boond (a12) : répétition (dry run,
// tout est annulé) ou synchro réelle. Premier passage = pleine charge.
import { useState } from "react"
import { useRouter } from "next/navigation"
import { RefreshCw } from "lucide-react"
import type { TimesSyncReport } from "@/lib/boond-times-sync"

export interface LastTimesRunProps {
  date: string
  dryRun: boolean
  ok: boolean
  created: number
  errors: number
}

interface Props {
  lastRun: LastTimesRunProps | null
  boondConfigured: boolean
  hasEntries: boolean
}

export default function SyncTimesCard({ lastRun, boondConfigured, hasEntries }: Props) {
  const router = useRouter()
  const [running, setRunning] = useState<false | "dry" | "real">(false)
  const [confirmReal, setConfirmReal] = useState(false)
  const [report, setReport] = useState<(TimesSyncReport & { dryRun: boolean; error?: string }) | null>(null)

  async function launch(dryRun: boolean) {
    if (!dryRun && !confirmReal) {
      setConfirmReal(true)
      return
    }
    setConfirmReal(false)
    setRunning(dryRun ? "dry" : "real")
    setReport(null)
    try {
      const res = await fetch("/api/boond/sync-times", {
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
    <div className="card px-6 py-6 mt-5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="titre-section">Jours de CRA (Boond)</h2>
          <p className="text-[11.5px] text-label mt-1">
            {lastRun
              ? `Dernier passage : ${lastRun.date}${lastRun.dryRun ? " (répétition)" : ""} — ${
                  lastRun.ok ? `${lastRun.created} jour(s) écrit(s)` : `${lastRun.errors} erreur(s)`
                }`
              : hasEntries
                ? "Jours présents en base — le cron quotidien entretiendra la fenêtre."
                : "Jamais synchronisé — le premier passage charge tout l'historique (~2 min)."}
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
            {running === "real" ? "Synchronisation…" : confirmReal ? "Confirmer la synchro ?" : "Synchroniser les jours"}
          </button>
        </div>
      </div>

      {running !== false && (
        <p className="text-[12.5px] text-texte-2 mt-3">
          {hasEntries ? "Fenêtre en cours de relecture…" : "Pleine charge en cours (tout l'historique CRA)…"}
        </p>
      )}

      {report && (
        <div className={`mt-4 rounded-[10px] border px-4 py-3.5 ${report.error || (report.errors?.length ?? 0) > 0 ? "border-err-ligne bg-err-bg" : "border-ok-ligne bg-ok-bg"}`}>
          {report.error ? (
            <p className="text-[12.5px] text-err">{report.error}</p>
          ) : (
            <>
              <p className="text-[12.5px] font-bold text-anthracite">
                {report.dryRun ? "Répétition (rien n'a été écrit)" : "Synchronisation effectuée"} —{" "}
                {report.fullLoad ? "pleine charge" : "fenêtre incrémentale"} · {report.pagesWalked} page(s) ·{" "}
                {report.rowsFetched} ligne(s) lue(s)
              </p>
              <p className="text-[12px] text-texte mt-1">
                {report.windowFrom && report.windowTo ? `Fenêtre ${report.windowFrom} → ${report.windowTo} · ` : ""}
                {report.created} jour(s) écrit(s) · {report.deleted} remplacé(s) ·{" "}
                {report.skippedNoPerson} sans fiche en base · {report.skippedUnusable} inexploitable(s)
              </p>
              {Object.keys(report.parActivite ?? {}).length > 0 && (
                <p className="text-[12px] text-texte-2 mt-1">
                  {Object.entries(report.parActivite)
                    .sort((a, b) => b[1] - a[1])
                    .map(([k, v]) => `${k} : ${v.toLocaleString("fr-FR")} j`)
                    .join(" · ")}
                </p>
              )}
              {liste("Ressources Boond sans fiche en base", report.personsUnknown ?? [])}
              {liste("Erreurs", report.errors ?? [])}
            </>
          )}
        </div>
      )}
    </div>
  )
}
