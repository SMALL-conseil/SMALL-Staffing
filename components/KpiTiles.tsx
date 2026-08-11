"use client"

// Tuiles KPI du tableau de bord. Une tuile munie de comparaisons est
// cliquable : un panneau s'ouvre dessous avec le même KPI à N-1 et au mois
// précédent, variation colorée selon le « bon sens » (vert = bonne
// évolution, rouge = mauvaise), flèche de tendance — jamais la couleur
// seule. Une tuile avec `href` reste un simple lien.
import { useState } from "react"
import Link from "next/link"
import { TrendingDown, TrendingUp, Minus, X } from "lucide-react"
import type { Variation } from "@/lib/staffing-ui"

export interface KpiComparison {
  /** ex. « Août 2025 » ou « YTD juillet 2026 ». */
  label: string
  /** Valeur formatée, ex. « 82,1 % ». */
  value: string
  variation: Variation
}

export interface KpiTile {
  label: string
  value: string
  sub: string
  underline: string
  href?: string
  comparisons?: KpiComparison[]
}

function VariationBadge({ v }: { v: Variation }) {
  if (v.texte === null) return <span className="text-[11px] text-label">n/d</span>
  const Icon = v.tendance === "hausse" ? TrendingUp : v.tendance === "baisse" ? TrendingDown : Minus
  const cls = v.tendance === "stable" ? "text-texte-2" : v.bonSens ? "text-ok" : "text-err"
  return (
    <span className={`inline-flex items-center gap-1 font-bold ${cls}`}>
      <Icon size={13} aria-hidden="true" />({v.texte})
    </span>
  )
}

export default function KpiTiles({ tiles }: { tiles: KpiTile[] }) {
  const [open, setOpen] = useState<number | null>(null)

  return (
    <div className="grid grid-cols-2 xl:grid-cols-4 gap-3.5 mb-5">
      {tiles.map((k, i) => {
        const inner = (
          <>
            <span className={`inline-block w-6 h-1 rounded-full mb-3 ${k.underline}`} aria-hidden="true" />
            <div className="titre-formation text-[29px] leading-none whitespace-nowrap">{k.value}</div>
            <div className="text-[11px] tracking-[0.08em] uppercase text-label mt-2">{k.label}</div>
            <div className="text-[11.5px] text-texte-2 mt-1.5">{k.sub}</div>
          </>
        )

        if (k.href) {
          return (
            <Link key={k.label} href={k.href} className="card card-hover px-5 py-5 block">
              {inner}
            </Link>
          )
        }

        if (!k.comparisons?.length) {
          return (
            <div key={k.label} className="card px-5 py-5">
              {inner}
            </div>
          )
        }

        const isOpen = open === i
        return (
          <div key={k.label} className="relative">
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : i)}
              aria-expanded={isOpen}
              aria-label={`${k.label} — comparer à l'année et au mois précédents`}
              className={`card card-hover px-5 py-5 block w-full text-left cursor-pointer relative z-20 ${isOpen ? "border-jaune-ligne" : ""}`}
            >
              {inner}
              <div className="text-[10.5px] text-label mt-2 inline-flex items-center gap-1">
                comparer <TrendingUp size={11} aria-hidden="true" />
              </div>
            </button>

            {isOpen && (
              <>
                {/* voile fermant le panneau au clic ailleurs */}
                <div className="fixed inset-0 z-10" aria-hidden="true" onClick={() => setOpen(null)} />
                <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-20 card px-4 py-3.5 shadow-md min-w-[240px]">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] uppercase tracking-[0.12em] text-label font-bold">
                      Comparaisons
                    </span>
                    <button
                      type="button"
                      onClick={() => setOpen(null)}
                      aria-label="Fermer"
                      className="text-label hover:text-anthracite p-0.5"
                    >
                      <X size={13} aria-hidden="true" />
                    </button>
                  </div>
                  <div className="space-y-2">
                    {k.comparisons.map((c) => (
                      <div key={c.label} className="flex items-baseline justify-between gap-3 text-[12.5px]">
                        <span className="text-texte-2">{c.label}</span>
                        <span className="whitespace-nowrap">
                          <span className="font-bold text-anthracite mr-1.5">{c.value}</span>
                          <VariationBadge v={c.variation} />
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}
