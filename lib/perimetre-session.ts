// ============================================================
//  Contexte de PÉRIMÈTRE côté serveur (s5).
//  Rattache le compte connecté à sa fiche du registre PAR EMAIL (décision du
//  15/09) — l'agence vient donc de Boond et reste à jour sans geste
//  d'administration. Le périmètre observé est mémorisé dans un cookie, mais
//  TOUJOURS revalidé ici contre les droits du compte : un cookie bricolé ne
//  donne accès à rien (cf. lib/perimetre.ts, testé).
//  `cache()` dédoublonne la lecture pour tous les appels d'un même rendu.
// ============================================================
import { cache } from "react"
import { cookies } from "next/headers"
import { auth } from "@/auth"
import { prisma } from "./prisma"
import { PERIMETRE_COOKIE, Perimetre, Role } from "./types"
import { perimetresAutorises, resoudrePerimetre } from "./perimetre"

export interface ContextePerimetre {
  role: string
  /** Agence de la fiche rapprochée par email — null si non rattaché. */
  agence: string | null
  /** Le compte a-t-il une fiche au registre ? (sinon : repli Paris) */
  rattache: boolean
  autorises: Perimetre[]
  perimetre: Perimetre
}

export const contextePerimetre = cache(async (): Promise<ContextePerimetre> => {
  const session = await auth()
  const role = session?.user?.role ?? Role.CONSULTANT
  const email = session?.user?.email ?? null

  // Le siège voit tous les périmètres : inutile de chercher sa fiche.
  let agence: string | null = null
  let rattache = role === Role.SIEGE
  if (email && role !== Role.SIEGE) {
    const fiche = await prisma.person.findUnique({
      where: { email: email.toLowerCase() },
      select: { agency: true },
    })
    if (fiche) {
      rattache = true
      agence = fiche.agency
    }
  }

  const demande = (await cookies()).get(PERIMETRE_COOKIE)?.value
  return {
    role,
    agence,
    rattache,
    autorises: perimetresAutorises(role, agence),
    perimetre: resoudrePerimetre(demande, role, agence),
  }
})
