import { describe, expect, it } from "vitest"
import { extractPerson, normDate, normalizeTitle, pickDailyRate, pickEmail } from "@/lib/boond"

describe("pickDailyRate (TJM fiche, a17)", () => {
  it("nombre positif → gardé ; 0, vide, non numérique → null", () => {
    expect(pickDailyRate({ averageDailyPriceExcludingTax: 950 })).toBe(950)
    expect(pickDailyRate({ averageDailyPriceExcludingTax: "800" })).toBe(800)
    expect(pickDailyRate({ averageDailyPriceExcludingTax: 0 })).toBeNull()
    expect(pickDailyRate({ averageDailyPriceExcludingTax: "" })).toBeNull()
    expect(pickDailyRate({ averageDailyPriceExcludingTax: "n/a" })).toBeNull()
    expect(pickDailyRate({})).toBeNull()
  })
  it("extractPerson transporte le TJM", () => {
    const p = extractPerson({
      id: "1",
      attributes: { firstName: "A", lastName: "B", title: "C", averageDailyPriceExcludingTax: 1100 },
    })
    expect(p.dailyRate).toBe(1100)
  })
})

describe("normalisation des titres Boond (relevé du tenant, 13/08/2026)", () => {
  it("échelons fins conservés BRUTS", () => {
    for (const t of ["SM 2", "M 1", "CS 2", "C", "Rookie"]) expect(normalizeTitle(t)).toBe(t)
  })
  it("indépendants et freelances → « Indép » (la sémantique du moteur en dépend)", () => {
    expect(normalizeTitle("Consultant Indépendant")).toBe("Indép")
    expect(normalizeTitle("Senior Program manager - Consultante indépendante")).toBe("Indép")
    expect(normalizeTitle("Senior Product Designer | UX | UXR | UI Designer Freelance")).toBe("Indép")
  })
  it("variantes siège réalignées sur les grades de l'app", () => {
    expect(normalizeTitle("Co-fondateur")).toBe("Fondateur")
    expect(normalizeTitle("Co-fondatrice")).toBe("Fondateur")
    expect(normalizeTitle("Chargée de mission auprès de la direction")).toBe(
      "Chargée de missions transverses"
    )
  })
  it("titre inconnu : brut, jamais inventé", () => {
    expect(normalizeTitle("Project Manager Credit Risk")).toBe("Project Manager Credit Risk")
  })
})
import { computeCroisement, kindFromTitle } from "@/lib/boond-sync"

describe("extraction Boond (pure)", () => {
  it("privilégie l'email @small-conseil.com parmi email1/2/3", () => {
    expect(
      pickEmail({ email1: "perso@gmail.com", email2: "Pro@Small-Conseil.com" })
    ).toBe("pro@small-conseil.com")
    expect(pickEmail({ email1: "perso@gmail.com" })).toBe("perso@gmail.com")
    expect(pickEmail({})).toBeNull()
  })

  it("normalise les dates Boond (ISO court, ISO long, vide)", () => {
    expect(normDate("2026-01-12")).toBe("2026-01-12")
    expect(normDate("2026-01-12T08:30:00+0100")).toBe("2026-01-12")
    expect(normDate("")).toBeNull()
    expect(normDate(0)).toBeNull()
    expect(normDate("12/01/2026")).toBeNull()
  })

  it("extrait une personne complète (titre brut, état, manager)", () => {
    const p = extractPerson({
      id: "42",
      attributes: {
        firstName: "Zoé",
        lastName: "MARQUOIN",
        email1: "zoe.marquoin@small-conseil.com",
        title: "SM 1",
        state: 3,
        typeOf: 0,
        startDate: "2025-09-01",
      },
      relationships: { mainManager: { data: { id: 7 } } },
    })
    expect(p).toMatchObject({
      boondId: "42",
      name: "Zoé MARQUOIN",
      email: "zoe.marquoin@small-conseil.com",
      title: "SM 1",
      state: "3",
      arrival: "2025-09-01",
      departure: null,
      managerBoondId: "7",
      excluded: false,
    })
  })
})

describe("kind déduit du titre brut", () => {
  it("grades consultants fins → CONSULTANT", () => {
    for (const t of ["SM 2", "M 1", "CS 2", "C", "Rookie", "Indép"]) {
      expect(kindFromTitle(t)).toEqual({ kind: "CONSULTANT", assumed: false })
    }
  })
  it("grades siège → SIEGE", () => {
    expect(kindFromTitle("Office Manager")).toEqual({ kind: "SIEGE", assumed: false })
    expect(kindFromTitle("Fondateur")).toEqual({ kind: "SIEGE", assumed: false })
  })
  it("titre inconnu → CONSULTANT supposé (signalé)", () => {
    expect(kindFromTitle("CJ")).toEqual({ kind: "CONSULTANT", assumed: true })
  })
})

describe("croisement de contrôle Boond ↔ missions", () => {
  const TODAY = "2026-08-11"
  const people = (state: string | null, departure: string | null = null) => [
    { id: "p1", name: "Test UN", grade: "C", kind: "CONSULTANT", boondState: state, arrival: "2025-01-01", departure },
  ]
  const mission = [{ personId: "p1", client: "ACCOR", start: "2026-08-01", end: "2026-12-31" }]

  it("état 3 sans mission courante → écart", () => {
    const out = computeCroisement(people("3"), [], TODAY)
    expect(out).toHaveLength(1)
    expect(out[0].appStatus).toContain("aucune mission")
  })
  it("état 2 avec mission courante → écart", () => {
    const out = computeCroisement(people("2"), mission, TODAY)
    expect(out).toHaveLength(1)
    expect(out[0].appStatus).toContain("ACCOR")
  })
  it("état 3 avec mission, état 2 sans mission → aucun écart", () => {
    expect(computeCroisement(people("3"), mission, TODAY)).toHaveLength(0)
    expect(computeCroisement(people("2"), [], TODAY)).toHaveLength(0)
  })
  it("parti ou jamais synchronisé → ignoré", () => {
    expect(computeCroisement(people("3", "2026-06-30"), [], TODAY)).toHaveLength(0)
    expect(computeCroisement(people(null), [], TODAY)).toHaveLength(0)
  })
})
