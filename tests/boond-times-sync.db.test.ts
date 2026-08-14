// Tests d'intégration de la synchro des jours CRA — transaction annulée à la
// fin (rien ne persiste) ; sans base joignable, la suite se désactive.
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { runTimesSync } from "@/lib/boond-times-sync"
import type { BoondTimeRow } from "@/lib/boond-times"

let dbOk = false

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`
    dbOk = true
  } catch {
    console.warn("⚠ Base injoignable — tests d'intégration times sautés.")
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

function tr(over: Partial<BoondTimeRow>): BoondTimeRow {
  return {
    boondId: "regular_t1",
    resourceBoondId: "res-t1",
    date: "2026-06-01",
    duration: 1,
    category: "regular",
    activityType: "production",
    workUnit: "Mission",
    projectBoondId: "12",
    projectName: "PMO Carve-Out",
    clientName: "BYREDO",
    craState: "validated",
    craTerm: "2026-06",
    ...over,
  }
}

async function seedPerson(tx: Prisma.TransactionClient, boondId = "res-t1") {
  return tx.person.create({
    data: {
      name: `TEST TIMES ${boondId}`, kind: "CONSULTANT", grade: "C", boondId,
      arrivalDate: new Date("2024-01-01T00:00:00Z"),
    },
  })
}

describe("runTimesSync (intégration, rollback)", () => {
  it("pleine charge : écrit les jours rattachables, compte le reste", async () => {
    if (!dbOk) return
    await withRollback(async (tx) => {
      await seedPerson(tx)
      const r = await runTimesSync(
        tx,
        [
          tr({ boondId: "regular_a", date: "2026-06-01" }),
          tr({ boondId: "absence_b", date: "2026-06-02", duration: 0.5, category: "absence", activityType: "absence", workUnit: "Congés payés", clientName: null }),
          tr({ boondId: "regular_c", resourceBoondId: "res-inconnu" }), // personne absente de la base
          tr({ boondId: "regular_d", date: null }), // inexploitable
        ],
        { cutoffIso: null, pagesWalked: 3 }
      )
      expect(r.errors).toEqual([])
      expect(r.fullLoad).toBe(true)
      expect(r.created).toBe(2)
      expect(r.skippedNoPerson).toBe(1)
      expect(r.personsUnknown[0]).toContain("res-inconnu")
      expect(r.skippedUnusable).toBe(1)
      expect(r.parActivite).toEqual({ production: 1, absence: 0.5 })
      expect(r.windowFrom).toBe("2026-06-01")
      expect(r.windowTo).toBe("2026-06-02")
      const saved = await tx.timeEntry.findUnique({ where: { boondId: "regular_a" } })
      expect(saved).toMatchObject({ clientName: "BYREDO", craState: "validated", duration: 1 })
    })
  })

  it("fenêtre incrémentale : remplace (corrections ET suppressions), préserve l'antérieur", async () => {
    if (!dbOk) return
    await withRollback(async (tx) => {
      await seedPerson(tx)
      const r1 = await runTimesSync(
        tx,
        [
          tr({ boondId: "regular_v1", date: "2026-05-04" }),
          tr({ boondId: "regular_v2", date: "2026-07-01" }),
          tr({ boondId: "regular_v3", date: "2026-07-02" }), // sera SUPPRIMÉ de Boond
        ],
        { cutoffIso: null, pagesWalked: 1 }
      )
      expect(r1.created).toBe(3)

      // Nouvelle passe, fenêtre au 15/06 : v2 corrigé (0,5), v3 disparu, v4 nouveau.
      const r2 = await runTimesSync(
        tx,
        [
          tr({ boondId: "regular_v2", date: "2026-07-01", duration: 0.5 }),
          tr({ boondId: "regular_v4", date: "2026-07-03" }),
          tr({ boondId: "regular_vieux", date: "2026-06-10" }), // queue de page AVANT la coupure → ignoré
        ],
        { cutoffIso: "2026-06-15", pagesWalked: 1 }
      )
      expect(r2.fullLoad).toBe(false)
      expect(r2.deleted).toBe(2) // v2 + v3 (fenêtre) ; v1 (mai) intact
      expect(r2.created).toBe(2) // v2 corrigé + v4
      expect(await tx.timeEntry.count()).toBe(3)
      expect((await tx.timeEntry.findUnique({ where: { boondId: "regular_v2" } }))?.duration).toBe(0.5)
      expect(await tx.timeEntry.findUnique({ where: { boondId: "regular_v3" } })).toBeNull()
      expect(await tx.timeEntry.findUnique({ where: { boondId: "regular_v1" } })).not.toBeNull()
    })
  })

  it("garde-fous : flux vide ou fenêtre irrésoluble → RIEN n'est touché", async () => {
    if (!dbOk) return
    await withRollback(async (tx) => {
      await seedPerson(tx)
      await runTimesSync(tx, [tr({ boondId: "regular_g1", date: "2026-07-20" })], {
        cutoffIso: null, pagesWalked: 1,
      })
      const before = await tx.timeEntry.count()

      const vide = await runTimesSync(tx, [], { cutoffIso: "2026-06-15", pagesWalked: 1 })
      expect(vide.errors[0]).toContain("vide")
      expect(await tx.timeEntry.count()).toBe(before)

      const irresolu = await runTimesSync(
        tx,
        [tr({ boondId: "regular_g2", date: "2026-07-21", resourceBoondId: "res-fantome" })],
        { cutoffIso: "2026-06-15", pagesWalked: 1 }
      )
      expect(irresolu.errors[0]).toContain("rattachable")
      expect(await tx.timeEntry.count()).toBe(before)
    })
  })

  it("sans aucune personne rapprochée de Boond : refus explicite", async () => {
    if (!dbOk) return
    await withRollback(async (tx) => {
      // Aucun seedPerson : selon l'état de la base ambiante, il peut exister
      // des personnes rapprochées — on ne teste le refus que sur base neutre.
      const persons = await tx.person.count({ where: { boondId: { not: null } } })
      if (persons > 0) return
      const r = await runTimesSync(tx, [tr({})], { cutoffIso: null, pagesWalked: 1 })
      expect(r.errors[0]).toContain("synchro des personnes")
    })
  })
})
