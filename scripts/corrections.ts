// ============================================================
//  Corrections de données ASSUMÉES par rapport à l'Excel de référence —
//  idempotent, à lancer une fois sur une base déjà importée :
//      npx tsx scripts/corrections.ts
//  (le ré-import via scripts/import-excel.ts applique les mêmes corrections
//  à la source ; ce script sert aux bases existantes, local comme préprod).
//  Chaque correction est datée et documentée dans CLAUDE.md § Métier.
// ============================================================
import "dotenv/config"
import { PrismaClient } from "@prisma/client"
import { PersonKind } from "../lib/types"

const prisma = new PrismaClient()

async function main() {
  let applied = 0

  // --- 11/08/2026 — Elvire HOUDEVILLE : retirer la fiche CONSULTANT ---
  // (rôle siège dès l'origine ; sa période consultant 01/2025 → 09/2025,
  // staffable jamais staffée, faussait le taux de staffing 2025. Sa fiche
  // SIÈGE reste. Suppression en cascade de ses absences/missions — aucune.)
  const elvire = await prisma.person.findUnique({
    where: { name_kind: { name: "Elvire HOUDEVILLE", kind: PersonKind.CONSULTANT } },
    include: { _count: { select: { missions: true, absences: true, managees: true } } },
  })
  if (elvire) {
    if (elvire._count.missions > 0) {
      console.warn(
        `  ⚠ Elvire HOUDEVILLE (consultant) a ${elvire._count.missions} mission(s) — suppression refusée, vérifier à la main.`
      )
    } else {
      if (elvire._count.managees > 0) {
        await prisma.person.updateMany({ where: { managerId: elvire.id }, data: { managerId: null } })
      }
      await prisma.person.delete({ where: { id: elvire.id } })
      console.log("  ✔ Elvire HOUDEVILLE : fiche consultant supprimée (la fiche siège reste).")
      applied++
    }
  } else {
    console.log("  · Elvire HOUDEVILLE : déjà absente du registre consultants — rien à faire.")
  }

  console.log(`\n${applied} correction(s) appliquée(s).`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
