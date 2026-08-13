// ============================================================
// Tests GOLDEN du moteur de staffing — extraits du classeur de référence
// « Staffing SMALL Paris.xlsx » (cache Excel du 10/08/2026, année pilotée 2026).
//
// Contrat du projet : toute évolution du moteur doit passer ces tests.
// Les fixtures :
//   fixtures/registres.json — les 3 registres saisis (50 consultants,
//     10 siège, 61 missions, 4 absences prolongées) — la seule vraie donnée.
//   fixtures/golden.json — les valeurs CALCULÉES par Excel : matrices
//     Staffable/Staffés, KPIs mensuels + YTD, carte, IC, effectifs.
//
// Périmètre des assertions matricielles : les 12 mois de 2026 uniquement.
// L'Excel applique les fériés de l'année pilotée (2026) à TOUS les mois de
// ses matrices 2025→2029 ; le moteur calcule les fériés de l'année de chaque
// mois. Sur 2026 les deux régimes coïncident (vérifié : 0 écart sur les
// 6 221 cellules et vues du classeur) ; hors 2026 le moteur est plus juste
// que la matrice cachée, qui n'est d'ailleurs jamais affichée.
// ============================================================

import { describe, expect, it } from "vitest"
import {
  carteStaffing,
  easterSunday,
  headcount,
  icAtDate,
  monthlyKpis,
  mouvementsMoisProchain,
  sortiesMoisCourant,
  staffableDays,
  staffedDays,
  workingDaysInMonth,
  ytdRates,
  type StaffMission,
  type StaffPerson,
} from "@/lib/staffing"
import registres from "./fixtures/registres.json"
import golden from "./fixtures/golden.json"

// Date de calcul du classeur de référence (cache TODAY() de l'Excel).
const TODAY = "2026-08-10"
const YEAR = 2026

// ---------- Fixtures → entrées moteur ----------

const people: StaffPerson[] = registres.consultants.map((c) => ({
  id: c.name,
  name: c.name,
  grade: c.grade,
  arrival: c.arrival as string,
  departure: c.departure,
  absences: c.absenceStart ? [{ start: c.absenceStart, end: c.absenceEnd }] : [],
}))

const missions: StaffMission[] = registres.missions.map((m, i) => ({
  personId: m.consultant,
  client: m.client,
  start: m.start as string,
  end: m.end as string,
  share: m.share,
  rank: i,
}))

const byName = new Map(people.map((p) => [p.name, p]))

// Index des colonnes 2026 dans les matrices golden (2025-01 → 2029-12).
const IDX_2026 = golden.staffableMonths
  .map((ym, i) => ({ ym, i }))
  .filter(({ ym }) => ym.startsWith("2026-"))
  .map(({ i }) => i)

const approx = (got: number, want: number, eps = 2e-6) =>
  expect(Math.abs(got - want), `attendu ${want}, obtenu ${got}`).toBeLessThan(eps)

// ---------- Registres ----------

describe("fixtures (autopsie de l'Excel)", () => {
  it("volumes conformes au classeur", () => {
    expect(registres.consultants).toHaveLength(50)
    expect(registres.siege).toHaveLength(10)
    expect(registres.missions).toHaveLength(61)
    expect(registres.consultants.filter((c) => c.absenceStart)).toHaveLength(4)
    expect(new Set(registres.missions.map((m) => m.client)).size).toBe(20)
  })
})

// ---------- Calendrier ----------

describe("jours ouvrés français", () => {
  it("Pâques 2026 tombe le 5 avril", () => {
    expect(easterSunday(2026)).toBe("2026-04-05")
  })

  it("jours ouvrés 2026 identiques à l'Excel (dont mai = 18 : lundi de Pentecôte travaillé)", () => {
    const want = golden.kpis2026.workingDays
    for (let m = 1; m <= 12; m++) {
      expect(workingDaysInMonth(2026, m), `mois ${m}`).toBe(want[m - 1])
    }
    expect(workingDaysInMonth(2026, 5)).toBe(18)
  })

  it("hors année pilotée, les fériés sont ceux de l'année du mois (janvier 2025 = 22, pas 23)", () => {
    // La matrice Excel dit 23 (fériés 2026 appliqués à 2025) — le moteur est plus juste.
    expect(workingDaysInMonth(2025, 1)).toBe(22)
  })
})

