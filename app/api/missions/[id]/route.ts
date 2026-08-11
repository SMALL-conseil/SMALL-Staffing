import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { NextRequest, NextResponse } from "next/server"
import { validateMission } from "@/lib/staffing-admin"
import { PersonKind } from "@/lib/types"

async function guard() {
  const session = await auth()
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 })
  }
  return null
}

// PATCH /api/missions/[id] — modification (le rank est conservé : l'ordre de
// saisie d'origine continue de faire foi pour la carte).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guard()
  if (denied) return denied

  const { id } = await params
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: "Requête invalide" }, { status: 400 })

  const v = validateMission(body)
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 })

  const person = await prisma.person.findUnique({ where: { id: v.value.personId } })
  if (!person || person.kind !== PersonKind.CONSULTANT) {
    return NextResponse.json({ error: "Consultant introuvable" }, { status: 400 })
  }

  try {
    const mission = await prisma.mission.update({ where: { id }, data: v.value })
    return NextResponse.json(mission)
  } catch (e) {
    if ((e as { code?: string })?.code === "P2025") {
      return NextResponse.json({ error: "Mission introuvable" }, { status: 404 })
    }
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 })
  }
}

// DELETE /api/missions/[id]
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guard()
  if (denied) return denied

  const { id } = await params
  try {
    await prisma.mission.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    if ((e as { code?: string })?.code === "P2025") {
      return NextResponse.json({ error: "Mission introuvable" }, { status: 404 })
    }
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 })
  }
}
