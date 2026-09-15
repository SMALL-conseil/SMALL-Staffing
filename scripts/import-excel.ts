// ============================================================
// Import initial one-shot du classeur « Staffing SMALL Paris.xlsx ».
//
//   npx tsx scripts/import-excel.ts "C:\chemin\vers\Staffing SMALL Paris.xlsx"
//   npx tsx scripts/import-excel.ts <xlsx> --replace   # si la base contient déjà des données
//
// Seuls les 3 registres sont importés (Consultant, Siège, Mission_Consultant
// + absences prolongées du registre Consultant) : tout le reste de l'Excel se
// RECALCULE (moteur lib/staffing.ts). Le script termine par une vérification :
// KPIs de l'année en cours recalculés depuis la base et affichés.
// ============================================================
import "dotenv/config"
import { PrismaClient } from "@prisma/client"
import { PersonKind } from "../lib/types"
import { monthlyKpis, ytdRates } from "../lib/staffing"
// Le parsing du classeur vit dans lib/excel-registres.ts — PARTAGÉ avec
// scripts/compare-excel.ts (a21), pour que l'import et la comparaison lisent
// rigoureusement le même classeur de la même façon.
import { CONSULTANTS_EXCLUS, normNom, readRegistres } from "../lib/excel-registres"

const prisma = new PrismaClient()

// Corrections ASSUMÉES par rapport à l'Excel (décisions équipe — cf. CLAUDE.md) :
// Elvire HOUDEVILLE figure au registre Consultant de l'Excel (01/2025 → 09/2025,
// staffable jamais staffée) alors qu'elle a toujours tenu un rôle siège — sa
// période consultant faussait le taux de staffing 2025. Elle n'est importée
// QUE comme siège. (Décision du 11/08/2026 ; scripts/corrections.ts applique
// la même correction sur une base déjà importée. La liste vit désormais dans
// lib/excel-registres.ts, partagée avec le comparateur.)

// ---------- Import ----------

async function main() {
  const args = process.argv.slice(2)
  const replace = args.includes("--replace")
  const path = args.find((a) => !a.startsWith("--"))
  if (!path) {
    console.error('Usage : npx tsx scripts/import-excel.ts "<chemin du xlsx>" [--replace]')
    process.exit(1)
  }

  const reg = readRegistres(path)
  const exclus = new Set(CONSULTANTS_EXCLUS.map(normNom))
  const consultants = reg.consultants.filter((c) => {
    if (!exclus.has(normNom(c.name))) return true
    console.log(`  ⚠ ${c.name} : exclu du registre consultants (correction assumée — cf. CLAUDE.md)`)
    return false
  })
  const { siege } = reg
  // Les missions des exclus partent avec eux ; les ORPHELINES (consultant
  // absent du registre) restent signalées plus bas — elles révèlent un
  // classeur incohérent, on ne les avale pas en silence.
  const missions = reg.missions.filter((m) => !exclus.has(normNom(m.consultant)))
  console.log(
    `Classeur lu : ${consultants.length} consultants, ${siege.length} siège, ` +
      `${missions.length} missions, ${consultants.filter((c) => c.absenceStart).length} absences prolongées`
  )

  const missing = missions.filter((m) => !consultants.some((c) => c.name === m.consultant))
  if (missing.length)
    throw new Error(
      `missions orphelines (consultant absent du registre) : ${[...new Set(missing.map((m) => m.consultant))].join(", ")}`
    )

  const existing = await prisma.person.count()
  if (existing > 0 && !replace) {
    console.error(
      `La base contient déjà ${existing} personnes — relancer avec --replace pour tout remplacer ` +
        `(personnes, absences, missions).`
    )
    process.exit(1)
  }

  await prisma.$transaction(async (tx) => {
    if (existing > 0) {
      await tx.mission.deleteMany()
      await tx.longAbsence.deleteMany()
      await tx.person.deleteMany()
    }

    const idByName = new Map<string, string>()
    for (const c of consultants) {
      const p = await tx.person.create({
        data: {
          name: c.name,
          email: c.email,
          kind: PersonKind.CONSULTANT,
          grade: c.grade,
          arrivalDate: c.arrival,
          departureDate: c.departure,
        },
      })
      idByName.set(c.name, p.id)
    }
    for (const s of siege) {
      await tx.person.create({
        data: {
          name: s.name,
          kind: PersonKind.SIEGE,
          grade: s.grade,
          arrivalDate: s.arrival,
          departureDate: s.departure,
        },
      })
    }

    // managers (2e passe — le manager peut être saisi après son managé)
    for (const c of consultants) {
      if (!c.manager) continue
      const managerId = idByName.get(c.manager)
      if (!managerId) {
        console.warn(`  ⚠ manager introuvable pour ${c.name} : « ${c.manager} » (ignoré)`)
        continue
      }
      await tx.person.update({ where: { id: idByName.get(c.name)! }, data: { managerId } })
    }

    for (const c of consultants) {
      if (!c.absenceStart) continue
      await tx.longAbsence.create({
        data: {
          personId: idByName.get(c.name)!,
          startDate: c.absenceStart,
          endDate: c.absenceEnd,
        },
      })
    }

    for (const m of missions) {
      await tx.mission.create({
        data: {
          personId: idByName.get(m.consultant)!,
          client: m.client,
          startDate: m.start,
          endDate: m.end,
          share: m.share,
          rank: m.rank,
        },
      })
    }
  })

  const counts = {
    persons: await prisma.person.count(),
    absences: await prisma.longAbsence.count(),
    missions: await prisma.mission.count(),
  }
  console.log(
    `Import OK : ${counts.persons} personnes, ${counts.absences} absences, ${counts.missions} missions.`
  )

  // ---------- Vérification : KPIs recalculés depuis la base ----------
  const { loadStaffingData } = await import("../lib/staffing-load")
  const data = await loadStaffingData()
  const today = new Date().toISOString().slice(0, 10)
  const year = Number(today.slice(0, 4))
  const pct = (x: number) => `${(100 * x).toFixed(2).replace(".", ",")} %`
  console.log(`\nKPIs ${year} recalculés depuis la base :`)
  console.log("Mois | J.ouvrés | Eff.sal (ETP) | Tx sal. | Facturés |    IC   | Tx s+i")
  for (let m = 1; m <= 12; m++) {
    const k = monthlyKpis(data.people, data.missions, year, m)
    console.log(
      `  ${String(m).padStart(2, "0")} |    ${String(k.workingDays).padStart(2)}    |    ${k.effectifSalaries
        .toFixed(4)
        .padStart(8)} | ${pct(k.tauxSalaries).padStart(7)} | ${k.factures.toFixed(4).padStart(8)} | ${k.intercontrat
        .toFixed(4)
        .padStart(7)} | ${pct(k.tauxSalariesIndep).padStart(7)}`
    )
  }
  const ytd = ytdRates(data.people, data.missions, year, today)
  console.log(
    `YTD (fin ${ytd.cutoff}) : taux salariés ${pct(ytd.tauxSalaries)}, salariés+indép ${pct(ytd.tauxSalariesIndep)}`
  )
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
