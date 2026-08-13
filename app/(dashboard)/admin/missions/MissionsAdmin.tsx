"use client"

// Registre des missions — LA saisie qui remplace l'Excel. Table dans l'ordre
// du registre (rank, qui fait foi pour la carte de staffing) + formulaire de
// création/édition, suppression en deux temps. Mutations via /api/missions.
import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Pencil, Plus, Trash2, X } from "lucide-react"
import { formatDateShort } from "@/lib/utils"
import { formatEuros, formatPct, todayParis } from "@/lib/staffing-ui"

export interface MissionRow {
  id: string
  personId: string
  personName: string
  client: string
  start: string
  end: string
  share: number
  note: string | null
  rank: number
  /** Honoraires (€) — cette page n'est servie qu'au rôle Siège. */
  fees: number | null
}

export interface ConsultantOption {
  id: string
  name: string
  grade: string
}

interface Props {
  missions: MissionRow[]
  consultants: ConsultantOption[]
  clients: string[]
}

interface FormState {
  personId: string
  client: string
  startDate: string
  endDate: string
  share: string
  note: string
  fees: string
}

const EMPTY: FormState = {
  personId: "",
  client: "",
  startDate: "",
  endDate: "",
  share: "1",
  note: "",
  fees: "",
}

type StatutFiltre = "toutes" | "en_cours" | "a_venir" | "terminees"

