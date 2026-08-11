"use client"

// Graphe d'évolution du taux de staffing (12 mois) — SVG maison, charte Brume.
// Deux séries (salariés / salariés + indép) : encre et rose foncé, 2 px,
// libellés directs en fin de ligne + légende ; au-delà du mois courant le
// trait passe en pointillés (prévisionnel sur missions saisies). Survol :
// réticule + infobulle par mois. La table mensuelle (page) sert de vue table.
import { useState } from "react"
import { MOIS_COURTS, MOIS_LONGS, formatPct } from "@/lib/staffing-ui"

const COL_SAL = "#3f403a" // encre Brume
const COL_SI = "#b0897a" // rose foncé (validé CVD/contraste vs blanc)

export interface TauxChartPoint {
  sal: number
  salIndep: number
}

interface TauxChartProps {
  year: number
  /** Mois courant 1-12 (repère jaune) si l'année affichée est l'année en cours, sinon null. */
  currentMonth: number | null
  /** 1er mois affiché en pointillé (prévisionnel) ; null = tout en trait plein (année passée). */
  forecastFrom: number | null
  points: TauxChartPoint[]
}

const W = 760
const H = 252
const M = { top: 16, right: 118, bottom: 28, left: 46 }
const PW = W - M.left - M.right
const PH = H - M.top - M.bottom