// ---------- Matrices individuelles (les 600 cellules 2026 de chaque matrice) ----------

describe("matrice Staffable — cellules 2026", () => {
  it.each(Object.keys(golden.staffable))("%s", (name) => {
    const p = byName.get(name)!
    const row = golden.staffable[name as keyof typeof golden.staffable] as number[]
    for (const i of IDX_2026) {
      const month = Number(golden.staffableMonths[i].slice(5))
      approx(staffableDays(p, missions, YEAR, month), row[i])
    }
  })
})

describe("matrice Staffés — cellules 2026 (formule exacte, trous pontés, plafond staffable)", () => {
  it.each(Object.keys(golden.staffes))("%s", (name) => {
    const p = byName.get(name)!
    const row = golden.staffes[name as keyof typeof golden.staffes] as number[]
    for (const i of IDX_2026) {
      const month = Number(golden.staffesMonths[i].slice(5))
      approx(staffedDays(p, missions, YEAR, month), row[i])
    }
  })
})

// ---------- KPIs mensuels ----------

describe("KPIs mensuels 2026 (onglet Staffing, lignes 2-8)", () => {
  const fields = [
    ["workingDays", "workingDays"],
    ["effSalaries", "effectifSalaries"],
    ["txSalaries", "tauxSalaries"],
    ["effSalIndep", "effectifSalariesIndep"],
    ["factures", "factures"],
    ["ic", "intercontrat"],
    ["txSalIndep", "tauxSalariesIndep"],
  ] as const

  it.each(Array.from({ length: 12 }, (_, i) => i + 1))("2026-%i", (month) => {
    const got = monthlyKpis(people, missions, YEAR, month)
    for (const [goldenKey, engineKey] of fields) {
      const want = (golden.kpis2026 as Record<string, number[]>)[goldenKey][month - 1]
      approx(got[engineKey], want)
    }
  })

  it("valeurs du doc de spec (janvier : 21 j.o., 29,2381 ETP, 82,74 %)", () => {
    const jan = monthlyKpis(people, missions, YEAR, 1)
    expect(jan.workingDays).toBe(21)
    approx(jan.effectifSalaries, 29.2381, 5e-5)
    approx(jan.tauxSalaries, 0.8274, 5e-5)
    approx(jan.intercontrat, 5.0476, 5e-5)
  })
})

// ---------- YTD ----------

describe("taux YTD arrêtés à fin du mois courant", () => {
  it("au 10/08/2026 : cutoff 31/08, salariés 84,97 %, salariés+indép 85,42 %", () => {
    const ytd = ytdRates(people, missions, YEAR, TODAY)
    expect(ytd.cutoff).toBe(golden.ytd.cutoff)
    expect(ytd.months).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    approx(ytd.tauxSalaries, golden.ytd.txSalaries)
    approx(ytd.tauxSalariesIndep, golden.ytd.txSalIndep)
    approx(ytd.tauxSalaries, 0.8497, 5e-5)
    approx(ytd.tauxSalariesIndep, 0.8542, 5e-5)
  })

  it("cutoff borné au 31/12 de l'année pilotée", () => {
    const ytd = ytdRates(people, missions, YEAR, "2027-03-15")
    expect(ytd.cutoff).toBe("2026-12-31")
    expect(ytd.months).toHaveLength(12)
  })
})

// ---------- Carte de staffing ----------

