import { describe, expect, it } from "vitest"
import { parseShare, validateAbsence, validateMission } from "@/lib/staffing-admin"

describe("parseShare", () => {
  it("accepte 1, 0.8 et la virgule française 0,8", () => {
    expect(parseShare("1")).toBe(1)
    expect(parseShare("0.8")).toBe(0.8)
    expect(parseShare("0,8")).toBe(0.8)
    expect(parseShare(0.5)).toBe(0.5)
  })
  it("rejette 0, les négatifs, > 1 et le non-numérique", () => {
    expect(parseShare("0")).toBeNull()
    expect(parseShare("-0.2")).toBeNull()
    expect(parseShare("1.2")).toBeNull()
    expect(parseShare("plein temps")).toBeNull()
  })
})

describe("validateMission", () => {
  const base = {
    personId: "p1",
    client: " ACCOR ",
    startDate: "2026-01-05",
    endDate: "2026-06-30",
    share: "0,8",
    note: "",
  }
  it("normalise une saisie valide (trim client, virgule, note vide → null)", () => {
    const r = validateMission(base)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.client).toBe("ACCOR")
      expect(r.value.share).toBe(0.8)
      expect(r.value.note).toBeNull()
      expect(r.value.startDate.toISOString()).toBe("2026-01-05T00:00:00.000Z")
    }
  })
  it("refuse début après fin", () => {
    const r = validateMission({ ...base, startDate: "2026-07-01" })
    expect(r.ok).toBe(false)
  })
  it("refuse client vide et date invalide", () => {
    expect(validateMission({ ...base, client: "  " }).ok).toBe(false)
    expect(validateMission({ ...base, endDate: "30/06/2026" }).ok).toBe(false)
  })
})

describe("validateAbsence", () => {
  it("accepte une absence ouverte (fin vide)", () => {
    const r = validateAbsence({ personId: "p1", startDate: "2026-10-05", endDate: "", label: "maternité" })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.endDate).toBeNull()
  })
  it("refuse fin avant début", () => {
    expect(
      validateAbsence({ personId: "p1", startDate: "2026-10-05", endDate: "2026-01-01" }).ok
    ).toBe(false)
  })
})