export default function TauxChart({ year, currentMonth, forecastFrom, points }: TauxChartProps) {
  const [hover, setHover] = useState<number | null>(null)

  const values = points.flatMap((p) => [p.sal, p.salIndep]).filter((v) => v > 0)
  const yMin = Math.max(0, Math.min(0.6, Math.floor(((values.length ? Math.min(...values) : 0.6) - 0.03) * 10) / 10))
  const yMax = 1
  const x = (i: number) => M.left + (PW * i) / 11
  const y = (v: number) => M.top + PH * (1 - (v - yMin) / (yMax - yMin))

  const gridSteps: number[] = []
  for (let v = yMin; v <= yMax + 1e-9; v += 0.1) gridSteps.push(Math.round(v * 10) / 10)

  const cut = forecastFrom === null ? 12 : Math.max(forecastFrom, 1) // dernier index (1-based) en trait plein
  const path = (serie: (p: TauxChartPoint) => number, from: number, to: number) =>
    points
      .slice(from, to)
      .map((p, i) => `${i === 0 ? "M" : "L"}${x(from + i).toFixed(1)},${y(serie(p)).toFixed(1)}`)
      .join(" ")

  const series = [
    { label: "Salariés", color: COL_SAL, get: (p: TauxChartPoint) => p.sal },
    { label: "Salariés + indép", color: COL_SI, get: (p: TauxChartPoint) => p.salIndep },
  ]

  // Libellés directs en fin de ligne : écartés verticalement si les deux
  // séries convergent (anti-collision, écart mini 14 px).
  const endLabelY: number[] = series.map((s) => y(s.get(points[11])))
  if (Math.abs(endLabelY[0] - endLabelY[1]) < 14) {
    const mid = (endLabelY[0] + endLabelY[1]) / 2
    const dir = endLabelY[0] <= endLabelY[1] ? 1 : -1
    endLabelY[0] = mid - 7 * dir
    endLabelY[1] = mid + 7 * dir
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-4 mb-2">
        {series.map((s) => (
          <span key={s.label} className="badge">
            <span className="dot" style={{ background: s.color }} aria-hidden="true" />
            {s.label}
          </span>
        ))}
        {forecastFrom !== null && (
          <span className="text-[11px] text-label ml-auto">
            {forecastFrom <= 1
              ? "année entièrement prévisionnelle (missions saisies)"
              : forecastFrom <= 12
                ? `au-delà de ${MOIS_LONGS[forecastFrom - 1]} : prévisionnel (missions saisies)`
                : null}
          </span>
        )}
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto"
        role="img"
        aria-label={`Taux de staffing mensuel ${year}, salariés et salariés plus indépendants`}
        onMouseLeave={() => setHover(null)}
      >
        {/* grille + axe Y */}
        {gridSteps.map((v) => (
          <g key={v}>
            <line
              x1={M.left}
              x2={W - M.right}
              y1={y(v)}
              y2={y(v)}
              stroke="rgb(30 31 28 / 0.08)"
              strokeWidth={1}
            />
            <text x={M.left - 8} y={y(v) + 3.5} textAnchor="end" fontSize={10.5} fill="#6e6d62">
              {Math.round(v * 100)} %
            </text>
          </g>
        ))}

        {/* mois courant : repère vertical */}
        {currentMonth !== null && (
          <line
            x1={x(currentMonth - 1)}
            x2={x(currentMonth - 1)}
            y1={M.top - 4}
            y2={M.top + PH}
            stroke="#c2d26a"
            strokeWidth={1.5}
          />
        )}

        {/* réticule de survol */}
        {hover !== null && (
          <line
            x1={x(hover)}
            x2={x(hover)}
            y1={M.top}
            y2={M.top + PH}
            stroke="rgb(30 31 28 / 0.25)"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        )}

        {/* séries : trait plein jusqu'au mois courant, pointillé ensuite */}
        {series.map((s) => (
          <g key={s.label}>
            <path d={path(s.get, 0, cut)} fill="none" stroke={s.color} strokeWidth={2} />
            {cut < 12 && (
              <path
                d={path(s.get, cut - 1, 12)}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeDasharray="5 4"
              />
            )}
            {points.map((p, i) => (
              <circle
                key={i}
                cx={x(i)}
                cy={y(s.get(p))}
                r={hover === i ? 4.5 : currentMonth !== null && i === currentMonth - 1 ? 4 : 2.5}
                fill={currentMonth !== null && i === currentMonth - 1 ? "#e4ef70" : s.color}
                stroke={s.color}
                strokeWidth={currentMonth !== null && i === currentMonth - 1 ? 2 : 0}
              />
            ))}
            {/* libellé direct en fin de ligne */}
            <text
              x={x(11) + 10}
              y={endLabelY[series.indexOf(s)] + 3.5}
              fontSize={11}
              fontWeight={700}
              fill={s.color}
            >
              {s.label}
            </text>
          </g>
        ))}

        {/* axe X */}
        {points.map((_, i) => (
          <text
            key={i}
            x={x(i)}
            y={H - 8}
            textAnchor="middle"
            fontSize={10.5}
            fill={currentMonth !== null && i === currentMonth - 1 ? "#1e1f1c" : "#6e6d62"}
            fontWeight={currentMonth !== null && i === currentMonth - 1 ? 700 : 400}
          >
            {MOIS_COURTS[i]}
          </text>
        ))}

        {/* zones de survol (une par mois, cibles larges) */}
        {points.map((_, i) => (
          <rect
            key={i}
            x={x(i) - PW / 22}
            y={M.top}
            width={PW / 11}
            height={PH}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
          />
        ))}
      </svg>

      {/* infobulle */}
      {hover !== null && (
        <div
          className="absolute card px-3 py-2 pointer-events-none shadow-sm"
          style={{
            left: `${(x(hover) / W) * 100}%`,
            top: 34,
            transform: x(hover) > W * 0.72 ? "translateX(-105%)" : "translateX(12px)",
          }}
        >
          <div className="text-[11px] font-bold text-anthracite whitespace-nowrap">
            {MOIS_LONGS[hover]} {year}
          </div>
          {series.map((s) => (
            <div key={s.label} className="flex items-center gap-1.5 text-[11.5px] text-texte whitespace-nowrap mt-0.5">
              <span className="dot" style={{ background: s.color }} aria-hidden="true" />
              {s.label} : <span className="font-bold">{formatPct(s.get(points[hover]), 1)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
