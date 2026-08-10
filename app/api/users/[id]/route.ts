import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { NextRequest, NextResponse } from "next/server"
import { Role } from "@/lib/types"

// PATCH /api/users/[id] — modification du rôle d'un utilisateur (Admin
// uniquement). Utilisé par le sélecteur de rôle de /admin/utilisateurs.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json().catch(() => null)
  const role = body?.role as string | undefined

  if (!role || !Object.values(Role).includes(role as Role)) {
    return NextResponse.json({ error: "Rôle invalide" }, { status: 400 })
  }

  // Anti-verrouillage : un admin ne peut pas se retirer son propre rôle
  // (sinon plus personne pour administrer si c'était le dernier).
  if (id === session.user.id && role !== Role.ADMIN) {
    return NextResponse.json(
      { error: "Impossible de retirer son propre rôle Admin" },
      { status: 400 }
    )
  }

  try {
    const user = await prisma.user.update({
      where: { id },
      data: { role },
      select: { id: true, email: true, role: true },
    })
    return NextResponse.json(user)
  } catch (e: any) {
    if (e?.code === "P2025") {
      return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 404 })
    }
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 })
  }
}
