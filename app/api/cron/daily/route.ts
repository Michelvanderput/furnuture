import { NextResponse } from "next/server";
import { fromRows } from "@/lib/db/rows";
import { housesWithSubscriptions, loadHouse } from "@/lib/db/supabase";
import { dailyReminder } from "@/lib/notify";
import { sendToHouse } from "@/lib/push.server";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Today in the Netherlands (the cron runs early in the morning, UTC). */
const todayNL = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Amsterdam" }).format(new Date());

/**
 * The morning reminder, run by Vercel Cron (vercel.json). Vercel calls it with
 * "Authorization: Bearer <CRON_SECRET>"; anyone else is refused.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Niet toegestaan" }, { status: 401 });
  const today = todayNL();
  const report: { house: string; sent?: number; skipped?: string }[] = [];
  for (const id of await housesWithSubscriptions()) {
    try {
      const { house, rows } = await loadHouse(id);
      const note = dailyReminder(fromRows(house, rows), today);
      if (!note) {
        report.push({ house: id, skipped: "niets vandaag" });
        continue;
      }
      const r = await sendToHouse(id, note, { kind: "daily", houseName: String(house.name), key: `daily:${today}` });
      report.push({ house: id, sent: r.sent, skipped: r.kept ? undefined : "al verstuurd" });
    } catch (e) {
      report.push({ house: id, skipped: e instanceof Error ? e.message : "fout" });
    }
  }
  return NextResponse.json({ today, report });
}
