"use client"

// Grade d'une personne, modifiable en place (a30) — registre Siège.
//
// Pourquoi : le Suivi_Effectif ne compte QUE les grades de la grille (fidèle à
// l'Excel). Un titre Boond libre — « Directeur SMALL Bordeaux », « Project
// Manager Credit Risk » — fait donc disparaître la personne du tableau des
// effectifs, alors qu'elle compte bien dans le taux de staffing. L'équipe n'a
// pas la main sur les Titres dans BoondManager (constat du 14/08) : la
// correction doit pouvoir se faire ici.
//
// Le grade posé à la main TIENT : la synchro ne remplace jamais un grade de la
// grille par un titre hors grille (garde-fou a10), elle le signale seulement.
import { useState } from "react"
import { useRouter } from "next/navigation"
import { CONSULTANT_GRADES, PersonKind, SIEGE_GRADES } from "@/lib/types"

interface Props {
  personId: string
  grade: string
  kind: string
}

export default function GradeCell({ personId, grade, kind }: Props) {
  const router = useRouter()
  const [valeur, setValeur] = useState(grade)
  const [etat, setEtat] = useState<"repos" | "envoi" | "erreur">("repos")

  const grille: readonly string[] =
    kind === PersonKind.SIEGE ? SIEGE_GRADES : CONSULTANT_GRADES
  const horsGrille = !grille.includes(valeur)

  async function changer(v: string) {
    if (v === valeur) return
    const avant = valeur
    setValeur(v)
    setEtat("envoi")
    try {
      const res = await fetch(`/api/personnes/${personId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grade: v }),
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
      aria-label="Grade"
      title={
        etat === "erreur"
          ? "Enregistrement impossible — réessayer"
          : horsGrille
            ? `« ${valeur} » est hors grille : la personne n'est comptée dans AUCUNE ligne du Suivi des effectifs (elle compte en revanche dans le taux de staffing).`
            : undefined
      }
      className={`field-input py-0.5 px-1.5 text-[12px] ${
        etat === "erreur" ? "border-err-ligne" : horsGrille ? "border-err-ligne text-err" : ""
      }`}
    >
      {/* Le titre Boond hors grille reste proposé : on ne perd jamais
          silencieusement la valeur d'origine. */}
      {horsGrille && <option value={valeur}>{valeur} (hors grille)</option>}
      {grille.map((g) => (
        <option key={g} value={g}>
          {g}
        </option>
      ))}
    </select>
  )
}
