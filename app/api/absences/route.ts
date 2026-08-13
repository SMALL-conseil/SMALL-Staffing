import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { NextRequest, NextResponse } from "next/server"
import { validateAbsence } from "@/lib/staffing-admin"
import { Role, PersonKind } from "@/lib/types"

// POST /api/absences — création d'une absence prolongée (Admin uniquement).
// Portée par un CONSULTANT (comme le registre de l'Excel) : c'est la fenêtre
// soustraite de ses jours staffables par le moteur.
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user || session.user.role !== Role.SIEGE) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: "Requête invalide" }, { status: 400 })

  const v = validateAbsence(body)
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 })

  const person = await prisma.person.findUnique({ where: { id: v.value.personId } })
  if (!person || person.kind !== PersonKind.CONSULTANT) {
    return NextResponse.json({ error: "Consultant introuvable" }, { status: 400 })
  }

  const absence = await prisma.longAbsence.create({ data: v.value })
  return NextResponse.json(absence, { status: 201 })
}
