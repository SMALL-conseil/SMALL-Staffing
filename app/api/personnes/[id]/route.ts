import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { Agency, Role } from "@/lib/types"

// Registre des personnes — seule l'AGENCE est modifiable ici (s5).
// Le reste de la fiche vient de Boond : la rendre éditable ouvrirait des
// divergences que la synchro écraserait au passage suivant. L'agence, elle,
// est « Boond ET/OU app » : une valeur posée à la main tient tant que Boond
// n'en fournit pas une reconnaissable (cf. lib/boond-sync.ts).
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user || session.user.role !== Role.SIEGE) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: "Requête invalide" }, { status: 400 })

  const brut = body.agency === null || body.agency === "" ? null : String(body.agency).toUpperCase()
  if (brut !== null && brut !== Agency.PARIS && brut !== Agency.BORDEAUX) {
    return NextResponse.json({ error: "Agence inconnue (Paris ou Bordeaux)" }, { status: 400 })
  }

  try {
    const person = await prisma.person.update({ where: { id }, data: { agency: brut } })
    return NextResponse.json({ ok: true, agency: person.agency })
  } catch (e) {
    if ((e as { code?: string })?.code === "P2025") {
      return NextResponse.json({ error: "Personne introuvable" }, { status: 404 })
    }
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 })
  }
}
