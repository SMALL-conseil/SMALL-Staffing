"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { Role, roleLabels } from "@/lib/types"

const ROLES = Object.values(Role).map((value) => ({
  value,
  label: roleLabels[value] ?? value,
}))

interface RoleSelectProps {
  userId: string
  role: string
  isSelf: boolean
}

export default function RoleSelect({ userId, role, isSelf }: RoleSelectProps) {
  const router = useRouter()
  const [current, setCurrent] = useState(role)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [, startTransition] = useTransition()

  async function handleChange(next: string) {
    if (next === current) return
    const previous = current
    setCurrent(next)
    setError(null)
    setSaving(true)
    try {
      const res = await fetch(`/api/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: next }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error ?? "Erreur lors de la mise à jour")
      }
      startTransition(() => router.refresh())
    } catch (e) {
      setCurrent(previous)
      setError(e instanceof Error ? e.message : "Erreur lors de la mise à jour")
    } finally {
      setSaving(false)
    }
  }

  // Anti-verrouillage : on ne modifie pas son propre rôle depuis l'interface
  // (seul un Admin voit cette page — son propre rôle reste donc Admin).
  if (isSelf) {
    return <span className="badge">Admin (vous)</span>
  }

  return (
    <div>
      <select
        value={current}
        onChange={(e) => handleChange(e.target.value)}
        disabled={saving}
        aria-label="Modifier le rôle"
        className="field-input py-1.5! text-xs w-auto"
      >
        {ROLES.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
      </select>
      {error && <div className="text-[11px] text-err mt-1">{error}</div>}
    </div>
  )
}
