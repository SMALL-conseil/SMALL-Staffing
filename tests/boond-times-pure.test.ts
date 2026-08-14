// Extraction PURE des lignes /times — fixture calquée sur le relevé du
// 14/08/2026 (boond-inspect-times) : la personne arrive par timesReport →
// resource, le client par project → company, le tout dans `included`.
import { describe, expect, it } from "vitest"
import { extractTimeRows, type TimesResource } from "@/lib/boond-times"

const rel = (id: string | null, type: string) => ({ data: id === null ? null : { id, type } })

const ROWS: TimesResource[] = [
  {
    id: "regular_1",
    attributes: {
      category: "regular",
      workUnitType: { reference: 1, activityType: "production", name: "Mission" },
      row: 1,
      startDate: "2026-06-08",
      duration: 1,
    },
    relationships: {
      timesReport: rel("2", "timesreport"),
      batch: { data: null },
      delivery: rel("12", "delivery"),
      project: rel("12", "project"),
    },
  },
  {
    id: "absence_9",
    attributes: {
      category: "absence",
      workUnitType: { reference: 5, activityType: "absence", name: "Congés payés" },
      startDate: "2026-06-09",
      duration: 0.5,
    },
    relationships: { timesReport: rel("2", "timesreport"), project: { data: null } },
  },
  // Ligne orpheline : timesReport absent des included, pas de projet.
  {
    id: "regular_99",
    attributes: {
      category: "regular",
      workUnitType: { activityType: "production", name: "Mission" },
      startDate: "2026-06-10",
      duration: 1,
    },
    relationships: { timesReport: rel("777", "timesreport") },
  },
]

const INCLUDED: TimesResource[] = [
  { id: "1", type: "agency", attributes: { name: "SMALL" } },
  { id: "7", type: "resource", attributes: { firstName: "Matthieu", lastName: "Duval" } },
  {
    id: "2",
    type: "timesreport",
    attributes: { term: "2026-06", state: "validated", workUnitRate: 7 },
    relationships: { agency: rel("1", "agency"), resource: rel("7", "resource") },
  },
  { id: "12", type: "delivery", attributes: { title: "" } },
  { id: "6", type: "company", attributes: { name: "BYREDO" } },
  {
    id: "12",
    type: "project",
    attributes: { reference: "PMO Carve-Out" },
    relationships: { company: rel("6", "company") },
  },
]

describe("extractTimeRows", () => {
  it("résout personne (via timesReport), client (via project→company) et validation", () => {
    const [r] = extractTimeRows([ROWS[0]], INCLUDED)
    expect(r).toMatchObject({
      boondId: "regular_1",
      resourceBoondId: "7",
      date: "2026-06-08",
      duration: 1,
      category: "regular",
      activityType: "production",
      workUnit: "Mission",
      projectBoondId: "12",
      projectName: "PMO Carve-Out",
      clientName: "BYREDO",
      craState: "validated",
      craTerm: "2026-06",
    })
  })

  it("une absence garde son type et sa demi-journée, sans projet ni client", () => {
    const [r] = extractTimeRows([ROWS[1]], INCLUDED)
    expect(r).toMatchObject({
      boondId: "absence_9",
      resourceBoondId: "7",
      activityType: "absence",
      workUnit: "Congés payés",
      duration: 0.5,
      projectBoondId: null,
      clientName: null,
    })
  })

  it("une ligne au timesReport irrésolu reste extraite, ressource nulle", () => {
    const [r] = extractTimeRows([ROWS[2]], INCLUDED)
    expect(r.resourceBoondId).toBeNull()
    expect(r.date).toBe("2026-06-10")
  })
})
