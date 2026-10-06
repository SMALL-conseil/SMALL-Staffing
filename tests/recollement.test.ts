// Plan de recollement classeur → app (lib/recollement.ts). Les cas sont ceux
// relevés sur le terrain le 06/10/2026 (octobre 2026, périmètre Paris) :
// une absence jamais saisie, une absence qui commence trop tard, un Indép
// absent du registre, un changement de nom, une agence vide.
import { describe, expect, it } from "vitest"
import {
  categorieDe,
  libelleAction,
  planRecollement,
  type Action,
  type ConsultantClasseur,
  type FicheApp,
  type MissionApp,
  type MissionClasseur,
} from "@/lib/recollement"
import { cleNom } from "@/lib/excel-registres"

const opts = { cle: cleNom, agence: "PARIS" as string | null }

function plan(
  classeur: { consultants?: ConsultantClasseur[]; missions?: MissionClasseur[] },
  app: { fiches?: FicheApp[]; missions?: MissionApp[] },
  o: Partial<typeof opts> & {
    exclus?: string[]
    horsPerimetre?: { nom: string; agence: string | null }[]
    absencesConfirmees?: string[]
  } = {}
) {
  return planRecollement(
    { consultants: classeur.consultants ?? [], missions: classeur.missions ?? [] },
    { fiches: app.fiches ?? [], missions: app.missions ?? [] },
    { ...opts, ...o }
  )
}

const consultant = (p: Partial<ConsultantClasseur> = {}): ConsultantClasseur => ({
  nom: "Danny GAURAT",
  grade: "M 1",
  arrival: "2024-01-08",
  departure: null,
  absence: null,
  ...p,
})

const fiche = (p: Partial<FicheApp> = {}): FicheApp => ({
  id: "f1",
  nom: "Danny GAURAT",
  grade: "M 1",
  arrival: "2024-01-08",
  departure: null,
  agency: "PARIS",
  absences: [],
  ...p,
})

const types = (actions: Action[]) => actions.map((a) => a.type)

