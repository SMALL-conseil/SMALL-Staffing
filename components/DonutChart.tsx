"use client"

// Donut de répartition par client (reporting Siège). Règles dataviz du
// projet : parts triées, petites parts repliées en « Autres » EN AMONT,
// espaces blancs de 2 px entre tranches, identité jamais portée par la
// couleur seule (légende complète + infobulle + % sur les grosses parts),
// texte toujours en encres du thème. Logos : affichés au centre des parts
// les plus grosses si le fichier public/logos/<slug> existe.
import { useEffect, useState } from "react"
import { formatEuros } from "@/lib/staffing-ui"

export interface DonutDatum {
  label: string
  value: number
  color: string
  /** Chemin du logo (ex. /logos/groupama.png) — masqué si le fichier manque. */
  logo?: string | null
}

interface DonutChartProps {
  data: DonutDatum[]
  /** Unité des valeurs (le composant client formate lui-même — RSC-safe). */
  unit: "consultants" | "euros"
  centerValue: string
  centerLabel: string
  /** Nb de parts (les plus grosses) qui tentent d'afficher leur logo. */
  logoSlots?: number
}

const SIZE = 260
const R = 108
const INNER = 64
const CX = SIZE / 2
const CY = SIZE / 2

// Coordonnée arrondie au centième : Math.sin/cos peuvent différer d'un ULP
// entre le V8 du serveur et celui du navigateur — des floats bruts dans les
// attributs SVG provoquent une erreur d'hydratation React (vu le 14/08).
const px = (n: number) => Math.round(n * 100) / 100

function arcPath(startAngle: number, endAngle: number): string {
  const large = endAngle - startAngle > Math.PI ? 1 : 0
  const x1 = CX + R * Math.sin(startAngle)
  const y1 = CY - R * Math.cos(startAngle)
  const x2 = CX + R * Math.sin(endAngle)
  const y2 = CY - R * Math.cos(endAngle)
  const xi2 = CX + INNER * Math.sin(endAngle)
  const yi2 = CY - INNER * Math.cos(endAngle)
  const xi1 = CX + INNER * Math.sin(startAngle)
  const yi1 = CY - INNER * Math.cos(startAngle)
  return `M${x1.toFixed(2)},${y1.toFixed(2)} A${R},${R} 0 ${large} 1 ${x2.toFixed(2)},${y2.toFixed(2)} L${xi2.toFixed(2)},${yi2.toFixed(2)} A${INNER},${INNER} 0 ${large} 0 ${xi1.toFixed(2)},${yi1.toFixed(2)} Z`
}

