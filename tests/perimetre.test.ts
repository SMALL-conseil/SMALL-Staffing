// Périmètres d'observation (s5) — droits et appartenance. Module pur : ces
// tests sont le contrat de sécurité de la feature (un consultant ne doit
// JAMAIS obtenir un périmètre qui n'est pas le sien, même en bricolant le
// cookie ou l'URL).
import { describe, expect, it } from "vitest"
import {
  AGENCE_PAR_DEFAUT,
  agenceEffective,
  agenceRenseignee,
  dansLePerimetre,
  perimetreParDefaut,
  perimetresAutorises,
  resoudrePerimetre,
} from "@/lib/perimetre"
import { Agency, Perimetre, Role } from "@/lib/types"

describe("agence effective (repli Paris)", () => {
  it("Bordeaux reste Bordeaux ; null, vide et inconnu retombent sur Paris", () => {
    expect(agenceEffective(Agency.BORDEAUX)).toBe(Agency.BORDEAUX)
    expect(agenceEffective(Agency.PARIS)).toBe(Agency.PARIS)
    expect(agenceEffective(null)).toBe(AGENCE_PAR_DEFAUT)
    expect(agenceEffective(undefined)).toBe(Agency.PARIS)
    expect(agenceEffective("LYON")).toBe(Agency.PARIS)
  })
  it("distingue « renseignée » de « repli » (pour les signalements)", () => {
    expect(agenceRenseignee(Agency.BORDEAUX)).toBe(true)
    expect(agenceRenseignee(null)).toBe(false)
    expect(agenceRenseignee("LYON")).toBe(false)
  })
})

describe("périmètres autorisés", () => {
  it("le siège voit les deux agences et le cabinet entier", () => {
    expect(perimetresAutorises(Role.SIEGE, null)).toEqual([
      Perimetre.PARIS,
      Perimetre.BORDEAUX,
      Perimetre.TOUT,
    ])
  })
  it("un consultant ne voit QUE son agence", () => {
    expect(perimetresAutorises(Role.CONSULTANT, Agency.BORDEAUX)).toEqual([Perimetre.BORDEAUX])
    expect(perimetresAutorises(Role.CONSULTANT, Agency.PARIS)).toEqual([Perimetre.PARIS])
  })
  it("un consultant non rattaché retombe sur Paris (jamais bloqué, jamais tout)", () => {
    expect(perimetresAutorises(Role.CONSULTANT, null)).toEqual([Perimetre.PARIS])
  })
})

describe("résolution du périmètre demandé", () => {
  it("le siège obtient ce qu'il demande, Paris par défaut", () => {
    expect(resoudrePerimetre(Perimetre.BORDEAUX, Role.SIEGE, null)).toBe(Perimetre.BORDEAUX)
    expect(resoudrePerimetre(Perimetre.TOUT, Role.SIEGE, null)).toBe(Perimetre.TOUT)
    expect(resoudrePerimetre(null, Role.SIEGE, null)).toBe(Perimetre.PARIS)
    expect(perimetreParDefaut(Role.SIEGE, null)).toBe(Perimetre.PARIS)
  })

  it("SÉCURITÉ : un consultant parisien ne peut PAS obtenir Bordeaux ni Tout SMALL", () => {
    expect(resoudrePerimetre(Perimetre.BORDEAUX, Role.CONSULTANT, Agency.PARIS)).toBe(Perimetre.PARIS)
    expect(resoudrePerimetre(Perimetre.TOUT, Role.CONSULTANT, Agency.PARIS)).toBe(Perimetre.PARIS)
    expect(resoudrePerimetre("tout", Role.CONSULTANT, Agency.PARIS)).toBe(Perimetre.PARIS)
  })

  it("SÉCURITÉ : un consultant bordelais ne peut PAS obtenir Paris ni Tout SMALL", () => {
    expect(resoudrePerimetre(Perimetre.PARIS, Role.CONSULTANT, Agency.BORDEAUX)).toBe(Perimetre.BORDEAUX)
    expect(resoudrePerimetre(Perimetre.TOUT, Role.CONSULTANT, Agency.BORDEAUX)).toBe(Perimetre.BORDEAUX)
  })

  it("valeurs fantaisistes ou vides → défaut, sans erreur", () => {
    expect(resoudrePerimetre("", Role.SIEGE, null)).toBe(Perimetre.PARIS)
    expect(resoudrePerimetre("LYON", Role.SIEGE, null)).toBe(Perimetre.PARIS)
    expect(resoudrePerimetre(undefined, Role.CONSULTANT, Agency.BORDEAUX)).toBe(Perimetre.BORDEAUX)
  })

  it("la casse du périmètre demandé est tolérée (lien recopié à la main)", () => {
    expect(resoudrePerimetre("bordeaux", Role.SIEGE, null)).toBe(Perimetre.BORDEAUX)
  })
})

describe("appartenance au périmètre", () => {
  it("Tout SMALL prend tout le monde, agence non renseignée comprise", () => {
    for (const a of [Agency.PARIS, Agency.BORDEAUX, null, "LYON"]) {
      expect(dansLePerimetre(a, Perimetre.TOUT)).toBe(true)
    }
  })
  it("Paris prend les parisiens ET les non rattachés (repli)", () => {
    expect(dansLePerimetre(Agency.PARIS, Perimetre.PARIS)).toBe(true)
    expect(dansLePerimetre(null, Perimetre.PARIS)).toBe(true)
    expect(dansLePerimetre(Agency.BORDEAUX, Perimetre.PARIS)).toBe(false)
  })
  it("Bordeaux ne prend QUE les bordelais explicites", () => {
    expect(dansLePerimetre(Agency.BORDEAUX, Perimetre.BORDEAUX)).toBe(true)
    expect(dansLePerimetre(null, Perimetre.BORDEAUX)).toBe(false)
    expect(dansLePerimetre(Agency.PARIS, Perimetre.BORDEAUX)).toBe(false)
  })
})
