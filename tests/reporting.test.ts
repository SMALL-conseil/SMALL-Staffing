import { describe, expect, it } from "vitest"
import {
  caParClient,
  consultantsParClient,
  moisDeMission,
  replierAutres,
  type ReportingMission,
} from "@/lib/reporting"

const TODAY = "2026-08-11"

const m = (over: Partial<ReportingMission>): ReportingMission => ({
  personId: "p1",
  client: "ACCOR",
  start: "2026-01-01",
  end: "2026-12-31",
  fees: null,
  ...over,
})

describe("consultants par client (aujourd'hui)", () => {
  it("compte les personnes distinctes en mission ce jour, tri décroissant", () => {
    const out = consultantsParClient(
      [
        m({ personId: "a", client: "GROUPAMA" }),
        m({ personId: "b", client: "GROUPAMA" }),
        m({ personId: "b", client: "GROUPAMA", start: "2026-08-01", end: "2026-08-31" }), // même personne, 2 missions
        m({ personId: "c", client: "ACCOR" }),
        m({ personId: "d", client: "FDJ", start: "2026-09-01", end: "2026-12-31" }), // pas encore commencée
      ],
      TODAY
    )
    expect(out).toEqual([
      { client: "GROUPAMA", consultants: 2 },
      { client: "ACCOR", consultants: 1 },
    ])
  })
})

describe("mois de mission sur l'année", () => {
  it("compte les mois calendaires chevauchés, bornés au mois courant l'année en cours", () => {
    expect(moisDeMission({ start: "2026-01-15", end: "2026-03-02" }, 2026, TODAY)).toBe(3)
    expect(moisDeMission({ start: "2026-01-01", end: "2026-12-31" }, 2026, TODAY)).toBe(8) // arrêté à août
    expect(moisDeMission({ start: "2025-05-10", end: "2025-06-05" }, 2025, TODAY)).toBe(2) // année passée : pas de borne
    expect(moisDeMission({ start: "2027-02-01", end: "2027-02-28" }, 2026, TODAY)).toBe(0)
  })
})

describe("CA par client (convention 218 j/an)", () => {
  it("applique honoraires × mois × 218/12 et agrège par client", () => {
    const out = caParClient(
      [
        m({ client: "GROUPAMA", fees: 1000, start: "2026-01-01", end: "2026-03-31" }), // 3 mois
        m({ client: "GROUPAMA", fees: 500, start: "2026-06-01", end: "2026-06-30" }), // 1 mois
        m({ client: "ACCOR", fees: 2000, start: "2026-07-01", end: "2026-12-31" }), // 2 mois (juil, août)
      ],
      2026,
      TODAY
    )
    const groupama = out.entries.find((e) => e.client === "GROUPAMA")!
    expect(groupama.ca).toBeCloseTo(1000 * 3 * (218 / 12) + 500 * 1 * (218 / 12), 5)
    expect(groupama.moisFactures).toBe(4)
    const accor = out.entries.find((e) => e.client === "ACCOR")!
    expect(accor.ca).toBeCloseTo(2000 * 2 * (218 / 12), 5)
    expect(out.total).toBeCloseTo(groupama.ca + accor.ca, 5)
    expect(out.entries[0].client).toBe("ACCOR") // tri par CA décroissant
  })

  it("exclut et signale les missions sans honoraires", () => {
    const out = caParClient(
      [m({ client: "FDJ", fees: null }), m({ client: "FDJ", fees: null }), m({ client: "CNP", fees: 800 })],
      2026,
      TODAY
    )
    expect(out.entries.map((e) => e.client)).toEqual(["CNP"])
    expect(out.sansHonoraires).toEqual([{ client: "FDJ", missions: 2 }])
  })
})

describe("repli des petites parts", () => {
  it("au-delà de 8, replie le reste en « Autres »", () => {
    const slices = Array.from({ length: 11 }, (_, i) => ({ label: `C${i}`, value: 11 - i }))
    const out = replierAutres(slices)
    expect(out).toHaveLength(9)
    expect(out[8]).toEqual({ label: "Autres", value: 3 + 2 + 1 })
  })
  it("ne replie rien à 8 ou moins", () => {
    expect(replierAutres([{ label: "A", value: 1 }])).toHaveLength(1)
  })
})
