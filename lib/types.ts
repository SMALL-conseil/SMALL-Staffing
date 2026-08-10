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