export default function DonutChart({
  data,
  unit,
  centerValue,
  centerLabel,
  logoSlots = 3,
}: DonutChartProps) {
  const format = (v: number) =>
    unit === "euros" ? formatEuros(v) : `${v} consultant${v > 1 ? "s" : ""}`
  const [hover, setHover] = useState<number | null>(null)
  // Un logo n'est dessiné qu'une fois RÉELLEMENT chargé (préchargement JS —
  // l'onError des <image> SVG n'est pas fiable, on évite l'icône cassée).
  const [logoOk, setLogoOk] = useState<Record<string, boolean>>({})
  const total = data.reduce((n, d) => n + d.value, 0)

  const logoCandidates = data
    .slice(0, logoSlots)
    .map((d) => d.logo)
    .filter((l): l is string => !!l)
    .join("|")
  useEffect(() => {
    for (const src of logoCandidates.split("|").filter(Boolean)) {
      const img = new Image()
      img.onload = () => setLogoOk((k) => (k[src] ? k : { ...k, [src]: true }))
      img.src = src
    }
  }, [logoCandidates])

  if (total <= 0) {
    return <p className="text-[13px] text-texte-2">Aucune donnée à représenter.</p>
  }

  // Sommes cumulées SANS réassignation pendant le rendu (règle React Compiler).
  const cumul = data.reduce<number[]>((acc, d) => [...acc, (acc[acc.length - 1] ?? 0) + d.value], [])
  const slices = data.map((d, i) => {
    const start = ((cumul[i - 1] ?? 0) / total) * Math.PI * 2
    const end = (cumul[i] / total) * Math.PI * 2
    return { ...d, i, start, end, mid: (start + end) / 2, pct: d.value / total }
  })

  return (
    <div className="flex flex-wrap items-center gap-6">
      <div className="relative shrink-0">
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          width={SIZE}
          height={SIZE}
          role="img"
          aria-label={`Répartition : ${slices.map((s) => `${s.label} ${format(s.value)}`).join(", ")}`}
          onMouseLeave={() => setHover(null)}
        >
          {slices.map((s) => (
            <path
              key={s.i}
              d={arcPath(s.start, s.end)}
              fill={s.color}
              stroke="#ffffff"
              strokeWidth={2}
              opacity={hover === null || hover === s.i ? 1 : 0.35}
              onMouseEnter={() => setHover(s.i)}
            />
          ))}
          {/* % directs sur les parts ≥ 8 % (texte en encre du thème, hors tranche) */}
          {slices
            .filter((s) => s.pct >= 0.08)
            .map((s) => {
              const r = R + 14
              const x = px(CX + r * Math.sin(s.mid))
              const y = px(CY - r * Math.cos(s.mid))
              return (
                <text
                  key={`t${s.i}`}
                  x={x}
                  y={y + 3}
                  textAnchor="middle"
                  fontSize={10.5}
                  fontWeight={700}
                  fill="#50514a"
                >
                  {Math.round(s.pct * 100)} %
                </text>
              )
            })}
          {/* logos des plus grosses parts (uniquement si le fichier a chargé) */}
          {slices
            .filter((s) => s.i < logoSlots && s.logo && logoOk[s.logo] && s.pct >= 0.09)
            .map((s) => {
              const r = (R + INNER) / 2
              const x = px(CX + r * Math.sin(s.mid))
              const y = px(CY - r * Math.cos(s.mid))
              return (
                <g key={`l${s.i}`}>
                  <circle cx={x} cy={y} r={15} fill="#ffffff" opacity={0.92} />
                  <image href={s.logo!} x={x - 11} y={y - 11} width={22} height={22} />
                </g>
              )
            })}
          <text x={CX} y={CY - 4} textAnchor="middle" fontSize={22} fontWeight={700} fill="#1e1f1c" fontFamily="var(--font-serif)">
            {centerValue}
          </text>
          <text x={CX} y={CY + 14} textAnchor="middle" fontSize={9.5} fill="#6e6d62" letterSpacing="0.08em">
            {centerLabel.toUpperCase()}
          </text>
        </svg>

        {hover !== null && (
          <div className="absolute left-1/2 -translate-x-1/2 -bottom-1 card px-3 py-1.5 pointer-events-none shadow-sm whitespace-nowrap">
            <span className="text-[11.5px] font-bold text-anthracite">{slices[hover].label}</span>
            <span className="text-[11.5px] text-texte ml-2">
              {format(slices[hover].value)} · {Math.round(slices[hover].pct * 100)} %
            </span>
          </div>
        )}
      </div>

      <ul className="flex-1 min-w-[220px] space-y-1.5" aria-hidden="true">
        {slices.map((s) => (
          <li
            key={s.i}
            className={`flex items-baseline gap-2 text-[12.5px] cursor-default rounded px-1.5 py-0.5 ${hover === s.i ? "bg-fond" : ""}`}
            onMouseEnter={() => setHover(s.i)}
            onMouseLeave={() => setHover(null)}
          >
            <span className="dot shrink-0 self-center" style={{ background: s.color }} />
            <span className="font-bold text-anthracite truncate">{s.label}</span>
            <span className="text-texte-2 ml-auto whitespace-nowrap">
              {format(s.value)} · {Math.round(s.pct * 100)} %
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