describe("carte de staffing 2026", () => {
  const carte = carteStaffing(people, missions, YEAR)
  const carteByName = new Map(carte.map((r) => [r.name, r]))

  it("périmètre : 41 consultants (départs antérieurs à 2026 exclus, arrivées futures incluses)", () => {
    expect(carte).toHaveLength(Object.keys(golden.carte).length)
    expect(new Set(carte.map((r) => r.name))).toEqual(new Set(Object.keys(golden.carte)))
  })

  it.each(Object.keys(golden.carte))("%s", (name) => {
    const want = (golden.carte as Record<string, (string | null)[]>)[name]
    expect(carteByName.get(name)!.clients).toEqual(want)
  })
})

// ---------- IC à date + mouvements ----------

describe("intercontrat et mouvements (au 10/08/2026)", () => {
  it("IC à date : Aicha PY, Anais MARTIN, Danny GAURAT, Victor RINGENBACH", () => {
    expect(icAtDate(people, missions, TODAY).map((e) => e.name)).toEqual(golden.icADate)
  })

  it("sorties de mission d'ici fin août (l'Excel affichait max(fin, dispo))", () => {
    const got = sortiesMoisCourant(people, missions, TODAY).map((e) => [e.name, e.availableFrom ?? e.date])
    expect(got).toEqual(golden.sortiesMoisCourant)
    // Clémence BUYSSE : mission finissant le 17/08 mais absente jusqu'au 31/12
    const clemence = sortiesMoisCourant(people, missions, TODAY).find((e) => e.name === "Clémence BUYSSE")
    expect(clemence?.date).toBe("2026-08-17")
    expect(clemence?.availableFrom).toBe("2026-12-31")
  })

  it("mouvements de septembre (sorties + arrivées)", () => {
    const got = mouvementsMoisProchain(people, missions, TODAY)
    expect(got.map((e) => [e.name, e.availableFrom ?? e.date])).toEqual(golden.sortiesArriveesMoisProchain)
    expect(got.find((e) => e.name === "Julien CAZABAT")?.type).toBe("SORTIE")
    expect(got.find((e) => e.name === "Anaïs MATHONNET")?.type).toBe("ARRIVEE")
  })
})

// ---------- Suivi des effectifs ----------

describe("suivi des effectifs (têtes par grade × mois, 2026-01 → 2027-01)", () => {
  const SIEGE_ROWS: [number, string][] = [
    [4, "Fondateur"],
    [5, "Directeur du développement"],
    [6, "Office Manager"],
    [7, "Business Developer"],
    [8, "Sales Manager"],
    [9, "Chief Mission Officer"],
    [10, "Rookie"],
    [11, "Chargée de missions transverses"],
  ]
  const CONS_ROWS: [number, string][] = [
    [13, "SM 2"],
    [14, "SM 1"],
    [15, "M 2"],
    [16, "M 1"],
    [17, "CS 2"],
    [18, "CS 1"],
    [19, "C"],
    [20, "Rookie"],
    [21, "Indép"],
  ]
  const effectif = golden.effectif as Record<string, number[]>

  it.each(golden.effectifMonths.map((ym, i) => [ym, i] as const))("%s", (ym, i) => {
    const year = Number(ym.slice(0, 4))
    const month = Number(ym.slice(5))
    let siegeTotal = 0
    for (const [row, grade] of SIEGE_ROWS) {
      const got = headcount(registres.siege, grade, year, month)
      expect(got, `siège ${grade}`).toBe(effectif[`r${row}_${grade}`][i])
      siegeTotal += got
    }
    let consTotal = 0
    for (const [row, grade] of CONS_ROWS) {
      const got = headcount(registres.consultants, grade, year, month)
      expect(got, `consultant ${grade}`).toBe(effectif[`r${row}_${grade}`][i])
      consTotal += got
    }
    expect(siegeTotal, "total siège").toBe(effectif["r3_Effectif Siège"][i])
    expect(consTotal, "total consultants").toBe(effectif["r12_Effectif Consultant"][i])
    expect(siegeTotal + consTotal, "total").toBe(effectif["r2_Effectif Total"][i])
  })

  it("janvier 2026 : 40 têtes = 8 siège + 32 consultants (valeur du doc)", () => {
    expect(effectif["r2_Effectif Total"][0]).toBe(40)
  })
})
