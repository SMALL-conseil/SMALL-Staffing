import { NextRequest, NextResponse } from "next/server"
import { Role } from "@/lib/types"
import { auth } from "@/auth"
import { syncTimes } from "@/lib/boond-times-sync"

// Synchronisation Boond → jours de CRA (TimeEntry) — a12.
// GET  — déclenchement quotidien par le cron du VPS (header x-cron-secret),
//        ?dryRun=1 pour une répétition (tout est joué puis annulé).
// POST — déclenchement manuel par un rôle SIÈGE connecté (body { dryRun }).
// Premier passage (table vide) = pleine charge (~180 pages, ~2 min) ;
// ensuite fenêtre incrémentale (BOOND_TIMES_LOOKBACK_DAYS, 90 j par défaut).
export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 600

export async function GET(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret")
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 })
  }
  const q = req.nextUrl.searchParams
  const dryRunParam = q.get("dryRun")
  // ?full=1 : reconstruction complète (pleine charge même table pleine).
  return run(dryRunParam === "1" || dryRunParam === "true", q.get("full") === "1")
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user || session.user.role !== Role.SIEGE) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 })
  }
  const body = await req.json().catch(() => ({}))
  return run(body?.dryRun === true, body?.full === true)
}

async function run(dryRun: boolean, full = false) {
  try {
    const report = await syncTimes({ dryRun, full })
    return NextResponse.json({ ok: report.errors.length === 0, dryRun, ...report })
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Erreur de synchronisation des jours" },
      { status: 500 }
    )
  }
}
