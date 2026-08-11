"use client"

// Absences prolongées (maternité, sabbatique…) — CRUD. La fenêtre est
// soustraite des jours staffables par le moteur ; fin vide = absence ouverte.
import { useState } from "react"
import { useRouter } from "next/navigation"
import { Pencil, Plus, Trash2, X } from "lucide-react"
import { formatDateShort } from "@/lib/utils"

export interface AbsenceRow {
  id: string
  personId: string
  personName: string
  start: string
  end: string | null
  label: string | null
}

interface Props {
  absences: AbsenceRow[]
  consultants: { id: string; name: string; grade: string }[]
}

interface FormState {
  personId: string
  startDate: string
  endDate: string
  label: string
}

const EMPTY: FormState = { personId: "", startDate: "", endDate: "", label: "" }

export default function AbsencesAdmin({ absences, consultants }: Props) {
  const router = useRouter()
  const [editing, setEditing] = useState<string | "new" | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  function openNew() {
    setForm(EMPTY)
    setEditing("new")
    setError(null)
    setConfirmDelete(null)
  }

  function openEdit(a: AbsenceRow) {
    setForm({ personId: a.personId, startDate: a.start, endDate: a.end ?? "", label: a.label ?? "" })
    setEditing(a.id)
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
    const url = editing === "new" ? "/api/absences" : `/api/absences/${editing}`
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
    const res = await fetch(`/api/absences/${id}`, { method: "DELETE" })
    setConfirmDelete(null)
    if (!res.ok) {
      const data = await res.json().catch(() => null)
      setError(data?.error ?? "Erreur lors de la suppression")
      return
    }
    if (editing === id) close()
    router.refresh()
  }

  return (
    <div className="card px-6 py-6">
      <div className="flex items-center justify-between gap-4 mb-1">
        <h2 className="titre-section">Absences prolongées</h2>
        <button type="button" onClick={openNew} className="btn btn-ghost">
          <Plus size={14} aria-hidden="true" /> Ajouter
        </button>
      </div>
      <p className="text-[11.5px] text-label mb-4">
        Fenêtres soustraites des jours staffables (maternité, sabbatique, sans solde…) — fin vide
        = retour inconnu.
      </p>

      {editing !== null && (
        <form onSubmit={submit} className="rounded-[10px] border border-jaune-ligne bg-creme px-4 py-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-[12.5px] font-bold text-anthracite">
              {editing === "new" ? "Nouvelle absence" : "Modifier l'absence"}
            </div>
            <button type="button" onClick={close} aria-label="Fermer" className="text-label hover:text-anthracite p-1">
              <X size={15} aria-hidden="true" />
            </button>
          </div>
          <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="field-label" htmlFor="a-personId">Consultant</label>
              <select
                id="a-personId"
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
              <label className="field-label" htmlFor="a-start">Début</label>
              <input
                id="a-start"
                required
                type="date"
                value={form.startDate}
                onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                className="field-input"
              />
            </div>
            <div>
              <label className="field-label" htmlFor="a-end">Fin (optionnel)</label>
              <input
                id="a-end"
                type="date"
                value={form.endDate}
                onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                className="field-input"
              />
            </div>
            <div>
              <label className="field-label" htmlFor="a-label">Libellé (optionnel)</label>
              <input
                id="a-label"
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                className="field-input"
                placeholder="maternité, sabbatique…"
              />
            </div>
          </div>
          {error && <p className="text-[12.5px] text-err mt-3">{error}</p>}
          <div className="flex gap-2.5 mt-3.5">
            <button type="submit" disabled={saving} className="btn btn-primary">
              {saving ? "Enregistrement…" : "Enregistrer"}
            </button>
            <button type="button" onClick={close} className="btn btn-ghost">
              Annuler
            </button>
          </div>
        </form>
      )}

      {absences.length === 0 ? (
        <p className="text-[13px] text-texte-2">Aucune absence prolongée enregistrée.</p>
      ) : (
        <div className="divide-y divide-fond">
          {absences.map((a) => (
            <div key={a.id} className="py-2.5 grid grid-cols-12 gap-2 items-center text-[13px]">
              <div className="col-span-4 font-bold text-anthracite truncate">{a.personName}</div>
              <div className="col-span-2 text-texte-2 text-[12px]">{formatDateShort(a.start)}</div>
              <div className="col-span-2 text-texte-2 text-[12px]">
                {a.end ? formatDateShort(a.end) : "—"}
              </div>
              <div className="col-span-2 text-texte truncate">{a.label ?? ""}</div>
              <div className="col-span-2 flex justify-end gap-1.5">
                <button
                  type="button"
                  onClick={() => openEdit(a)}
                  className="chip inline-flex items-center gap-1"
                  aria-label={`Modifier l'absence de ${a.personName}`}
                >
                  <Pencil size={12} aria-hidden="true" /> Modifier
                </button>
                <button
                  type="button"
                  onClick={() => remove(a.id)}
                  className={`chip inline-flex items-center gap-1 ${
                    confirmDelete === a.id ? "bg-err-bg text-err border-err-ligne font-bold" : ""
                  }`}
                  aria-label={`Supprimer l'absence de ${a.personName}`}
                >
                  <Trash2 size={12} aria-hidden="true" />
                  {confirmDelete === a.id ? "Confirmer ?" : "Supprimer"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
