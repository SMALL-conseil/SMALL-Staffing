"use client"

// Missions proposées par les prestations Boond (s8) — registre Siège.
//
// Les prestations PROPOSENT, elles n'écrivent pas : rien n'entre au registre
// sans un clic. Chaque ligne montre ce qui sera créé — personne, client, dates,
// part, honoraires — et les jours de CRA déjà pointés, qui sont la preuve que
// la mission a bien eu lieu.
//
// a35 — une prestation qui CHEVAUCHE une mission déjà au registre n'apparaît
// plus : la mission existe, sous un autre libellé client. Sur Paris, dont le
// registre est complet, ces lignes n'étaient que du bruit — et un bruit qui
// invitait à créer un doublon. Elles restent COMPTÉES dans l'en-tête : un écran
// qui cache sans le dire serait pire.
import { useState } from "react"
import { useRouter } from "next/navigation"
import { Plus } from "lucide-react"
import { formatDateShort } from "@/lib/utils"

export interface PropositionUI {
  boondId: string
  personName: string
  agency: string | null
  client: string
  start: string
  end: string
  fees: number | null
  share: number
  motifShare: string
  joursPointes: number
}

interface Props {
  propositions: PropositionUI[]
  prestations: number
  sansRessource: number
  sansFiche: number
  /** a35 — prestations couvertes par une mission existante : comptées, pas proposées. */
  chevauchantes: number
}

export default function PropositionsCard({
  propositions,
  prestations,
  sansRessource,
  sansFiche,
  chevauchantes,
}: Props) {
  const router = useRouter()
  const [enCours, setEnCours] = useState<string | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null)
  // a33 — PLUS DE CRÉATION EN MASSE. Un bouton « tout créer » sur un registre
  // déjà complet (Paris) peut le remplir de doublons d'un seul clic : le coût
  // d'une erreur y est sans commune mesure avec le temps gagné. Chaque mission
  // se crée donc à l'unité, en ayant lu sa ligne.

  async function creer(boondIds: string[], etiquette: string) {
    setEnCours(etiquette)
    setMessage(null)
    try {
      const res = await fetch("/api/missions/proposees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ boondIds }),
      })
      const data = await res.json()
      if (!res.ok) {
        setMessage({ ok: false, texte: data?.error ?? "Création impossible" })
      } else {
        setMessage({
          ok: true,
          texte: `${data.creees} mission(s) créée(s) au registre.`,
        })
        router.refresh()
      }
    } catch {
      setMessage({ ok: false, texte: "Appel impossible — vérifier la connexion" })
    }
    setEnCours(null)
  }

  if (!prestations) {
    return (
      <div className="card px-6 py-6 mb-5">
        <h2 className="titre-section">Missions proposées par Boond</h2>
        <p className="text-[12.5px] text-texte-2 mt-2">
          Aucune prestation en base. Synchroniser les prestations depuis /admin/reporting
          (elles s&rsquo;énumèrent à partir des jours de CRA : recharger l&rsquo;historique d&rsquo;abord).
        </p>
      </div>
    )
  }

  return (
    <div className="card px-6 py-6 mb-5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="titre-section">Missions proposées par Boond</h2>
          <p className="text-[11.5px] text-label mt-1">
            Périmètre observé · {prestations} prestation(s) connue(s) · {propositions.length} sans
            mission au registre
            {chevauchantes > 0 &&
              ` · ${chevauchantes} déjà couverte(s) par une mission du registre (non proposées)`}
            {sansFiche > 0 && ` · ${sansFiche} sur une ressource absente du registre`}
            {sansRessource > 0 && ` · ${sansRessource} sans ressource dans Boond`}
          </p>
        </div>
      </div>

      {message && (
        <p className={`text-[12.5px] mt-3 ${message.ok ? "text-ok" : "text-err"}`}>{message.texte}</p>
      )}

      {propositions.length === 0 ? (
        <p className="text-[12.5px] text-texte-2 mt-3">
          Chaque prestation Boond a sa mission au registre. 👍
        </p>
      ) : (
        <div className="divide-y divide-fond mt-3">
          {propositions.map((p) => (
            <div key={p.boondId} className="py-2.5 grid grid-cols-12 gap-2 items-center text-[12.5px]">
              <div className="col-span-3 font-bold text-anthracite truncate">
                {p.personName}
                {p.agency === "BORDEAUX" && (
                  <span className="text-[10.5px] text-label font-normal ml-2">Bordeaux</span>
                )}
              </div>
              <div className="col-span-3 text-texte truncate" title={p.client}>
                {p.client}
              </div>
              <div className="col-span-3 text-texte-2 text-[12px]">
                {formatDateShort(p.start)} → {formatDateShort(p.end)}
                <span className="block text-[10.5px] text-label">
                  {p.fees !== null ? `${p.fees} € / j · ` : "sans TJM · "}
                  part {p.share}
                  {p.joursPointes > 0 ? ` · ${p.joursPointes} j pointés` : " · aucun jour pointé"}
                </span>
              </div>
              <div className="col-span-3 flex justify-end">
                <button
                  type="button"
                  onClick={() => creer([p.boondId], p.boondId)}
                  disabled={enCours !== null}
                  className="btn btn-ghost py-1"
                  title={p.motifShare}
                >
                  <Plus size={13} aria-hidden="true" />
                  {enCours === p.boondId ? "Création…" : "Créer"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-[11px] text-label mt-3">
        La part d&rsquo;intervention est <em>déduite</em> des jours vendus (survoler « Créer » pour
        le détail) : Boond ne la porte pas. À corriger au registre si besoin. Une mission créée
        ici porte la note « Prestation Boond … » : elle est donc annulable en bloc si l&rsquo;on
        s&rsquo;est trompé (<code>scripts/annuler-propositions.ts</code>).
      </p>
    </div>
  )
}