describe("absences — une proposition, jamais une évidence", () => {
  // Une fenêtre du classeur peut décrire une vraie absence ou cacher un
  // intercontrat : l'une sort la personne du dénominateur et fait MONTER le
  // taux, l'autre l'y laisse et le fait baisser. Rien dans le fichier ne les
  // distingue — donc rien ne s'écrit sans confirmation nommée.
  it("absence au classeur inconnue de l'app → proposition, AUCUNE action", () => {
    const { actions, absencesAConfirmer } = plan(
      { consultants: [consultant({ absence: { start: "2026-10-12", end: "2026-11-12" } })] },
      { fiches: [fiche()] }
    )
    expect(actions).toHaveLength(0)
    expect(absencesAConfirmer).toEqual([
      {
        nom: "Danny GAURAT",
        personId: "f1",
        absenceId: null,
        avant: null,
        apres: { start: "2026-10-12", end: "2026-11-12" },
      },
    ])
  })

  it("… et une action dès qu'un humain l'a confirmée nommément", () => {
    const { actions, absencesAConfirmer } = plan(
      { consultants: [consultant({ absence: { start: "2026-10-12", end: "2026-11-12" } })] },
      { fiches: [fiche()] },
      { absencesConfirmees: ["Danny GAURAT"] }
    )
    expect(absencesAConfirmer).toHaveLength(0)
    expect(actions[0]).toMatchObject({ type: "ABSENCE_AJOUT", personId: "f1" })
    expect(categorieDe(actions[0])).toBe("absences")
  })

  it("une confirmation ne vaut que pour la personne nommée", () => {
    const { actions, absencesAConfirmer } = plan(
      {
        consultants: [
          consultant({ nom: "Danny GAURAT", absence: { start: "2026-10-12", end: "2026-11-12" } }),
          consultant({ nom: "Julie BICHON", absence: { start: "2026-10-09", end: "2027-02-28" } }),
        ],
      },
      {
        fiches: [
          fiche({ id: "f1", nom: "Danny GAURAT" }),
          fiche({ id: "f2", nom: "Julie BICHON", absences: [{ id: "a2", start: "2026-10-18", end: "2027-02-28" }] }),
        ],
      },
      { absencesConfirmees: ["Julie BICHON"] }
    )
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({ type: "ABSENCE_MAJ", nom: "Julie BICHON" })
    expect(absencesAConfirmer.map((p) => p.nom)).toEqual(["Danny GAURAT"])
  })

  it("même absence, début différent → correction une fois confirmée (cas Julie Bichon)", () => {
    const { actions } = plan(
      { consultants: [consultant({ absence: { start: "2026-10-09", end: "2027-02-28" } })] },
      { fiches: [fiche({ absences: [{ id: "a1", start: "2026-10-18", end: "2027-02-28" }] })] },
      { absencesConfirmees: ["Danny GAURAT"] }
    )
    expect(actions).toEqual([
      {
        type: "ABSENCE_MAJ",
        nom: "Danny GAURAT",
        absenceId: "a1",
        avant: { start: "2026-10-18", end: "2027-02-28" },
        apres: { start: "2026-10-09", end: "2027-02-28" },
      },
    ])
  })

  it("fin d'absence différente → correction une fois confirmée (cas Clémence Buysse)", () => {
    const { actions } = plan(
      { consultants: [consultant({ absence: { start: "2026-06-07", end: "2027-02-28" } })] },
      { fiches: [fiche({ absences: [{ id: "a1", start: "2026-06-07", end: "2026-12-31" }] })] },
      { absencesConfirmees: ["Danny GAURAT"] }
    )
    expect(types(actions)).toEqual(["ABSENCE_MAJ"])
  })

  it("absence identique → rien à faire (idempotence)", () => {
    const { actions, signalements, absencesAConfirmer } = plan(
      { consultants: [consultant({ absence: { start: "2026-10-12", end: null } })] },
      { fiches: [fiche({ absences: [{ id: "a1", start: "2026-10-12", end: null }] })] }
    )
    expect(actions).toHaveLength(0)
    expect(signalements).toHaveLength(0)
    expect(absencesAConfirmer).toHaveLength(0)
  })

  it("absence connue de l'app seule → signalée, JAMAIS supprimée", () => {
    const { actions, signalements } = plan(
      { consultants: [consultant()] },
      { fiches: [fiche({ absences: [{ id: "a1", start: "2026-03-01", end: null }] })] }
    )
    expect(actions).toHaveLength(0)
    expect(signalements[0].quoi).toMatch(/app seule/)
  })

  it("plusieurs absences dans l'app → signalement, aucune devinette", () => {
    const { actions, signalements } = plan(
      { consultants: [consultant({ absence: { start: "2026-10-12", end: "2026-11-12" } })] },
      {
        fiches: [
          fiche({
            absences: [
              { id: "a1", start: "2026-01-05", end: "2026-02-05" },
              { id: "a2", start: "2026-10-18", end: "2026-11-12" },
            ],
          }),
        ],
      }
    )
    expect(actions).toHaveLength(0)
    expect(signalements[0].quoi).toMatch(/plusieurs absences/)
  })
})

describe("grade, arrivée, départ — l'app (Boond) fait foi", () => {
  it("un classeur en retard est signalé, jamais appliqué", () => {
    const { actions, signalements } = plan(
      { consultants: [consultant({ grade: "CS 2", arrival: "2024-01-01", departure: "2026-09-30" })] },
      { fiches: [fiche({ grade: "CS 1" })] }
    )
    expect(actions).toHaveLength(0)
    expect(signalements[0].detail).toContain("grade CS 2 → CS 1")
    expect(signalements[0].detail).toContain("arrivée")
    expect(signalements[0].detail).toContain("départ 2026-09-30 → —")
  })
})

describe("agence", () => {
  it("agence vide + présence au classeur du périmètre → renseignée (cas Thessa)", () => {
    const { actions } = plan(
      { consultants: [consultant({ nom: "Thessa LOPES", grade: "CS 2" })] },
      { fiches: [fiche({ nom: "Thessa Franco", grade: "CS 2", agency: null })] }
    )
    expect(actions).toEqual([{ type: "AGENCE", nom: "Thessa Franco", personId: "f1", agence: "PARIS" }])
  })

  it("agence AUTRE que le périmètre → signalement (jamais réécrite d'office)", () => {
    const { actions, signalements } = plan(
      { consultants: [consultant()] },
      { fiches: [fiche({ agency: "BORDEAUX" })] }
    )
    expect(actions).toHaveLength(0)
    expect(signalements[0].quoi).toMatch(/agence différente/)
  })

  it("périmètre TOUT (agence null en option) → aucune action d'agence", () => {
    const { actions } = plan(
      { consultants: [consultant()] },
      { fiches: [fiche({ agency: null })] },
      { agence: null }
    )
    expect(actions).toHaveLength(0)
  })
})

