import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { NextRequest, NextResponse } from "next/server"
import { chargePropositions } from "@/lib/missions-proposees-load"
import { todayParis } from "@/lib/staffing-ui"
import { Role } from "@/lib/types"

// POST /api/missions/proposees — crée au registre les missions proposées par
// les prestations Boond (s8). Rôle Siège uniquement.
//
// Le client n'envoie que des IDENTIFIANTS de prestation : dates, client, TJM et
// part sont TOUJOURS recalculés ici, à partir de la base. Une page ouverte
// depuis une heure, ou une requête forgée, ne peut donc pas écrire une mission
// de son choix — elle ne peut que déclencher ce que le serveur propose déjà.
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user || session.user.role !== Role.SIEGE) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  const demandes: string[] = Array.isArray(body?.boondIds) ? body.boondIds.map(String) : []
  if (!demandes.length) {
    return NextResponse.json({ error: "Aucune prestation demandée" }, { status: 400 })
  }

  const { liste } = await chargePropositions()
  const retenues = liste.filter((p) => demandes.includes(p.boondId))
  const perimees = demandes.filter((id) => !retenues.some((p) => p.boondId === id))

  if (!retenues.length) {
    return NextResponse.json(
      {
        error:
          "Ces prestations ne sont plus proposées (mission déjà créée entre-temps ?) — rafraîchir la page.",
      },
      { status: 409 }
    )
  }

  const today = todayParis()
  const creees: { client: string; personName: string }[] = []

  // Une transaction : soit le lot entre entier, soit rien. Des missions à moitié
  // créées seraient plus difficiles à démêler qu'un bouton à recliquer.
  await prisma.$transaction(async (tx) => {
    const last = await tx.mission.aggregate({ _max: { rank: true } })
    let rank = (last._max.rank ?? -1) + 1
    for (const p of retenues) {
      await tx.mission.create({
        data: {
          personId: p.personId,
          client: p.client,
          startDate: new Date(`${p.start}T00:00:00.000Z`),
          endDate: new Date(`${p.end}T00:00:00.000Z`),
          share: p.share,
          // Même règle que la saisie manuelle : pas d'honoraires sur une mission
          // qui n'a pas commencé.
          fees: p.start > today ? null : p.fees,
          note: `Prestation Boond ${p.boondId}`,
          rank: rank++,
        },
      })
      creees.push({ client: p.client, personName: p.personName })
    }
  })

  return NextResponse.json({ ok: true, creees: creees.length, detail: creees, perimees })
}
