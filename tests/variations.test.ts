import { describe, expect, it } from "vitest"
import { variationEtp, variationTaux } from "@/lib/staffing-ui"

describe("variation d'un taux (points de pourcentage)", () => {
  it("hausse = bon sens (vert)", () => {
    const v = variationTaux(0.874, 0.821)
    expect(v.texte).toBe("+5,3 pts")
    expect(v.tendance).toBe("hausse")
    expect(v.bonSens).toBe(true)
  })
  it("baisse = mauvais sens (rouge)", () => {
    const v = variationTaux(0.76, 0.874)
    expect(v.texte).toBe("−11,4 pts")
    expect(v.tendance).toBe("baisse")
    expect(v.bonSens).toBe(false)
  })
  it("quasi-stable → neutre", () => {
    expect(variationTaux(0.8501, 0.85).tendance).toBe("stable")
  })
  it("référence nulle → non calculable", () => {
    expect(variationTaux(0.85, 0).texte).toBeNull()
  })
})

describe("variation d'un ETP (relative en %)", () => {
  it("hausse d'effectif = bon sens", () => {
    const v = variationEtp(33, 30.5)
    expect(v.texte).toBe("+8,2 %")
    expect(v.bonSens).toBe(true)
  })
  it("baisse d'effectif = mauvais sens", () => {
    const v = variationEtp(29, 33)
    expect(v.tendance).toBe("baisse")
    expect(v.bonSens).toBe(false)
  })
  it("référence nulle → non calculable", () => {
    expect(variationEtp(33, 0).texte).toBeNull()
  })
})