describe("personnes et missions manquantes", () => {
  it("Indép au classeur, absente de l'app → fiche créée avec son agence et sa mission (cas Emeline DICHAM)", () => {
    const { actions } = plan(
      {
        consultants: [
          consultant({ nom: "Emeline DICHAM", grade: "Indép", arrival: "2026-10-09", departure: "2026-12-11" }),
        ],
        missions: [
          { nom: "Emeline DICHAM", client: "ACCOR", start: "2026-10-09", end: "2026-12-11", share: 1 },
        ],
      },
      { fiches: [] }
    )
    expect(types(actions)).toEqual(["PERSONNE_CREE", "MISSION_CREE"])
    expect(actions[0]).toMatchObject({ grade: "Indép", agence: "PARIS", departure: "2026-12-11" })
    // Le titulaire n'existe pas encore : au script de relier après création.
    expect(actions[1]).toMatchObject({ personId: null, client: "ACCOR" })
    expect(libelleAction(actions[0])).toContain("CRÉER la fiche")
  })

  it("un nom exclu (correction assumée) est ignoré, missions comprises", () => {
    const { actions, signalements } = plan(
      {
        consultants: [consultant({ nom: "Elvire HOUDEVILLE", grade: "C" })],
        missions: [{ nom: "Elvire HOUDEVILLE", client: "BPI", start: "2026-01-01", end: "2026-12-31", share: 1 }],
      },
      { fiches: [] },
      { exclus: ["Elvire HOUDEVILLE"] }
    )
    expect(actions).toHaveLength(0)
    expect(signalements).toHaveLength(0)
  })

  it("mission identique → rien ; même client avec d'autres dates → AJUSTÉE, pas dupliquée", () => {
    const base = {
      consultants: [consultant()],
      missions: [{ nom: "Danny GAURAT", client: "GROUPAMA", start: "2026-08-01", end: "2026-12-31", share: 1 }],
    }
    const identique = plan(base, {
      fiches: [fiche()],
      missions: [
        { id: "m1", personId: "f1", client: "GROUPAMA", start: "2026-08-01", end: "2026-12-31", share: 1 },
      ],
    })
    expect(identique.actions).toHaveLength(0)

    const prolongee = plan(base, {
      fiches: [fiche()],
      missions: [
        { id: "m1", personId: "f1", client: "GROUPAMA", start: "2026-08-01", end: "2026-10-31", share: 0.8 },
      ],
    })
    expect(prolongee.actions).toEqual([
      {
        type: "MISSION_MAJ",
        nom: "Danny GAURAT",
        missionId: "m1",
        client: "GROUPAMA",
        avant: { start: "2026-08-01", end: "2026-10-31", share: 0.8 },
        apres: { start: "2026-08-01", end: "2026-12-31", share: 1 },
      },
    ])
    expect(categorieDe(prolongee.actions[0])).toBe("missions")
  })

  it("deux missions parallèles chez des clients différents ne se confondent pas", () => {
    const { actions } = plan(
      {
        consultants: [consultant()],
        missions: [
          { nom: "Danny GAURAT", client: "GROUPAMA", start: "2026-09-01", end: "2026-12-31", share: 0.5 },
          { nom: "Danny GAURAT", client: "BPI", start: "2026-09-01", end: "2026-12-31", share: 0.5 },
        ],
      },
      {
        fiches: [fiche()],
        missions: [
          { id: "m1", personId: "f1", client: "GROUPAMA", start: "2026-09-01", end: "2026-12-31", share: 0.5 },
        ],
      }
    )
    expect(actions).toEqual([
      {
        type: "MISSION_CREE",
        nom: "Danny GAURAT",
        personId: "f1",
        client: "BPI",
        start: "2026-09-01",
        end: "2026-12-31",
        share: 0.5,
      },
    ])
  })

  it("mission de l'app absente du classeur → signalée, jamais supprimée", () => {
    const { actions, signalements } = plan(
      { consultants: [consultant()] },
      {
        fiches: [fiche()],
        missions: [
          { id: "m1", personId: "f1", client: "FDJ", start: "2026-01-01", end: "2026-12-31", share: 1 },
        ],
      }
    )
    expect(actions).toHaveLength(0)
    expect(signalements[0].quoi).toMatch(/absente du classeur/)
  })

  it("une mission d'une personne HORS périmètre n'est pas un écart", () => {
    const { signalements } = plan(
      { consultants: [consultant()] },
      {
        fiches: [fiche(), fiche({ id: "f2", nom: "Bordelais INCONNU", agency: "BORDEAUX" })],
        missions: [
          { id: "m2", personId: "f2", client: "CDISCOUNT", start: "2026-01-01", end: "2026-12-31", share: 1 },
        ],
      }
    )
    // f2 n'est pas au classeur Paris : ni action, ni signalement sur sa mission.
    expect(signalements.filter((s) => s.nom === "Bordelais INCONNU")).toHaveLength(0)
  })
})

