import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { Agency, CONSULTANT_GRADES, PersonKind, Role, SIEGE_GRADES } from "@/lib/types"

// Registre des personnes — deux champs modifiables ici, et deux seulement :
//  · l'AGENCE (s5) : « Boond ET/OU app », une valeur posée à la main tient tant
//    que Boond n'en fournit pas une reconnaissable (cf. lib/boond-sync.ts) ;
//  · le GRADE (a30) : le Suivi_Effectif ne compte QUE les grades de la grille
//    (fidèle à l'Excel), or les titres Boond sont parfois libres (« Directeur
//    SMALL Bordeaux ») et l'équipe n'a pas la main dessus dans BoondManager.
//    Un grade de la grille posé ici n'est jamais remplacé par un titre hors
//    grille à la synchro suivante (garde-fou a10).
// Le reste de la fiche vient de Boond : le rendre éditable ouvrirait des
// divergences que la synchro écraserait au passage suivant.
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

  const data: { agency?: string | null; grade?: string } = {}

  if ("agency" in body) {
    const brut = body.agency === null || body.agency === "" ? null : String(body.agency).toUpperCase()
    if (brut !== null && brut !== Agency.PARIS && brut !== Agency.BORDEAUX) {
      return NextResponse.json({ error: "Agence inconnue (Paris ou Bordeaux)" }, { status: 400 })
    }
    data.agency = brut
  }

  if ("grade" in body) {
    const grade = String(body.grade ?? "").trim()
    if (!grade) return NextResponse.json({ error: "Grade vide" }, { status: 400 })
    // Le grade doit appartenir à la grille du KIND de la personne : c'est cette
    // grille qui fait les lignes du Suivi_Effectif. Un grade libre ne se saisit
    // pas ici — il ne peut venir que de Boond, et il est signalé comme tel.
    const person = await prisma.person.findUnique({ where: { id }, select: { kind: true } })
    if (!person) return NextResponse.json({ error: "Personne introuvable" }, { status: 404 })
    const grille: readonly string[] =
      person.kind === PersonKind.SIEGE ? SIEGE_GRADES : CONSULTANT_GRADES
    if (!grille.includes(grade)) {
      return NextResponse.json(
        { error: `Grade hors grille ${person.kind} : ${grille.join(", ")}` },
        { status: 400 }
      )
    }
    data.grade = grade
  }

  if (!Object.keys(data).length) {
    return NextResponse.json({ error: "Rien à modifier (agency ou grade attendu)" }, { status: 400 })
  }

  try {
    const person = await prisma.person.update({ where: { id }, data })
    return NextResponse.json({ ok: true, agency: person.agency, grade: person.grade })
  } catch (e) {
    if ((e as { code?: string })?.code === "P2025") {
      return NextResponse.json({ error: "Personne introuvable" }, { status: 404 })
    }
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 })
  }
}
