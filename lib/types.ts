// Rôles applicatifs — pseudo-enum TypeScript (les colonnes restent String côté
// Prisma, convention du framework SMALL). Étendre ici en ajoutant des rôles,
// puis adapter components/Sidebar.tsx (navByRole) et les gates des pages admin.
export const Role = {
  MEMBER: "MEMBER",
  ADMIN: "ADMIN",
} as const
export type Role = (typeof Role)[keyof typeof Role]

export const roleLabels: Record<string, string> = {
  MEMBER: "Membre",
  ADMIN: "Admin",
}

// ------------------------------------------------------------
// Métier staffing — pseudo-enums (colonnes String côté Prisma).
// ------------------------------------------------------------

export const PersonKind = {
  CONSULTANT: "CONSULTANT",
  SIEGE: "SIEGE",
} as const
export type PersonKind = (typeof PersonKind)[keyof typeof PersonKind]

// Grades consultants — échelons FINS de l'Excel, ne JAMAIS aplatir.
// L'ordre est celui du Suivi_Effectif (du plus senior au plus junior).
export const CONSULTANT_GRADES = [
  "SM 2",
  "SM 1",
  "M 2",
  "M 1",
  "CS 2",
  "CS 1",
  "C",
  "Rookie",
  "Indép",
] as const
export type ConsultantGrade = (typeof CONSULTANT_GRADES)[number]

// Grades siège — les lignes du Suivi_Effectif, dans son ordre d'affichage.
// Un grade hors liste (ex. « DG SMALL Bordeaux ») peut exister en base :
// fidèle à l'Excel, il n'est compté dans AUCUNE ligne ni total du suivi.
export const SIEGE_GRADES = [
  "Fondateur",
  "Directeur du développement",
  "Office Manager",
  "Business Developer",
  "Sales Manager",
  "Chief Mission Officer",
  "Rookie",
  "Chargée de missions transverses",
] as const
export type SiegeGrade = (typeof SIEGE_GRADES)[number]

export const GRADE_ROOKIE = "Rookie"
export const GRADE_INDEP = "Indép"

// Indépendant : hors périmètre « salariés » des KPIs (mais compté en « salariés + indép »).
export function isIndep(grade: string): boolean {
  return grade === GRADE_INDEP
}

// Rookie : jamais staffable (exclu des effectifs et des taux, présent dans le Suivi_Effectif).
export function isRookie(grade: string): boolean {
  return grade === GRADE_ROOKIE
}
