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
import { readFileSync } from "node:fs"
import * as XLSX from "xlsx"
import { PrismaClient } from "@prisma/client"
import { CONSULTANT_GRADES, PersonKind, SIEGE_GRADES } from "../lib/types"
import { monthlyKpis, ytdRates } from "../lib/staffing"

const prisma = new PrismaClient()

// Corrections ASSUMÉES par rapport à l'Excel (décisions équipe — cf. CLAUDE.md) :
// Elvire HOUDEVILLE figure au registre Consultant de l'Excel (01/2025 → 09/2025,
// staffable jamais staffée) alors qu'elle a toujours tenu un rôle siège — sa
// période consultant faussait le taux de staffing 2025. Elle n'est importée
// QUE comme siège. (Décision du 11/08/2026 ; scripts/corrections.ts applique
// la même correction sur une base déjà importée.)
const CONSULTANTS_EXCLUS = ["Elvire HOUDEVILLE"]

// ---------- Lecture Excel ----------

/** Sérial Excel (base 30/12/1899) → Date UTC minuit, null si vide/0. */
function serialToDate(v: unknown): Date | null {
  if (v == null || v === "" || v === 0) return null
  if (v instanceof Date) return new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate()))
  if (typeof v !== "number") throw new Error(`date attendue, reçu : ${JSON.stringify(v)}`)
  return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86_400_000)
}

function asName(v: unknown): string | null {
  if (typeof v !== "string") return null
  const s = v.trim()
  return s.length ? s : null
}

interface ConsultantRow {
  name: string
  email: string | null
  grade: string
  arrival: Date
  departure: Date | null
  absenceStart: Date | null
  absenceEnd: Date | null
  manager: string | null
}
interface SiegeRow {
  name: string
  grade: string
  arrival: Date
  departure: Date | null
}
interface MissionRow {
  consultant: string
  client: string
  start: Date
  end: Date
  share: number
  rank: number
}

function readWorkbook(path: string) {
  const wb = XLSX.read(readFileSync(path), { type: "buffer", cellDates: false })
  const sheet = (name: string) => {
    const ws = wb.Sheets[name]
    if (!ws) throw new Error(`onglet « ${name} » introuvable dans ${path}`)
    // header:1 = lignes brutes ; raw:true = sérials numériques pour les dates
    return XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true })
  }

  const consultants: ConsultantRow[] = []
  for (const row of sheet("Consultant").slice(1)) {
    const name = asName(row[0])
    if (!name) continue
    if (CONSULTANTS_EXCLUS.includes(name)) {
      console.log(`  ⚠ ${name} : exclu du registre consultants (correction assumée — cf. CLAUDE.md)`)
      continue
    }
    const grade = asName(row[2])
    if (!grade || !(CONSULTANT_GRADES as readonly string[]).includes(grade))
      throw new Error(`grade consultant inconnu pour ${name} : « ${grade} »`)
    const arrival = serialToDate(row[3])
    if (!arrival) throw new Error(`date d'arrivée manquante pour ${name}`)
    consultants.push({
      name,
      email: asName(row[1]),
      grade,
      arrival,
      departure: serialToDate(row[4]),
      absenceStart: serialToDate(row[5]),
      absenceEnd: serialToDate(row[6]),
      manager: asName(row[7]),
    })
  }

  const siege: SiegeRow[] = []
  for (const row of sheet("Siège").slice(1)) {
    const name = asName(row[0])
    if (!name) continue
    const grade = asName(row[1])
    if (!grade) throw new Error(`grade siège manquant pour ${name}`)
    if (!(SIEGE_GRADES as readonly string[]).includes(grade))
      // fidèle à l'Excel : un grade siège hors liste (ex. « DG SMALL Bordeaux »)
      // est importé mais n'apparaît dans aucune ligne du suivi des effectifs
      console.warn(`  ⚠ grade siège hors suivi des effectifs pour ${name} : « ${grade} » (importé tel quel)`)
    const arrival = serialToDate(row[2])
    if (!arrival) throw new Error(`date d'arrivée manquante pour ${name}`)
    siege.push({ name, grade, arrival, departure: serialToDate(row[3]) })
  }

  const missions: MissionRow[] = []
  for (const row of sheet("Mission_Consultant").slice(1)) {
    const consultant = asName(row[0])
    if (!consultant) continue
    const client = asName(row[2])
    const start = serialToDate(row[3])
    const end = serialToDate(row[4])
    const share = typeof row[5] === "number" ? row[5] : NaN
    if (!client || !start || !end) throw new Error(`mission incomplète pour ${consultant}`)
    if (Number.isNaN(share) || share <= 0 || share > 1)
      throw new Error(`part d'intervention invalide pour ${consultant} (${row[5]})`)
    if (start.getTime() > end.getTime())
      throw new Error(`mission de ${consultant} chez ${client} : début après fin`)
    missions.push({ consultant, client, start, end, share, rank: missions.length })
  }

  return { consultants, siege, missions }
}

// ---------- Import ----------

async function main() {
  const args = process.argv.slice(2)
  const replace = args.includes("--replace")
  const path = args.find((a) => !a.startsWith("--"))
  if (!path) {
    console.error('Usage : npx tsx scripts/import-excel.ts "<chemin du xlsx>" [--replace]')
    process.exit(1)
  }

  const { consultants, siege, missions } = readWorkbook(path)
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
