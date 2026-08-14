// Tests d'intégration de la synchro Boond — jouent runBoondSync contre la
// base locale DANS une transaction annulée à la fin (rien ne persiste).
// Sans base joignable (CI), la suite se désactive d'elle-même.
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { runBoondSync } from "@/lib/boond-sync"
import type { BoondPerson } from "@/lib/boond"

let dbOk = false

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`
    dbOk = true
  } catch {
    console.warn("⚠ Base injoignable — tests d'intégration Boond sautés.")
  }
})

afterAll(async () => {
  await prisma.$disconnect()
})

class Rollback extends Error {}

async function withRollback(fn: (tx: Prisma.TransactionClient) => Promise<void>) {
  try {
    await prisma.$transaction(
      async (tx) => {
        await fn(tx)
        throw new Rollback()
      },
      { maxWait: 10_000, timeout: 60_000 }
    )
  } catch (e) {
    if (!(e instanceof Rollback)) throw e
  }
}

function bp(over: Partial<BoondPerson>): BoondPerson {
  return {
    boondId: "test-1",
    name: "TEST BOOND Personne",
    email: null,
    title: "C",
    state: "3",
    typeOf: "0",
    arrival: "2026-01-05",
    departure: null,
    managerBoondId: null,
    excluded: false,
    activeState: true,
    ...over,
  }
}

describe("runBoondSync (intégration, rollback)", () => {
  it("crée un consultant complet (grade = titre BRUT, état conservé)", async () => {
    if (!dbOk) return
    await withRollback(async (tx) => {
      const r = await runBoondSync(tx, [bp({ boondId: "test-a", name: "TEST BOOND Alice", title: "CS 1" })], 1)
      expect(r.created).toBe(1)
      expect(r.errors).toEqual([])
      const p = await tx.person.findUnique({ where: { boondId: "test-a" } })
      expect(p).toMatchObject({ grade: "CS 1", kind: "CONSULTANT", boondState: "3" })
      expect(p?.arrivalDate.toISOString()).toBe("2026-01-05T00:00:00.000Z")
    })
  })

  it("rapproche par email une personne importée sans boondId (adoption)", async () => {
    if (!dbOk) return
    await withRollback(async (tx) => {
      await tx.person.create({
        data: {
          name: "TEST BOOND Bob", email: "test.boond.bob@small-conseil.com", kind: "CONSULTANT",
          grade: "M 1", arrivalDate: new Date("2024-03-01T00:00:00Z"),
        },
      })
      const r = await runBoondSync(
        tx,
        [bp({ boondId: "test-b", name: "TEST BOOND Bob", email: "test.boond.bob@small-conseil.com", title: "M 2" })],
        1
      )
      expect(r.adopted).toBe(1)
      expect(r.created).toBe(0)
      const p = await tx.person.findUnique({ where: { boondId: "test-b" } })
      expect(p?.grade).toBe("M 2") // promotion reflétée, titre BRUT
    })
  })

  it("rapproche par nom (même kind), pas à travers les kinds (conflit signalé)", async () => {
    if (!dbOk) return
    await withRollback(async (tx) => {
      await tx.person.create({
        data: { name: "TEST BOOND Elvire", kind: "SIEGE", grade: "Office Manager", arrivalDate: new Date("2024-01-01T00:00:00Z") },
      })
      // titre consultant → kind CONSULTANT : le match SIEGE du même nom est un conflit
      const r = await runBoondSync(tx, [bp({ boondId: "test-c", name: "TEST BOOND Elvire", title: "C" })], 1)
      expect(r.kindConflicts).toHaveLength(1)
      expect(r.created).toBe(0)
      const untouched = await tx.person.findFirst({ where: { name: "TEST BOOND Elvire" } })
      expect(untouched?.boondId).toBeNull()
    })
  })

  it("titre siège → kind SIEGE ; titre inconnu → consultant supposé + signalement", async () => {
    if (!dbOk) return
    await withRollback(async (tx) => {
      const r = await runBoondSync(
        tx,
        [
          bp({ boondId: "test-d", name: "TEST BOOND Dir", title: "Directeur du développement" }),
          bp({ boondId: "test-e", name: "TEST BOOND CJ", title: "CJ" }),
        ],
        1
      )
      expect((await tx.person.findUnique({ where: { boondId: "test-d" } }))?.kind).toBe("SIEGE")
      expect((await tx.person.findUnique({ where: { boondId: "test-e" } }))?.kind).toBe("CONSULTANT")
      expect(r.unknownTitles).toContain("CJ")
      expect(r.assumedConsultant).toEqual([{ name: "TEST BOOND CJ", title: "CJ" }])
    })
  })

  it("sans date d'arrivée → non créé ; sans titre → ignoré", async () => {
    if (!dbOk) return
    await withRollback(async (tx) => {
      const r = await runBoondSync(
        tx,
        [
          bp({ boondId: "test-f", name: "TEST BOOND SansDate", arrival: null }),
          bp({ boondId: "test-g", name: "TEST BOOND SansTitre", title: null }),
        ],
        1
      )
      expect(r.skippedNoArrival).toEqual(["TEST BOOND SansDate"])
      expect(r.skippedNoTitle).toEqual(["TEST BOOND SansTitre"])
      expect(r.created).toBe(0)
    })
  })

  it("création sans arrivée : la lit dans le DÉTAIL Boond (seniorityDate)", async () => {
    if (!dbOk) return
    await withRollback(async (tx) => {
      const r = await runBoondSync(
        tx,
        [
          bp({ boondId: "test-det", name: "TEST BOOND Détail", arrival: null }),
          bp({ boondId: "test-det2", name: "TEST BOOND DétailVide", arrival: null }),
        ],
        1,
        async (id) =>
          id === "test-det" ? { seniorityDate: "2026-09-01", dateOfBirth: "1990-01-01" } : {}
      )
      expect(r.arrivalsFromDetail).toBe(1)
      expect(r.created).toBe(1)
      expect(r.skippedNoArrival).toEqual(["TEST BOOND DétailVide"])
      const p = await tx.person.findUnique({ where: { boondId: "test-det" } })
      expect(p?.arrivalDate.toISOString().slice(0, 10)).toBe("2026-09-01")
    })
  })

  it("pose un départ fourni, ne l'efface jamais quand Boond n'en fournit pas", async () => {
    if (!dbOk) return
    await withRollback(async (tx) => {
      await tx.person.create({
        data: {
          name: "TEST BOOND Part", kind: "CONSULTANT", grade: "C", boondId: "test-h",
          arrivalDate: new Date("2024-01-01T00:00:00Z"), departureDate: new Date("2026-09-30T00:00:00Z"),
        },
      })
      const r1 = await runBoondSync(tx, [bp({ boondId: "test-h", name: "TEST BOOND Part" })], 1)
      expect(r1.departuresSet).toHaveLength(0)
      const p1 = await tx.person.findUnique({ where: { boondId: "test-h" } })
      expect(p1?.departureDate?.toISOString().slice(0, 10)).toBe("2026-09-30") // pas effacé

      const r2 = await runBoondSync(tx, [bp({ boondId: "test-h", name: "TEST BOOND Part", departure: "2026-12-31" })], 1)
      expect(r2.departuresSet).toEqual([{ name: "TEST BOOND Part", date: "2026-12-31" }])
      const p2 = await tx.person.findUnique({ where: { boondId: "test-h" } })
      expect(p2?.departureDate?.toISOString().slice(0, 10)).toBe("2026-12-31")
    })
  })

  it("relie les managers par boondId", async () => {
    if (!dbOk) return
    await withRollback(async (tx) => {
      const r = await runBoondSync(
        tx,
        [
          bp({ boondId: "test-mgr", name: "TEST BOOND Chef", title: "SM 2" }),
          bp({ boondId: "test-sub", name: "TEST BOOND Managé", title: "C", managerBoondId: "test-mgr" }),
        ],
        1
      )
      expect(r.managersLinked).toBe(1)
      const sub = await tx.person.findUnique({ where: { boondId: "test-sub" }, include: { manager: true } })
      expect(sub?.manager?.name).toBe("TEST BOOND Chef")
    })
  })

  it("absents du flux : signalés, jamais touchés ; inactifs Boond : ignorés", async () => {
    if (!dbOk) return
    await withRollback(async (tx) => {
      await tx.person.create({
        data: { name: "TEST BOOND Fantôme", kind: "CONSULTANT", grade: "C", boondId: "test-z", arrivalDate: new Date("2023-01-01T00:00:00Z") },
      })
      const r = await runBoondSync(
        tx,
        [
          bp({ boondId: "test-i", name: "TEST BOOND Actif", title: "C" }),
          bp({ boondId: "test-j", name: "TEST BOOND Inactif", state: "0", activeState: false }),
        ],
        1
      )
      expect(r.absentsDuFlux).toContain("TEST BOOND Fantôme")
      expect(r.skippedInactive).toEqual([{ name: "TEST BOOND Inactif", state: "0" }])
      const ghost = await tx.person.findUnique({ where: { boondId: "test-z" } })
      expect(ghost?.name).toBe("TEST BOOND Fantôme") // intact
    })
  })

  it("flux vide → rien n'est touché, erreur explicite", async () => {
    if (!dbOk) return
    await withRollback(async (tx) => {
      const before = await tx.person.count()
      const r = await runBoondSync(tx, [], 1)
      expect(r.errors[0]).toContain("Flux Boond vide")
      expect(await tx.person.count()).toBe(before)
    })
  })
})
