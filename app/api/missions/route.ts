import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { NextRequest, NextResponse } from "next/server"
import { validateMission } from "@/lib/staffing-admin"
import { todayParis } from "@/lib/staffing-ui"
import { Role, PersonKind } from "@/lib/types"

// POST /api/missions — création d'une mission (rôle Siège uniquement).
// Le rank (ordre de saisie) est attribué automatiquement : il fait foi pour
// la carte de staffing (1re mission chevauchant le mois), comme l'ordre du
// registre de l'Excel. Honoraires : missions commencées uniquement.
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user || session.user.role !== Role.SIEGE) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: "Requête invalide" }, { status: 400 })

  const v = validateMission(body)
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 })
  if (v.value.fees !== null && v.value.startDate.toISOString().slice(0, 10) > todayParis()) {
    return NextResponse.json(
      { error: "Les honoraires ne se renseignent que sur une mission commencée (en cours ou passée)" },
      { status: 400 }
    )
  }

  const person = await prisma.person.findUnique({ where: { id: v.value.personId } })
  if (!person || person.kind !== PersonKind.CONSULTANT) {
    return NextResponse.json({ error: "Consultant introuvable" }, { status: 400 })
  }

  const last = await prisma.mission.aggregate({ _max: { rank: true } })
  const mission = await prisma.mission.create({
    data: { ...v.value, rank: (last._max.rank ?? -1) + 1 },
  })
  return NextResponse.json(mission, { status: 201 })
}
