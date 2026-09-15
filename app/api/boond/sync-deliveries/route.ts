import { NextRequest, NextResponse } from "next/server"
import { Role } from "@/lib/types"
import { auth } from "@/auth"
import { syncDeliveries } from "@/lib/boond-deliveries-sync"

// Synchronisation Boond → prestations (TJM vendus, jours vendus) — s6.
// GET  — cron du VPS (x-cron-secret), APRÈS la synchro des jours (elle
//        fournit les identifiants de prestation à aller lire).
// POST — déclenchement manuel par un rôle SIÈGE (carte de /admin/reporting).
export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 600

export async function GET(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret")
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 })
  }
  const dryRunParam = req.nextUrl.searchParams.get("dryRun")
  return run(dryRunParam === "1" || dryRunParam === "true")
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user || session.user.role !== Role.SIEGE) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 })
  }
  const body = await req.json().catch(() => ({}))
  return run(body?.dryRun === true)
}

async function run(dryRun: boolean) {
  try {
    const report = await syncDeliveries({ dryRun })
    return NextResponse.json({ ok: report.errors.length === 0, dryRun, ...report })
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Erreur de synchronisation des prestations" },
      { status: 500 }
    )
  }
}