describe("cas composé — les cinq corrections du 06/10/2026 en un seul plan", () => {
  const classeur = {
    consultants: [
      consultant({ nom: "Danny GAURAT", absence: { start: "2026-10-12", end: "2026-11-12" } }),
      consultant({
        nom: "Julie BICHON",
        grade: "SM 1",
        absence: { start: "2026-10-09", end: "2027-02-28" },
      }),
      consultant({
        nom: "Clémence BUYSSE",
        grade: "M 2",
        absence: { start: "2026-06-07", end: "2027-02-28" },
      }),
      consultant({ nom: "Thessa LOPES", grade: "CS 2" }),
      consultant({
        nom: "Emeline DICHAM",
        grade: "Indép",
        arrival: "2026-10-09",
        departure: "2026-12-11",
      }),
    ],
    missions: [
      { nom: "Thessa LOPES", client: "BPI", start: "2025-01-01", end: "2026-12-31", share: 1 },
      { nom: "Emeline DICHAM", client: "ACCOR", start: "2026-10-09", end: "2026-12-11", share: 1 },
    ],
  }
  const app = {
    fiches: [
      fiche({ id: "f1", nom: "Danny GAURAT" }),
      fiche({
        id: "f2",
        nom: "Julie BICHON",
        grade: "SM 1",
        absences: [{ id: "a2", start: "2026-10-18", end: "2027-02-28" }],
      }),
      fiche({
        id: "f3",
        nom: "Clémence BUYSSE",
        grade: "M 2",
        absences: [{ id: "a3", start: "2026-06-07", end: "2026-12-31" }],
      }),
      fiche({ id: "f4", nom: "Thessa Franco", grade: "CS 2", agency: null }),
    ],
    missions: [
      { id: "m4", personId: "f4", client: "BPI", start: "2025-01-01", end: "2026-12-31", share: 1 },
    ],
  }

  it("sépare ce qui s'applique de ce qui demande un humain", () => {
    const { actions, signalements, absencesAConfirmer } = plan(classeur, app)
    // Les absences ne s'appliquent JAMAIS seules : Danny est un intercontrat
    // garé dans les colonnes Absence, et rien dans le classeur ne le dit.
    expect(types(actions)).toEqual([
      "AGENCE", // Thessa : agence vide → PARIS
      "PERSONNE_CREE", // Emeline (Indép)
      "MISSION_CREE", // sa mission ACCOR
    ])
    expect(absencesAConfirmer.map((p) => p.nom)).toEqual([
      "Danny GAURAT",
      "Julie BICHON",
      "Clémence BUYSSE",
    ])
    // Thessa : le changement de nom est résolu, elle ne compte pas deux fois,
    // et sa mission BPI est reconnue comme déjà saisie.
    expect(signalements).toHaveLength(0)
  })

  it("avec les seules absences confirmées, les autres restent en attente", () => {
    const { actions, absencesAConfirmer } = plan(classeur, app, {
      absencesConfirmees: ["Julie BICHON", "Clémence BUYSSE"],
    })
    expect(types(actions)).toEqual([
      "ABSENCE_MAJ", // Julie
      "ABSENCE_MAJ", // Clémence
      "AGENCE",
      "PERSONNE_CREE",
      "MISSION_CREE",
    ])
    expect(absencesAConfirmer.map((p) => p.nom)).toEqual(["Danny GAURAT"])
  })

  it("rejouer le plan après application ne propose plus rien (idempotence)", () => {
    const apres = {
      fiches: [
        // Danny : volontairement SANS absence — personne ne l'a confirmée.
        fiche({ id: "f1", nom: "Danny GAURAT" }),
        fiche({
          id: "f2",
          nom: "Julie BICHON",
          grade: "SM 1",
          absences: [{ id: "a2", start: "2026-10-09", end: "2027-02-28" }],
        }),
        fiche({
          id: "f3",
          nom: "Clémence BUYSSE",
          grade: "M 2",
          absences: [{ id: "a3", start: "2026-06-07", end: "2027-02-28" }],
        }),
        fiche({ id: "f4", nom: "Thessa Franco", grade: "CS 2", agency: "PARIS" }),
        fiche({
          id: "f5",
          nom: "Emeline DICHAM",
          grade: "Indép",
          arrival: "2026-10-09",
          departure: "2026-12-11",
        }),
      ],
      missions: [
        { id: "m4", personId: "f4", client: "BPI", start: "2025-01-01", end: "2026-12-31", share: 1 },
        { id: "m5", personId: "f5", client: "ACCOR", start: "2026-10-09", end: "2026-12-11", share: 1 },
      ],
    }
    const { actions, signalements, absencesAConfirmer } = plan(classeur, apres, {
      absencesConfirmees: ["Julie BICHON", "Clémence BUYSSE"],
    })
    expect(actions).toHaveLength(0)
    expect(signalements).toHaveLength(0)
    // Danny reste une proposition tant que personne ne l'a confirmé : c'est le
    // contrat du plan, pas un jugement sur sa fenêtre.
    expect(absencesAConfirmer.map((p) => p.nom)).toEqual(["Danny GAURAT"])
  })
})


