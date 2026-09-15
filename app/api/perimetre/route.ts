import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { PERIMETRE_COOKIE, Role } from "@/lib/types"
import { perimetresAutorises } from "@/lib/perimetre"
import { prisma } from "@/lib/prisma"

// Bascule du périmètre observé (s5) — POST { perimetre }.
// Le cookie n'est posé QUE si le périmètre demandé fait partie des droits du
// compte : c'est ici que se joue le cloisonnement Paris / Bordeaux, pas dans
// l'interface (un consultant qui forgerait la requête reçoit un 403).
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const demande = String(body?.perimetre ?? "").toUpperCase()

  const role = session.user.role ?? Role.CONSULTANT
  let agence: string | null = null
  if (role !== Role.SIEGE && session.user.email) {
    const fiche = await prisma.person.findUnique({
      where: { email: session.user.email.toLowerCase() },
      select: { agency: true },
    })
    agence = fiche?.agency ?? null
  }

  if (!(perimetresAutorises(role, agence) as string[]).includes(demande)) {
    return NextResponse.json({ error: "Périmètre non autorisé" }, { status: 403 })
  }

  const res = NextResponse.json({ ok: true, perimetre: demande })
  res.cookies.set(PERIMETRE_COOKIE, demande, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  })
  return res
}
