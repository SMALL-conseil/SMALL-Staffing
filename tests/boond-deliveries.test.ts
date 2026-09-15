// Extraction PURE des prestations Boond (s6) — fixture calquée sur le relevé
// du 15/09/2026 (/deliveries/12), coûts et marges COMPRIS dans la charge utile
// pour vérifier qu'ils ne ressortent JAMAIS.
import { describe, expect, it } from "vitest"
import { extractDelivery } from "@/lib/boond-deliveries"

const DATA = {
  id: "12",
  attributes: {
    creationDate: "2026-01-05T10:00:00+0100",
    startDate: "2026-01-05",
    endDate: "2026-12-31",
    title: "PMO Carve-Out",
    state: 0,
    typeOf: 1,
    forceAverageDailyPriceExcludingTax: true,
    averageDailyPriceExcludingTax: 1250,
    numberOfDaysInvoicedOrQuantity: 93,
    numberOfDaysFree: 0,
    numberOfWorkingDays: 218,
    // — à ne JAMAIS extraire (décision du 15/09) —
    averageDailyCost: 550.7706422312,
    averageDailyContractCost: 550.7706422312,
    costsSimulatedExcludingTax: 51221.6697275016,
    marginSimulatedExcludingTax: 65028.33,
    profitabilitySimulated: 0.56,
    turnoverSimulatedExcludingTax: 116250,
  },
  relationships: {
    project: { data: { id: "12", type: "project" } },
    contract: { data: null },
    // s8 — la ressource qui exécute la prestation, relevée le 15/09 : elle
    // arrive sous « dependsOn », pas sous « resource ».
    dependsOn: { data: { id: "31", type: "resource" } },
  },
}

describe("extractDelivery (s6)", () => {
  it("extrait le prix de vente, les jours vendus, les dates et le projet", () => {
    expect(extractDelivery("12", DATA)).toEqual({
      boondId: "12",
      title: "PMO Carve-Out",
      startDate: "2026-01-05",
      endDate: "2026-12-31",
      dailyRate: 1250,
      daysSold: 93,
      state: "0",
      typeOf: "1",
      projectBoondId: "12",
      resourceBoondId: "31",
      workingDays: 218,
    })
  })

  it("n'extrait AUCUN coût ni marge, même s'ils sont dans la charge utile", () => {
    const d = extractDelivery("12", DATA) as unknown as Record<string, unknown>
    for (const interdit of [
      "averageDailyCost",
      "averageDailyContractCost",
      "costsSimulatedExcludingTax",
      "marginSimulatedExcludingTax",
      "profitabilitySimulated",
    ]) {
      expect(d[interdit]).toBeUndefined()
    }
    // aucune valeur de coût ne doit s'être glissée ailleurs
    expect(Object.values(d)).not.toContain(550.7706422312)
    expect(Object.values(d)).not.toContain(51221.6697275016)
  })

  it("TJM ou jours absents / nuls → null (jamais 0, qui fausserait le CA)", () => {
    const vide = extractDelivery("99", {
      attributes: { averageDailyPriceExcludingTax: 0, numberOfDaysInvoicedOrQuantity: null },
    })
    expect(vide.dailyRate).toBeNull()
    expect(vide.daysSold).toBeNull()
    expect(vide.projectBoondId).toBeNull()
    expect(vide.title).toBeNull()
  })

  it("charge utile absente → prestation vide, sans exception", () => {
    const d = extractDelivery("77", undefined)
    expect(d).toMatchObject({ boondId: "77", dailyRate: null, daysSold: null })
  })
})