export default function MissionsAdmin({ missions, consultants, clients }: Props) {
  const router = useRouter()
  const [filtre, setFiltre] = useState("")
  const [statutFiltre, setStatutFiltre] = useState<StatutFiltre>("toutes")
  const [editing, setEditing] = useState<string | "new" | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const today = todayParis()

  const statutDe = (m: MissionRow): StatutFiltre =>
    m.start <= today && today <= m.end ? "en_cours" : m.start > today ? "a_venir" : "terminees"

  const parStatut = useMemo(() => {
    const n: Record<StatutFiltre, number> = { toutes: missions.length, en_cours: 0, a_venir: 0, terminees: 0 }
    for (const m of missions) n[statutDe(m)]++
    return n
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missions, today])

  const visibles = useMemo(() => {
    const f = filtre.trim().toLowerCase()
    return missions.filter((m) => {
      if (statutFiltre !== "toutes" && statutDe(m) !== statutFiltre) return false
      if (!f) return true
      return m.personName.toLowerCase().includes(f) || m.client.toLowerCase().includes(f)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missions, filtre, statutFiltre, today])

  function openNew() {
    setForm(EMPTY)
    setEditing("new")
    setError(null)
    setConfirmDelete(null)
  }

  function openEdit(m: MissionRow) {
    setForm({
      personId: m.personId,
      client: m.client,
      startDate: m.start,
      endDate: m.end,
      share: String(m.share).replace(".", ","),
      note: m.note ?? "",
      fees: m.fees != null ? String(m.fees).replace(".", ",") : "",
    })
    setEditing(m.id)
    setError(null)
    setConfirmDelete(null)
  }

  function close() {
    setEditing(null)
    setError(null)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    const url = editing === "new" ? "/api/missions" : `/api/missions/${editing}`
    const res = await fetch(url, {
      method: editing === "new" ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    })
    setSaving(false)
    if (!res.ok) {
      const data = await res.json().catch(() => null)
      setError(data?.error ?? "Erreur lors de l'enregistrement")
      return
    }
    close()
    router.refresh()
  }

  async function remove(id: string) {
    if (confirmDelete !== id) {
      setConfirmDelete(id)
      return
    }
    const res = await fetch(`/api/missions/${id}`, { method: "DELETE" })
    setConfirmDelete(null)
    if (!res.ok) {
      const data = await res.json().catch(() => null)
      setError(data?.error ?? "Erreur lors de la suppression")
      return
    }
    if (editing === id) close()
    router.refresh()
  }

  function statut(m: MissionRow): { label: string; cls: string } | null {
    if (m.start <= today && today <= m.end) return { label: "en cours", cls: "tag-ok" }
    if (m.start > today) return { label: "à venir", cls: "tag-attente" }
    return null
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <input
          type="search"
          value={filtre}
          onChange={(e) => setFiltre(e.target.value)}
          placeholder="Filtrer par consultant ou client…"
          className="field-input max-w-[320px]"
          aria-label="Filtrer les missions"
        />
        <span className="text-[12px] text-texte-2">
          {visibles.length}/{missions.length} missions
        </span>
        <button type="button" onClick={openNew} className="btn btn-primary ml-auto">
          <Plus size={15} aria-hidden="true" /> Nouvelle mission
        </button>
      </div>

      <div className="flex flex-wrap gap-2 mb-4" role="group" aria-label="Filtrer par statut">
        {(
          [
            ["toutes", "Toutes"],
            ["en_cours", "En cours"],
            ["a_venir", "À venir"],
            ["terminees", "Terminées"],
          ] as [StatutFiltre, string][]
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setStatutFiltre(value)}
            className={`chip ${statutFiltre === value ? "chip-on" : ""}`}
            aria-pressed={statutFiltre === value}
          >
            {label} ({parStatut[value]})
          </button>
        ))}
      </div>

      {editing !== null && (
        <form onSubmit={submit} className="card px-5 py-5 mb-5 border-jaune-ligne">
          <div className="flex items-center justify-between mb-4">
            <h2 className="titre-section text-[16px]!">
              {editing === "new" ? "Nouvelle mission" : "Modifier la mission"}
            </h2>
            <button type="button" onClick={close} aria-label="Fermer" className="text-label hover:text-anthracite p-1">
              <X size={16} aria-hidden="true" />
            </button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="field-label" htmlFor="m-personId">Consultant</label>
              <select
                id="m-personId"
                required
                value={form.personId}
                onChange={(e) => setForm({ ...form, personId: e.target.value })}
                className="field-input"
              >
                <option value="" disabled>
                  Choisir…
                </option>
                {consultants.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} — {c.grade}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="m-client">Client</label>
              <input
                id="m-client"
                required
                list="clients-connus"
                value={form.client}
                onChange={(e) => setForm({ ...form, client: e.target.value })}
                className="field-input"
                placeholder="ACCOR, GROUPAMA…"
              />
              <datalist id="clients-connus">
                {clients.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
            <div>
              <label className="field-label" htmlFor="m-share">Part d&rsquo;intervention (0–1)</label>
              <input
                id="m-share"
                required
                value={form.share}
                onChange={(e) => setForm({ ...form, share: e.target.value })}
                className="field-input"
                placeholder="1 ou 0,8"
                inputMode="decimal"
              />
            </div>
            <div>
              <label className="field-label" htmlFor="m-start">Début</label>
              <input
                id="m-start"
                required
                type="date"
                value={form.startDate}
                onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                className="field-input"
              />
            </div>
            <div>
              <label className="field-label" htmlFor="m-end">Fin</label>
              <input
                id="m-end"
                required
                type="date"
                value={form.endDate}
                onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                className="field-input"
              />
            </div>
            <div>
              <label className="field-label" htmlFor="m-note">Note (optionnel)</label>
              <input
                id="m-note"
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
                className="field-input"
              />
            </div>
            <div>
              <label className="field-label" htmlFor="m-fees">Honoraires (€ / jour) — rôle siège</label>
              <input
                id="m-fees"
                value={form.fees}
                onChange={(e) => setForm({ ...form, fees: e.target.value })}
                className="field-input"
                placeholder="ex. 1 200"
                inputMode="decimal"
                disabled={!!form.startDate && form.startDate > today}
                title={
                  form.startDate && form.startDate > today
                    ? "Mission non commencée — honoraires à renseigner une fois la mission démarrée"
                    : "Vider le champ pour supprimer les honoraires"
                }
              />
              <p className="text-[10.5px] text-label mt-1">
                {form.startDate && form.startDate > today
                  ? "Mission non commencée : saisie possible dès son démarrage."
                  : "Vider le champ = supprimer le montant."}
              </p>
            </div>
          </div>
          {error && <p className="text-[12.5px] text-err mt-3">{error}</p>}
          <div className="flex gap-2.5 mt-4">
            <button type="submit" disabled={saving} className="btn btn-primary">
              {saving ? "Enregistrement…" : "Enregistrer"}
            </button>
            <button type="button" onClick={close} className="btn btn-ghost">
              Annuler
            </button>
          </div>
        </form>
      )}

      <div className="card overflow-hidden">
        <div className="px-5 py-3 border-b border-fond bg-creme">
          <div className="grid grid-cols-12 gap-2 text-[10.5px] font-bold text-label uppercase tracking-[0.14em]">
            <div className="col-span-3">Consultant</div>
            <div className="col-span-2">Client</div>
            <div className="col-span-1">Début</div>
            <div className="col-span-1">Fin</div>
            <div className="col-span-1 text-right">Part</div>
            <div className="col-span-2 text-right">Honoraires</div>
            <div className="col-span-2 text-right">Actions</div>
          </div>
        </div>
        <div className="divide-y divide-fond">
          {visibles.map((m) => {
            const s = statut(m)
            return (
              <div key={m.id} className="px-5 py-2.5 grid grid-cols-12 gap-2 items-center text-[13px]">
                <div className="col-span-3 font-bold text-anthracite truncate" title={m.note ?? undefined}>
                  {m.personName}
                  {s && <span className={`tag ml-2 ${s.cls}`}>{s.label}</span>}
                </div>
                <div className="col-span-2 text-texte truncate">{m.client}</div>
                <div className="col-span-1 text-texte-2 text-[11px]">{formatDateShort(m.start)}</div>
                <div className="col-span-1 text-texte-2 text-[11px]">{formatDateShort(m.end)}</div>
                <div className="col-span-1 text-right text-texte whitespace-nowrap">
                  {formatPct(m.share, 0)}
                </div>
                <div className="col-span-2 text-right whitespace-nowrap">
                  {m.fees != null ? (
                    <span className="font-bold text-anthracite">{formatEuros(m.fees)} / j</span>
                  ) : (
                    <span className="text-gris-moyen">—</span>
                  )}
                </div>
                <div className="col-span-2 flex justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={() => openEdit(m)}
                    className="chip inline-flex items-center gap-1 px-2"
                    title="Modifier"
                    aria-label={`Modifier la mission de ${m.personName} chez ${m.client}`}
                  >
                    <Pencil size={13} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(m.id)}
                    className={`chip inline-flex items-center gap-1 px-2 ${
                      confirmDelete === m.id ? "bg-err-bg text-err border-err-ligne font-bold" : ""
                    }`}
                    title={confirmDelete === m.id ? "Confirmer la suppression" : "Supprimer"}
                    aria-label={`Supprimer la mission de ${m.personName} chez ${m.client}`}
                  >
                    <Trash2 size={13} aria-hidden="true" />
                    {confirmDelete === m.id && "Confirmer ?"}
                  </button>
                </div>
              </div>
            )
          })}
          {visibles.length === 0 && (
            <div className="px-5 py-8 text-center text-[13px] text-texte-2">
              Aucune mission ne correspond au filtre.
            </div>
          )}
        </div>
      </div>
      <p className="text-[11px] text-label mt-3">
        L&rsquo;ordre de saisie fait foi pour la carte de staffing (1re mission chevauchant le
        mois) — la modification d&rsquo;une mission conserve sa position d&rsquo;origine.
      </p>
    </div>
  )
}
