// ============================================================
//  Chargement des propositions de missions (s8) — côté serveur.
//  La DÉCISION est dans lib/missions-proposees.ts (pure, testée) ; ici on ne
//  fait que lire la base et rapprocher les prestations Boond des personnes.
//
//  Une prestation ne devient une proposition que si sa ressource Boond
//  correspond à une fiche du registre. La chaîne de mobilité (s7) est
//  respectée : le boondId est porté par la fiche EN COURS, et c'est à elle
//  qu'une mission d'aujourd'hui doit être rattachée.
// ============================================================
import { prisma } from "./prisma"
import { toIsoDate } from "./staffing-load"
import {
  partitionner,
  propositions,
  type MissionExistante,
  type PrestationSource,
} from "./missions-proposees"
import { dansLePerimetre } from "./perimetre"
import { Perimetre, PersonKind } from "./types"

export interface PropositionAffichee {
  boondId: string
  personId: string
  personName: string
  /** Agence de la personne — pour voir d'un coup d'œil ce qui vient de Bordeaux. */
  agency: string | null
  client: string
  start: string
  end: string
  fees: number | null
  share: number
  motifShare: string
  /** Mission existante qui chevauche la fenêtre chez un AUTRE client (temps
   *  partagé légitime, mais à regarder avant de créer). Null = rien à signaler. */
  chevauche: string | null
  /** Jours de CRA déjà pointés sur cette prestation — preuve que la mission a eu lieu. */
  joursPointes: number
}

export async function chargePropositions(perimetre: Perimetre = Perimetre.TOUT): Promise<{
  liste: PropositionAffichee[]
  prestations: number
  sansRessource: number
  sansFiche: number
  /** a35 — prestations qui chevauchent une mission déjà au registre : comptées,
   *  pas proposées (la mission existe, sous un autre libellé client). */
  chevauchantes: number
}> {
  const [deliveries, persons, missions] = await Promise.all([
    prisma.delivery.findMany({
      select: {
        boondId: true,
        clientName: true,
        startDate: true,
        endDate: true,
        dailyRate: true,
        daysSold: true,
        workingDays: true,
        resourceBoondId: true,
      },
    }),
    // a33 — les propositions suivent le PÉRIMÈTRE observé. Le registre, lui,
    // reste complet : mais une liste de propositions parisiennes n'a rien à
    // faire sous les yeux de quelqu'un qui travaille sur Bordeaux, et
    // inversement. C'est une liste de travail, pas un registre.
    prisma.person.findMany({
      where: { kind: PersonKind.CONSULTANT, active: true },
      select: { id: true, name: true, agency: true, boondId: true },
    }),
    prisma.mission.findMany({ select: { personId: true, client: true, startDate: true, endDate: true } }),
  ])

  const parBoondId = new Map(
    persons
      .filter((p) => p.boondId && dansLePerimetre(p.agency, perimetre))
      .map((p) => [p.boondId as string, p])
  )
  let sansRessource = 0
  let sansFiche = 0

  const sources: PrestationSource[] = []
  const meta = new Map<string, { personName: string; agency: string | null }>()
  for (const d of deliveries) {
    if (!d.resourceBoondId) {
      sansRessource++
      continue
    }
    const personne = parBoondId.get(d.resourceBoondId)
    if (!personne) {
      sansFiche++
      continue
    }
    sources.push({
      boondId: d.boondId,
      personId: personne.id,
      client: d.clientName ?? "",
      start: d.startDate ? toIsoDate(d.startDate) : "",
      end: d.endDate ? toIsoDate(d.endDate) : "",
      dailyRate: d.dailyRate,
      daysSold: d.daysSold,
      workingDays: d.workingDays,
    })
    meta.set(d.boondId, { personName: personne.name, agency: personne.agency })
  }

  const existantes: MissionExistante[] = missions.map((m) => ({
    personId: m.personId,
    client: m.client,
    start: toIsoDate(m.startDate),
    end: toIsoDate(m.endDate),
  }))

  // a35 — on ne propose QUE ce qui ne chevauche aucune mission existante.
  const { franches, chevauchantes } = partitionner(propositions(sources, existantes))
  const retenues = franches

  // Jours de CRA déjà pointés sur chaque prestation retenue : c'est la preuve
  // que la mission a bien eu lieu, et le meilleur argument pour la créer.
  const compte = retenues.length
    ? await prisma.timeEntry.groupBy({
        by: ["deliveryBoondId"],
        where: {
          deliveryBoondId: { in: retenues.map((p) => p.boondId) },
          activityType: "production",
        },
        _sum: { duration: true },
      })
    : []
  const jours = new Map(compte.map((c) => [String(c.deliveryBoondId), c._sum.duration ?? 0]))

  return {
    liste: retenues.map((p) => ({
      ...p,
      personName: meta.get(p.boondId)?.personName ?? "?",
      agency: meta.get(p.boondId)?.agency ?? null,
      joursPointes: jours.get(p.boondId) ?? 0,
    })),
    prestations: deliveries.length,
    sansRessource,
    sansFiche,
    chevauchantes: chevauchantes.length,
  }
}
