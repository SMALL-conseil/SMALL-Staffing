// Chargement des données staffing depuis la base vers les entrées du moteur
// pur (lib/staffing.ts). Utilisé par le script d'import (vérification) et par
// les pages (dashboard, carte, IC…).
import { prisma } from "./prisma"
import { PersonKind } from "./types"
import type { HeadcountPerson, StaffMission, StaffPerson } from "./staffing"

/** Date Prisma (@db.Date, minuit UTC) → « YYYY-MM-DD ». */
export function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export interface StaffingData {
  /** Consultants (entrées moteur, absences incluses). */
  people: StaffPerson[]
  /** Missions ordonnées par rang de saisie (l'ordre fait foi pour la carte). */
  missions: StaffMission[]
  /** Siège + consultants pour le suivi des effectifs (têtes). */
  siege: HeadcountPerson[]
}

export async function loadStaffingData(): Promise<StaffingData> {
  const persons = await prisma.person.findMany({
    where: { active: true },
    include: { absences: true },
    orderBy: { createdAt: "asc" },
  })
  const missions = await prisma.mission.findMany({
    orderBy: [{ rank: "asc" }, { createdAt: "asc" }],
  })

  const people: StaffPerson[] = persons
    .filter((p) => p.kind === PersonKind.CONSULTANT)
    .map((p) => ({
      id: p.id,
      name: p.name,
      grade: p.grade,
      arrival: toIsoDate(p.arrivalDate),
      departure: p.departureDate ? toIsoDate(p.departureDate) : null,
      absences: p.absences.map((a) => ({
        start: toIsoDate(a.startDate),
        end: a.endDate ? toIsoDate(a.endDate) : null,
      })),
    }))

  const siege: HeadcountPerson[] = persons
    .filter((p) => p.kind === PersonKind.SIEGE)
    .map((p) => ({
      grade: p.grade,
      arrival: toIsoDate(p.arrivalDate),
      departure: p.departureDate ? toIsoDate(p.departureDate) : null,
    }))

  return {
    people,
    missions: missions.map((m, i) => ({
      personId: m.personId,
      client: m.client,
      start: toIsoDate(m.startDate),
      end: toIsoDate(m.endDate),
      share: m.share,
      rank: m.rank ?? i,
    })),
    siege,
  }
}
