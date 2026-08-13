import { NextRequest, NextResponse } from "next/server"
import { Role } from "@/lib/types"
import { auth } from "@/auth"
import { syncBoond } from "@/lib/boond-sync"

// Synchronisation Boond → registre des personnes.
// GET  — déclenchement quotidien par le cron du VPS (header x-cron-secret),
//        ?dryRun=1 pour une répétition (tout est joué puis annulé).
// POST — déclenchement manuel par un ADMIN connecté (body { dryRun }).
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

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
    const report = await syncBoond({ dryRun })
    return NextResponse.json({ ok: report.errors.length === 0, dryRun, ...report })
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Erreur de synchronisation" },
      { status: 500 }
    )
  }
}
