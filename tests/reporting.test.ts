import { describe, expect, it } from "vitest"
import {
  caParClient,
  caParClientReel,
  consultantsParClient,
  moisDeMission,
  replierAutres,
  type ReportingJour,
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

describe("CA réel par client (a12 — jours CRA × honoraires)", () => {
  const j = (over: Partial<ReportingJour>): ReportingJour => ({
    personId: "p1",
    date: "2026-03-10",
    duration: 1,
    clientName: null,
    ...over,
  })

  it("année en cours : mois écoulés au réel, mois courant à la convention", () => {
    // TODAY = 2026-08-11 → réel janv–juil, convention pour août seul.
    const missions = [m({ client: "GROUPAMA", fees: 1000 })]
    const jours = [
      j({ date: "2026-03-10" }),
      j({ date: "2026-03-11", duration: 0.5 }),
      j({ date: "2026-08-03" }), // mois courant → IGNORÉ au réel (convention)
    ]
    const out = caParClientReel(missions, jours, 2026, TODAY)
    expect(out.caReel).toBeCloseTo(1.5 * 1000, 5)
    expect(out.caConvention).toBeCloseTo(1000 * 1 * (218 / 12), 5) // août seul
    expect(out.total).toBeCloseTo(out.caReel + out.caConvention, 5)
    expect(out.moisReelMax).toBe(7)
    expect(out.entries).toHaveLength(1)
    expect(out.entries[0].ca).toBeCloseTo(out.total, 5)
  })

  it("départage multi-missions par le client Boond, sinon 1re mission (rank)", () => {
    const missions = [
      m({ client: "GROUPAMA", fees: 1000 }), // 1re par rank
      m({ client: "ACCOR", fees: 2000 }),
    ]
    const jours = [
      j({ date: "2026-04-01", clientName: "Accor" }), // match insensible casse/accents
      j({ date: "2026-04-02" }), // pas de client Boond → 1re mission
    ]
    const out = caParClientReel(missions, jours, 2026, TODAY)
    expect(out.entries.find((e) => e.client === "ACCOR")?.ca).toBeCloseTo(
      2000 * 1 + 2000 * 1 * (218 / 12), 5 // 1 jour réel + convention août
    )
    expect(out.entries.find((e) => e.client === "GROUPAMA")?.ca).toBeCloseTo(
      1000 * 1 + 1000 * 1 * (218 / 12), 5
    )
  })

  it("jour sans mission couvrante → compté « sans mission » ; mission sans fees → signalée", () => {
    const missions = [m({ client: "FDJ", fees: null, start: "2026-01-01", end: "2026-06-30" })]
    const jours = [
      j({ date: "2026-02-02" }), // mission FDJ sans fees
      j({ date: "2026-07-15", duration: 0.5 }), // aucune mission ne couvre
    ]
    const out = caParClientReel(missions, jours, 2026, TODAY)
    expect(out.caReel).toBe(0)
    expect(out.sansHonoraires).toEqual([{ client: "FDJ", missions: 1 }])
    expect(out.joursSansMission).toBe(0.5)
  })

  it("année passée : entièrement réelle (aucune convention)", () => {
    const missions = [m({ client: "CNP", fees: 900, start: "2025-01-01", end: "2025-12-31" })]
    const jours = [j({ date: "2025-11-03" }), j({ date: "2025-12-01" })]
    const out = caParClientReel(missions, jours, 2025, TODAY)
    expect(out.caReel).toBeCloseTo(2 * 900, 5)
    expect(out.caConvention).toBe(0)
    expect(out.moisReelMax).toBe(12)
  })

  it("année future : entièrement conventionnelle (identique à caParClient)", () => {
    const missions = [m({ client: "SUEZ", fees: 1200, start: "2027-01-01", end: "2027-03-31" })]
    const out = caParClientReel(missions, [], 2027, TODAY)
    const conv = caParClient(missions, 2027, TODAY)
    expect(out.moisReelMax).toBe(0)
    expect(out.total).toBeCloseTo(conv.total, 5)
    expect(out.entries).toEqual(conv.entries)
  })
})

describe("cascade des taux (a17) : fees mission > TJM fiche > exclu", () => {
  const j = (over: Partial<ReportingJour>): ReportingJour => ({
    personId: "p1", date: "2026-03-10", duration: 1, clientName: null, ...over,
  })

  it("convention : le TJM fiche prend le relais quand fees est vide, fees reste prioritaire", () => {
    const out = caParClient(
      [
        m({ client: "GROUPAMA", fees: null, defaultRate: 950 }), // repli fiche
        m({ client: "ACCOR", fees: 800, defaultRate: 1200 }), // fees prioritaire
        m({ client: "FDJ", fees: null, defaultRate: null }), // aucun taux → exclue
      ],
      2026,
      TODAY
    )
    const groupama = out.entries.find((e) => e.client === "GROUPAMA")!
    expect(groupama.ca).toBeCloseTo(950 * 8 * (218 / 12), 5)
    const accor = out.entries.find((e) => e.client === "ACCOR")!
    expect(accor.ca).toBeCloseTo(800 * 8 * (218 / 12), 5)
    expect(out.sansHonoraires).toEqual([{ client: "FDJ", missions: 1 }])
  })

  it("réel : jours × TJM fiche quand fees est vide", () => {
    const out = caParClientReel(
      [m({ client: "GROUPAMA", fees: null, defaultRate: 950 })],
      [j({ date: "2026-03-10" }), j({ date: "2026-04-01", duration: 0.5 })],
      2026,
      TODAY
    )
    expect(out.caReel).toBeCloseTo(1.5 * 950, 5)
    expect(out.sansHonoraires).toEqual([])
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