describe("appariement des missions — l'ordre du classeur ne décide pas", () => {
  it("une ligne qui chevauche deux missions ne vole pas celle d'une autre ligne identique", () => {
    const { actions } = plan(
      {
        consultants: [consultant()],
        missions: [
          // Cette ligne chevauche les DEUX missions ACCOR de l'app…
          { nom: "Danny GAURAT", client: "ACCOR", start: "2025-01-01", end: "2026-06-30", share: 1 },
          // …mais celle-ci est l'exacte jumelle de la seconde.
          { nom: "Danny GAURAT", client: "ACCOR", start: "2026-01-01", end: "2026-12-31", share: 1 },
        ],
      },
      {
        fiches: [fiche()],
        missions: [
          { id: "m1", personId: "f1", client: "ACCOR", start: "2025-01-01", end: "2025-09-30", share: 1 },
          { id: "m2", personId: "f1", client: "ACCOR", start: "2026-01-01", end: "2026-12-31", share: 1 },
        ],
      }
    )
    // m2 est appariée à l'identique ; seule m1 est ajustée. Aucune création.
    expect(actions).toEqual([
      {
        type: "MISSION_MAJ",
        nom: "Danny GAURAT",
        missionId: "m1",
        client: "ACCOR",
        avant: { start: "2025-01-01", end: "2025-09-30", share: 1 },
        apres: { start: "2025-01-01", end: "2026-06-30", share: 1 },
      },
    ])
  })

  it("entre deux candidats, le plus recouvrant l'emporte", () => {
    const { actions } = plan(
      {
        consultants: [consultant()],
        missions: [{ nom: "Danny GAURAT", client: "ACCOR", start: "2026-03-01", end: "2026-12-31", share: 1 }],
      },
      {
        fiches: [fiche()],
        missions: [
          { id: "court", personId: "f1", client: "ACCOR", start: "2026-02-01", end: "2026-03-05", share: 1 },
          { id: "long", personId: "f1", client: "ACCOR", start: "2026-03-01", end: "2026-10-31", share: 1 },
        ],
      }
    )
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({ type: "MISSION_MAJ", missionId: "long" })
  })

  it("la mission laissée de côté est signalée, pas supprimée", () => {
    const { signalements } = plan(
      {
        consultants: [consultant()],
        missions: [{ nom: "Danny GAURAT", client: "ACCOR", start: "2026-03-01", end: "2026-12-31", share: 1 }],
      },
      {
        fiches: [fiche()],
        missions: [
          { id: "court", personId: "f1", client: "ACCOR", start: "2026-02-01", end: "2026-03-05", share: 1 },
          { id: "long", personId: "f1", client: "ACCOR", start: "2026-03-01", end: "2026-10-31", share: 1 },
        ],
      }
    )
    expect(signalements).toHaveLength(1)
    expect(signalements[0].detail).toContain("2026-02-01")
  })
})

describe("personne rattachée ailleurs — jamais dupliquée", () => {
  it("au classeur Paris mais fiche bordelaise en cours → signalement, pas de création", () => {
    const { actions, signalements } = plan(
      {
        consultants: [consultant({ nom: "Zoé MARQUOIN", grade: "SM 1" })],
        missions: [{ nom: "Zoé MARQUOIN", client: "CCF", start: "2026-03-26", end: "2026-12-31", share: 1 }],
      },
      { fiches: [] },
      { horsPerimetre: [{ nom: "Zoé MARQUOIN", agence: "BORDEAUX" }] }
    )
    expect(actions).toHaveLength(0) // ni fiche, ni mission : son titulaire est ailleurs
    expect(signalements[0].quoi).toMatch(/rattachée ailleurs/)
    expect(signalements[0].detail).toContain("BORDEAUX")
  })
})
