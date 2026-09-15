import { describe, expect, it } from "vitest"
import {
  natureEcart,
  chaineDe,
  ficheAuJour,
  lendemainDe,
  planifieTransfert,
  veilleDe,
  type FicheChainon,
} from "@/lib/mobilite"

// Cas réel du 15/09/2026 : Charlotte, Paris du 21/08/2023, transférée à
// Bordeaux le 15/11/2025 (l'Excel « Staffing SMALL Paris » avait enregistré un
// départ le 14/11 — c'était la veille du transfert).
const PARIS: FicheChainon = {
  id: "paris",
  boondId: null,
  previousId: null,
  arrival: "2023-08-21",
  departure: "2025-11-14",
}
const BORDEAUX: FicheChainon = {
  id: "bordeaux",
  boondId: "24",
  previousId: "paris",
  arrival: "2025-11-15",
  departure: null,
}
const CHAINE = [PARIS, BORDEAUX]

describe("veilleDe / lendemainDe", () => {
  it("passent les bornes de mois, d'année et de février bissextile", () => {
    expect(veilleDe("2025-11-15")).toBe("2025-11-14")
    expect(veilleDe("2026-01-01")).toBe("2025-12-31")
    expect(lendemainDe("2025-11-14")).toBe("2025-11-15")
    expect(lendemainDe("2024-02-28")).toBe("2024-02-29")
    expect(lendemainDe("2026-12-31")).toBe("2027-01-01")
  })
})

describe("chaineDe", () => {
  it("remonte la chaîne depuis la fiche en cours", () => {
    expect(chaineDe(CHAINE, "bordeaux").map((f) => f.id)).toEqual(["bordeaux", "paris"])
    expect(chaineDe(CHAINE, "paris").map((f) => f.id)).toEqual(["paris"])
  })
  it("ne boucle pas si les fiches se pointent l'une l'autre", () => {
    const a = { ...PARIS, previousId: "bordeaux" }
    expect(chaineDe([a, BORDEAUX], "bordeaux").map((f) => f.id)).toEqual(["bordeaux", "paris"])
  })
})

describe("ficheAuJour — le jour de CRA va à la BONNE période", () => {
  it("un jour d'avant le transfert reste à Paris, un jour d'après va à Bordeaux", () => {
    // Le flux Boond ne connaît que le boondId de la fiche EN COURS : sans la
    // chaîne, TOUT l'historique tomberait dans Bordeaux.
    expect(ficheAuJour(CHAINE, "24", "2024-03-12")).toBe("paris")
    expect(ficheAuJour(CHAINE, "24", "2025-11-14")).toBe("paris")
    expect(ficheAuJour(CHAINE, "24", "2025-11-15")).toBe("bordeaux")
    expect(ficheAuJour(CHAINE, "24", "2026-08-31")).toBe("bordeaux")
  })
  it("sans chaîne, le comportement d'avant s7 est inchangé", () => {
    const seule: FicheChainon[] = [{ ...BORDEAUX, previousId: null }]
    expect(ficheAuJour(seule, "24", "2024-03-12")).toBe("bordeaux")
  })
  it("aucun jour n'est perdu : antérieur à toute la chaîne → fiche porteuse", () => {
    expect(ficheAuJour(CHAINE, "24", "2019-01-07")).toBe("bordeaux")
  })
  it("boondId inconnu → null (la ligne sera comptée « sans personne »)", () => {
    expect(ficheAuJour(CHAINE, "999", "2026-01-05")).toBeNull()
  })
  it("date illisible → fiche porteuse, jamais une exception", () => {
    expect(ficheAuJour(CHAINE, "24", "12/03/2024")).toBe("bordeaux")
  })
})

describe("planifieTransfert — deux périodes JOINTIVES", () => {
  it("clôt la veille et ouvre le jour même : ni trou ni recouvrement", () => {
    const plan = planifieTransfert({
      arrival: "2023-08-21",
      departure: "2025-11-14",
      dateTransfert: "2025-11-15",
      agenceAvant: "PARIS",
      agenceApres: "BORDEAUX",
    })
    expect(plan.historique).toEqual({ arrival: "2023-08-21", departure: "2025-11-14", agency: "PARIS" })
    expect(plan.courante).toEqual({ arrival: "2025-11-15", departure: null, agency: "BORDEAUX" })
    expect(lendemainDe(plan.historique.departure)).toBe(plan.courante.arrival)
  })
  it("fonctionne sur une fiche encore ouverte (transfert saisi à la main)", () => {
    const plan = planifieTransfert({
      arrival: "2024-01-08",
      departure: null,
      dateTransfert: "2026-09-01",
      agenceAvant: "PARIS",
      agenceApres: "BORDEAUX",
    })
    expect(plan.historique.departure).toBe("2026-08-31")
  })
  it("refuse ce qui n'est pas un transfert", () => {
    const base = { arrival: "2023-08-21", departure: null, agenceAvant: "PARIS", agenceApres: "BORDEAUX" }
    // Même agence des deux côtés
    expect(() => planifieTransfert({ ...base, agenceApres: "PARIS", dateTransfert: "2025-11-15" })).toThrow(/sans changement/)
    // Transfert antérieur à l'arrivée : ce serait une correction d'agence
    expect(() => planifieTransfert({ ...base, dateTransfert: "2023-08-21" })).toThrow(/POSTÉRIEUR/)
    // Départ postérieur au transfert : départ réel ou transfert ? on ne devine pas
    expect(() =>
      planifieTransfert({ ...base, departure: "2026-06-30", dateTransfert: "2025-11-15" })
    ).toThrow(/à trancher/)
    expect(() => planifieTransfert({ ...base, dateTransfert: "15/11/2025" })).toThrow(/invalide/)
  })
})

describe("natureEcart (a29) — transfert ou départ réel ?", () => {
  // Remarque de Sacha, 15/09 : trois candidats, mais Mélanie GOUY est
  // simplement partie — Boond la laisse en agence « SMALL » (Paris), comme sa
  // période. L'envoyer à Bordeaux fabriquerait une présence qui n'a jamais été.
  it("Boond dans une AUTRE agence → transfert (Charlotte, Anaïs)", () => {
    expect(natureEcart("BORDEAUX", "PARIS")).toBe("TRANSFERT")
    expect(natureEcart("PARIS", "BORDEAUX")).toBe("TRANSFERT")
  })
  it("Boond dans la MÊME agence → départ réel, fiche Boond restée ouverte (Mélanie)", () => {
    expect(natureEcart("PARIS", "PARIS")).toBe("DEPART_NON_CLOS")
    expect(natureEcart("BORDEAUX", "BORDEAUX")).toBe("DEPART_NON_CLOS")
  })
  it("agence vide = « SMALL » sans ville = Paris par défaut → départ réel", () => {
    // Le cas exact de Mélanie : le tenant ne dit pas la ville de l'agence
    // parisienne, la colonne reste nulle — ce n'est pas un changement d'agence.
    expect(natureEcart(null, "PARIS")).toBe("DEPART_NON_CLOS")
    expect(natureEcart(undefined, "PARIS")).toBe("DEPART_NON_CLOS")
    expect(natureEcart(null, "BORDEAUX")).toBe("TRANSFERT")
  })
})
