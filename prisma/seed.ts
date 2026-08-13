import "dotenv/config"
import { PrismaClient } from "@prisma/client"
import bcrypt from "bcryptjs"

// Seed de développement : 2 comptes de démonstration.
// Lancement : npx tsx prisma/seed.ts   (le seed n'est pas déclaré dans
// package.json — convention du framework, `prisma db seed` ne marche pas).
const prisma = new PrismaClient()

async function main() {
  const password = await bcrypt.hash("Smallchange2024!", 10)

  await prisma.user.upsert({
    where: { email: "admin@small-conseil.fr" },
    update: {},
    create: {
      email: "admin@small-conseil.fr",
      name: "Admin Démo",
      password,
      role: "SIEGE",
    },
  })

  await prisma.user.upsert({
    where: { email: "membre@small-conseil.fr" },
    update: {},
    create: {
      email: "membre@small-conseil.fr",
      name: "Membre Démo",
      password,
      role: "CONSULTANT",
    },
  })

  console.log("Seed OK — comptes : admin@small-conseil.fr / membre@small-conseil.fr (mdp Smallchange2024!)")
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
