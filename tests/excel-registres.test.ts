// Lecture des registres du classeur (lib/excel-registres.ts) — protège le
// parsing PARTAGÉ par l'import initial et le comparateur : un classeur
// synthétique minimal, mêmes colonnes et mêmes sérials de dates que l'Excel.
import { afterAll, describe, expect, it } from "vitest"
import { mkdtempSync, rmSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import * as XLSX from "xlsx"
import { normNom, readRegistres, serialToDate, toEngineInputs, toIso } from "@/lib/excel-registres"

/** « YYYY-MM-DD » → sérial Excel (base 30/12/1899). */
const serial = (iso: string): number => {
  const [y, m, d] = iso.split("-").map(Number)
  return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000
}

const dir = mkdtempSync(path.join(tmpdir(), "xlsx-test-"))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

function classeur(rows: {
  consultant?: unknown[][]
  siege?: unknown[][]
  mission?: unknown[][]
}): string {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["Nom", "Email", "Grade", "Arrivée", "Départ", "Absence début", "Absence fin", "Manager"],
      ...(rows.consultant ?? []),
    ]),
    "Consultant"
  )
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([["Nom", "Grade", "Arrivée", "Départ"], ...(rows.siege ?? [])]),
    "Siège"
  )
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["Consultant", "", "Client", "Début", "Fin", "Part"],
      ...(rows.mission ?? []),
    ]),
    "Mission_Consultant"
  )
  const f = path.join(dir, `c-${Math.random().toString(36).slice(2)}.xlsx`)
  XLSX.writeFile(wb, f)
  return f
}

describe("serialToDate / normNom / toIso", () => {
  it("convertit un sérial Excel en jour UTC, et l'inverse", () => {
    expect(toIso(serialToDate(serial("2026-01-12"))!)).toBe("2026-01-12")
    expect(toIso(serialToDate(serial("2026-12-31"))!)).toBe("2026-12-31")
  })
  it("vide, 0 et null → null (pas de date)", () => {
    expect(serialToDate(null)).toBeNull()
    expect(serialToDate("")).toBeNull()
    expect(serialToDate(0)).toBeNull()
  })
  it("rapproche les noms malgré casse et accents (la synchro Boond réécrit la casse)", () => {
    expect(normNom("Marc KOLTA")).toBe(normNom("Marc Kolta"))
    expect(normNom("Anaïs  MATHONNET ")).toBe(normNom("Anais Mathonnet"))
  })
})

describe("readRegistres", () => {
  it("lit les 3 registres, dates, absences et managers", () => {
    const f = classeur({
      consultant: [
        ["Alice MARTIN", "alice@x.fr", "M 1", serial("2024-03-01"), null, null, null, "Bob CHEF"],
        ["Bob CHEF", "bob@x.fr", "SM 2", serial("2023-01-09"), serial("2026-06-30"), serial("2026-02-01"), serial("2026-03-15"), null],
        [null, null, null, null], // ligne vide ignorée
      ],
      siege: [["Carla SIEGE", "Office Manager", serial("2025-01-06"), null]],
      mission: [
        ["Alice MARTIN", "", "GROUPAMA", serial("2026-01-05"), serial("2026-12-31"), 1],
        ["Bob CHEF", "", "ACCOR", serial("2026-02-02"), serial("2026-06-30"), 0.5],
      ],
    })
    const reg = readRegistres(f)
    expect(reg.consultants).toHaveLength(2)
    expect(reg.siege).toHaveLength(1)
    expect(reg.missions).toHaveLength(2)

    const bob = reg.consultants[1]
    expect(bob.grade).toBe("SM 2")
    expect(toIso(bob.departure!)).toBe("2026-06-30")
    expect(toIso(bob.absenceStart!)).toBe("2026-02-01")
    expect(toIso(bob.absenceEnd!)).toBe("2026-03-15")
    expect(reg.consultants[0].manager).toBe("Bob CHEF")
    expect(reg.missions[1]).toMatchObject({ client: "ACCOR", share: 0.5, rank: 1 })
  })

  it("refuse un grade consultant inconnu et une part hors bornes", () => {
    expect(() =>
      readRegistres(classeur({ consultant: [["X", null, "Consultant senior", serial("2026-01-01")]] }))
    ).toThrow(/grade consultant inconnu/)
    expect(() =>
      readRegistres(
        classeur({
          consultant: [["X", null, "C", serial("2026-01-01")]],
          mission: [["X", "", "FDJ", serial("2026-01-01"), serial("2026-02-01"), 1.5]],
        })
      )
    ).toThrow(/part d'intervention invalide/)
  })

  it("onglet manquant → erreur explicite", () => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Nom"]]), "Consultant")
    const f = path.join(dir, "incomplet.xlsx")
    XLSX.writeFile(wb, f)
    expect(() => readRegistres(f)).toThrow(/Siège/)
  })
})

describe("toEngineInputs", () => {
  const f = classeur({
    consultant: [
      ["Alice MARTIN", null, "M 1", serial("2024-03-01"), null, serial("2026-05-01"), null, null],
      ["Elvire HOUDEVILLE", null, "C", serial("2025-01-13"), serial("2025-09-30"), null, null, null],
    ],
    mission: [
      ["Alice MARTIN", "", "GROUPAMA", serial("2026-01-05"), serial("2026-12-31"), 1],
      ["Elvire HOUDEVILLE", "", "ACCOR", serial("2025-02-01"), serial("2025-06-30"), 1],
      ["Fantôme INCONNU", "", "FDJ", serial("2026-01-01"), serial("2026-02-01"), 1],
    ],
  })

  it("convertit en entrées moteur (id = nom normalisé, absence ouverte conservée)", () => {
    const { people, missions } = toEngineInputs(readRegistres(f))
    expect(people.map((p) => p.name)).toEqual(["Alice MARTIN", "Elvire HOUDEVILLE"])
    const alice = people[0]
    expect(alice.id).toBe(normNom("Alice MARTIN"))
    expect(alice.absences).toEqual([{ start: "2026-05-01", end: null }])
    // la mission du consultant inconnu est écartée (elle n'a pas de titulaire)
    expect(missions).toHaveLength(2)
    expect(missions.every((m) => m.personId !== normNom("Fantôme INCONNU"))).toBe(true)
  })

  it("`exclure` applique la correction assumée (Elvire) — missions comprises", () => {
    const { people, missions } = toEngineInputs(readRegistres(f), { exclure: ["Elvire HOUDEVILLE"] })
    expect(people.map((p) => p.name)).toEqual(["Alice MARTIN"])
    expect(missions).toHaveLength(1)
    expect(missions[0].client).toBe("GROUPAMA")
  })
})
