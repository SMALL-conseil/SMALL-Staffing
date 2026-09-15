import { describe, expect, it } from "vitest"
import {
  memeClient,
  partProposee,
  partitionner,
  propositions,
  type PrestationSource,
} from "@/lib/missions-proposees"

// Prestations réelles relevées le 15/09 (scripts/boond-missions-possibles.ts).
const TEXEI: PrestationSource = {
  boondId: "138",
  personId: "p-clemence",
  client: "Texeï - Experts Salesforce",
  start: "2025-05-19",
  end: "2026-06-30",
  dailyRate: 790,
  daysSold: 250,
  workingDays: 218,
}
const ACCOR: PrestationSource = {
  boondId: "99",
  personId: "p-alice",
  client: "ACCOR",
  start: "2025-01-01",
  end: "2025-12-31",
  dailyRate: 775,
  daysSold: 220,
  workingDays: 218,
}

describe("partProposee — on ne devine pas un mi-temps sur une décimale", () => {
  it("jours vendus ≈ jours ouvrés → temps plein", () => {
    expect(partProposee(ACCOR).share).toBe(1)
    expect(partProposee(TEXEI).share).toBe(1)
  })
  it("écart franc → part arrondie au quart, jamais une décimale bizarre", () => {
    const miTemps = { ...ACCOR, daysSold: 110 } // 110 / ~260 ≈ 0,42
    expect(partProposee(miTemps).share).toBe(0.5)
    expect(partProposee(miTemps).motif).toContain("temps partiel")
    const quart = { ...ACCOR, daysSold: 60 } // 60 / ~260 ≈ 0,23
    expect(partProposee(quart).share).toBe(0.25)
  })
  it("jours vendus inconnus → 1, et le motif le dit", () => {
    const sans = { ...ACCOR, daysSold: null }
    expect(partProposee(sans)).toEqual({ share: 1, motif: "temps plein supposé (jours vendus inconnus)" })
  })
  it("jamais au-dessus de 1 ni en dessous de 0,25", () => {
    expect(partProposee({ ...ACCOR, daysSold: 900 }).share).toBe(1)
    expect(partProposee({ ...ACCOR, daysSold: 1 }).share).toBe(0.25)
  })
})

describe("memeClient — les libellés diffèrent des deux côtés", () => {
  it("rapproche les écritures d'un même client", () => {
    expect(memeClient("GROUPAMA", "Groupama")).toBe(true)
    expect(memeClient("FDJ", "FDJ - Française des jeux")).toBe(true)
    expect(memeClient("Texeï - Experts Salesforce", "TEXEI")).toBe(true)
    expect(memeClient("ACCOR", "Accor Hotels")).toBe(true)
  })
  it("ne rapproche pas deux clients différents", () => {
    expect(memeClient("GROUPAMA", "ACCOR")).toBe(false)
    expect(memeClient("SNCF", "SFR")).toBe(false)
  })
  it("une abréviation trop courte exige l'égalité stricte", () => {
    expect(memeClient("SG", "Société Générale")).toBe(false)
    expect(memeClient("SG", "S.G.")).toBe(true)
    expect(memeClient("", "ACCOR")).toBe(false)
  })
})

describe("propositions — ce que le registre ignore, et rien d'autre", () => {
  it("propose une prestation qu'aucune mission ne couvre", () => {
    const out = propositions([ACCOR], [])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      boondId: "99",
      personId: "p-alice",
      client: "ACCOR",
      start: "2025-01-01",
      end: "2025-12-31",
      fees: 775,
      share: 1,
    })
  })
  it("ne propose PAS ce qui existe déjà, même sous un autre libellé de client", () => {
    // Le registre écrit « GROUPAMA », Boond dit « Groupama » : c'est la même
    // mission. Un doublon fausserait les taux.
    const out = propositions(
      [{ ...ACCOR, client: "Accor Hotels" }],
      [{ personId: "p-alice", client: "ACCOR", start: "2025-01-01", end: "2025-12-31" }]
    )
    expect(out).toHaveLength(0)
  })
  it("un chevauchement chez le MÊME client suffit à considérer la mission saisie", () => {
    const out = propositions(
      [ACCOR],
      [{ personId: "p-alice", client: "ACCOR", start: "2025-11-01", end: "2026-04-30" }]
    )
    expect(out).toHaveLength(0)
  })
  it("mais deux missions PARALLÈLES chez deux clients restent proposées, avec le recouvrement signalé", () => {
    // Le temps partagé existe — c'est l'objet même de la part d'intervention.
    // Écarter la seconde au motif qu'elle chevauche la première la ferait
    // disparaître du registre.
    const out = propositions(
      [ACCOR],
      [{ personId: "p-alice", client: "GROUPAMA", start: "2025-01-01", end: "2025-12-31" }]
    )
    expect(out).toHaveLength(1)
    expect(out[0].chevauche).toBe("GROUPAMA (2025-01-01 → 2025-12-31)")
  })
  it("sans recouvrement, rien n'est signalé", () => {
    expect(propositions([ACCOR], [])[0].chevauche).toBeNull()
  })
  it("mais une mission ANTÉRIEURE sans chevauchement ne masque pas la nouvelle", () => {
    const out = propositions(
      [ACCOR],
      [{ personId: "p-alice", client: "ACCOR", start: "2023-01-01", end: "2023-12-31" }]
    )
    expect(out).toHaveLength(1)
  })
  it("la mission d'une AUTRE personne ne masque rien", () => {
    const out = propositions(
      [ACCOR],
      [{ personId: "p-quelquun-dautre", client: "ACCOR", start: "2025-01-01", end: "2025-12-31" }]
    )
    expect(out).toHaveLength(1)
  })
  it("écarte les prestations inexploitables plutôt que d'inventer", () => {
    const bancales: PrestationSource[] = [
      { ...ACCOR, personId: "" },
      { ...ACCOR, client: "" },
      { ...ACCOR, start: "" },
      { ...ACCOR, start: "2026-12-31", end: "2026-01-01" },
    ]
    expect(propositions(bancales, [])).toHaveLength(0)
  })
  it("les plus récentes d'abord — ce sont elles qui pèsent sur les chiffres du jour", () => {
    const out = propositions([ACCOR, TEXEI], [])
    expect(out.map((p) => p.boondId)).toEqual(["138", "99"])
  })
})

describe("partitionner (a35) — on ne propose pas ce que le registre couvre déjà", () => {
  // Décision du 15/09 : sur Paris, dont le registre est complet, une
  // prestation qui chevauche une mission existante n'est que du bruit — et un
  // bruit qui invite à créer un doublon. Elle est comptée, pas proposée.
  const base = propositions(
    [ACCOR, { ...TEXEI, personId: "p-alice", client: "TEXEI" }],
    [{ personId: "p-alice", client: "GROUPAMA", start: "2025-01-01", end: "2025-12-31" }]
  )
  it("sépare les propositions franches de celles qui chevauchent", () => {
    const { franches, chevauchantes } = partitionner(base)
    expect(franches.every((p) => p.chevauche === null)).toBe(true)
    expect(chevauchantes.every((p) => p.chevauche !== null)).toBe(true)
    expect(franches.length + chevauchantes.length).toBe(base.length)
  })
  it("aucune n'est perdue : ce qui n'est pas proposé reste comptable", () => {
    const { franches, chevauchantes } = partitionner(base)
    expect(chevauchantes.length).toBeGreaterThan(0)
    expect([...franches, ...chevauchantes].map((p) => p.boondId).sort()).toEqual(
      base.map((p) => p.boondId).sort()
    )
  })
})
