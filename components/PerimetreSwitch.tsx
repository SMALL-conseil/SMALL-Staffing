"use client"

// Sélecteur de périmètre (s5) — visible dans la barre latérale.
// Un seul périmètre autorisé (cas d'un consultant) : simple étiquette, pas de
// contrôle. Le choix est posé en cookie par /api/perimetre, qui revalide les
// droits côté serveur ; router.refresh() rejoue le rendu des pages.
import { useState } from "react"
import { useRouter } from "next/navigation"
import { Building2 } from "lucide-react"
import { perimetreLabels } from "@/lib/types"

interface Props {
  perimetre: string
  autorises: string[]
}

export default function PerimetreSwitch({ perimetre, autorises }: Props) {
  const router = useRouter()
  const [encours, setEncours] = useState<string | null>(null)

  async function choisir(p: string) {
    if (p === perimetre || encours) return
    setEncours(p)
    try {
      const res = await fetch("/api/perimetre", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ perimetre: p }),
      })
      if (res.ok) router.refresh()
    } finally {
      setEncours(null)
    }
  }

  if (autorises.length <= 1) {
    return (
      <div className="px-6 pb-4">
        <div className="kicker mb-1.5">Périmètre</div>
        <div className="flex items-center gap-1.5 text-[12.5px] text-texte">
          <Building2 size={13} aria-hidden="true" className="text-label" />
          {perimetreLabels[perimetre] ?? perimetre}
        </div>
      </div>
    )
  }

  return (
    <div className="px-6 pb-4">
      <div className="kicker mb-1.5">Périmètre</div>
      <div className="flex flex-wrap gap-1" role="group" aria-label="Choisir le périmètre observé">
        {autorises.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => choisir(p)}
            aria-pressed={p === perimetre}
            disabled={encours !== null}
            className={`chip px-2 py-0.5 text-[11.5px] ${p === perimetre ? "chip-on" : ""} ${
              encours === p ? "opacity-60" : ""
            }`}
          >
            {perimetreLabels[p] ?? p}
          </button>
        ))}
      </div>
    </div>
  )
}
