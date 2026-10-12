import { NextResponse } from "next/server";
import { dbConfigured, lastCronRun } from "@/lib/db/supabase";
import { pushConfigured } from "@/lib/push.server";
import { stripeConfigured } from "@/lib/stripe.server";

export const runtime = "nodejs";

/** Simple health check: is the database reachable, are notifications/payments configured, when did the daily cron last run. */
export async function GET() {
  const checks: { name: string; ok: boolean; detail?: string }[] = [];

  const db = dbConfigured();
  let dbOk = false;
  if (db) {
    try {
      await lastCronRun();
      dbOk = true;
    } catch {
      dbOk = false;
    }
  }
  checks.push({ name: "Database", ok: db && dbOk, detail: !db ? "Niet ingesteld" : dbOk ? undefined : "Niet bereikbaar" });

  const push = pushConfigured();
  checks.push({ name: "Meldingen (push)", ok: push, detail: push ? undefined : "VAPID-sleutels ontbreken" });

  const pay = stripeConfigured();
  checks.push({ name: "Betalen (Stripe)", ok: pay, detail: pay ? undefined : "Stripe-sleutel ontbreekt" });

  let cron: { ran_at: string } | null = null;
  try {
    cron = db ? await lastCronRun() : null;
  } catch {
    cron = null;
  }
  const cronFresh = !!cron && Date.now() - Date.parse(cron.ran_at) < 26 * 3_600_000;
  checks.push({ name: "Dagelijkse planning (cron)", ok: !db || cronFresh, detail: cron ? `Laatst: ${cron.ran_at}` : "Nog niet gedraaid" });

  const allOk = checks.every((c) => c.ok);
  return NextResponse.json({ ok: allOk, checks, checked_at: new Date().toISOString() });
}
