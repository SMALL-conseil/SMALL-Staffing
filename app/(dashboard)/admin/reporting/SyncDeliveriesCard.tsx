"use client"

// Pilotage de la synchro des PRESTATIONS Boond (s6) — TJM vendus et jours
// vendus. Le listing /deliveries étant fermé (405), l'énumération part des
// identifiants portés par les jours de CRA : cette synchro se lance donc
// APRÈS celle des jours.
import { useState } from "react"
import { useRouter } from "next/navigation"
import { RefreshCw } from "lucide-react"
import type { DeliveriesSyncReport } from "@/lib/boond-deliveries-sync"

export interface LastDelivRunProps {
  date: string
  dryRun: boolean
  ok: boolean
  ecrites: number
  errors: number
}

interface Props {
  lastRun: LastDelivRunProps | null
  boondConfigured: boolean
  prestations: number
  avecTjm: number
}

export default function SyncDeliveriesCard({ lastRun, boondConfigured, prestations, avecTjm }: Props) {
  const router = useRouter()
  const [running, setRunning] = useState<false | "dry" | "real">(false)
  const [confirmReal, setConfirmReal] = useState(false)
  const [report, setReport] = useState<(DeliveriesSyncReport & { dryRun: boolean; error?: string }) | null>(null)

  async function launch(dryRun: boolean) {
    if (!dryRun && !confirmReal) {
      setConfirmReal(true)
      return
    }
    setConfirmReal(false)
    setRunning(dryRun ? "dry" : "real")
    setReport(null)
    try {
      const res = await fetch("/api/boond/sync-deliveries", {
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
          {items.slice(0, 40).map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      </details>
    )

  return (
    <div className="card px-6 py-6 mt-5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="titre-section">Prestations Boond (TJM vendus)</h2>
          <p className="text-[11.5px] text-label mt-1">
            {lastRun
              ? `Dernier passage : ${lastRun.date}${lastRun.dryRun ? " (répétition)" : ""} — ${
                  lastRun.ok ? `${lastRun.ecrites} prestation(s) écrite(s)` : `${lastRun.errors} erreur(s)`
                } · ${prestations} en base, dont ${avecTjm} avec un TJM`
              : "Jamais synchronisé — à lancer APRÈS les jours de CRA, qui fournissent les prestations à lire."}
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
          >
            <RefreshCw size={14} aria-hidden="true" className={running ? "animate-spin" : ""} />
            {running === "real"
              ? "Synchronisation…"
              : confirmReal
                ? "Confirmer la synchro ?"
                : "Synchroniser les prestations"}
          </button>
        </div>
      </div>

      {running !== false && (
        <p className="text-[12.5px] text-texte-2 mt-3">
          Lecture des prestations une par une (le listing Boond est fermé)…
        </p>
      )}

      {report && (
        <div
          className={`mt-4 rounded-[10px] border px-4 py-3.5 ${
            report.error || (report.errors?.length ?? 0) > 0
              ? "border-err-ligne bg-err-bg"
              : "border-ok-ligne bg-ok-bg"
          }`}
        >
          {report.error ? (
            <p className="text-[12.5px] text-err">{report.error}</p>
          ) : (
            <>
              <p className="text-[12.5px] font-bold text-anthracite">
                {report.dryRun ? "Répétition (rien n'a été écrit)" : "Synchronisation effectuée"} —{" "}
                {report.referenced} prestation(s) référencée(s) par les CRA
              </p>
              <p className="text-[12px] text-texte mt-1">
                {report.fetched} lue(s) · {report.created} créée(s) · {report.updated} mise(s) à jour ·{" "}
                {report.projectsResolved} projet(s) résolu(s) pour nommer les clients
              </p>
              {liste(
                "Refusées par l'API (403 : jeton sans droit financier) ou inconnues",
                report.unreachable ?? []
              )}
              {liste("Lues mais SANS TJM vendu — le CA retombe sur la cascade", report.withoutRate ?? [])}
              {liste("Erreurs", report.errors ?? [])}
            </>
          )}
        </div>
      )}
    </div>
  )
}
