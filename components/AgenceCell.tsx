"use client"

// Agence d'une personne, modifiable en place (s5) — registre Siège.
// « Non renseignée » n'est pas neutre : la personne compte alors dans le
// périmètre PARIS par défaut, et le libellé le dit pour éviter toute
// interprétation silencieuse.
import { useState } from "react"
import { useRouter } from "next/navigation"
import { Agency, agencyLabels } from "@/lib/types"

interface Props {
  personId: string
  agency: string | null
}

export default function AgenceCell({ personId, agency }: Props) {
  const router = useRouter()
  const [valeur, setValeur] = useState(agency ?? "")
  const [etat, setEtat] = useState<"repos" | "envoi" | "erreur">("repos")

  async function changer(v: string) {
    const avant = valeur
    setValeur(v)
    setEtat("envoi")
    try {
      const res = await fetch(`/api/personnes/${personId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agency: v === "" ? null : v }),
      })
      if (!res.ok) {
        setValeur(avant)
        setEtat("erreur")
        return
      }
      setEtat("repos")
      router.refresh()
    } catch {
      setValeur(avant)
      setEtat("erreur")
    }
  }

  return (
    <select
      value={valeur}
      onChange={(e) => changer(e.target.value)}
      disabled={etat === "envoi"}
      aria-label="Agence de rattachement"
      title={
        etat === "erreur"
          ? "Enregistrement impossible — réessayer"
          : valeur === ""
            ? "Non renseignée : comptée dans le périmètre Paris par défaut"
            : undefined
      }
      className={`field-input py-0.5 px-1.5 text-[12px] ${
        etat === "erreur" ? "border-err-ligne" : valeur === "" ? "text-label" : ""
      }`}
    >
      <option value="">— (Paris par défaut)</option>
      <option value={Agency.PARIS}>{agencyLabels.PARIS}</option>
      <option value={Agency.BORDEAUX}>{agencyLabels.BORDEAUX}</option>
    </select>
  )
}
