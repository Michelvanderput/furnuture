import { NextResponse } from "next/server";
import { fromRows } from "@/lib/db/rows";
import { allSubscriptions, DEFAULT_PREFS, lastCronRun, loadHouse, logCronRun, logNotification, markDailySent } from "@/lib/db/supabase";
import { dailyReminder, noteUrl } from "@/lib/notify";
import { publicKey, sendTo, vapidSubject } from "@/lib/push.server";
import { dueDay, localNow } from "@/lib/schedule";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * The planning of the day, per device at its own time ("08:00", in its time zone).
 *
 * Call it every 5 to 15 minutes (cron-job.org, free) for exact times; Vercel's own
 * cron (vercel.json) runs once a day on the free plan and still catches every
 * reminder of the hour before. A reminder goes out up to 90 minutes late and never
 * twice a day.
 *
 * Auth: "Authorization: Bearer <CRON_SECRET>" (Vercel sends this) or ?key=<CRON_SECRET>.
 *   ?status=1  last run, and per device its local time, time and last day sent (sends nothing)
 *   ?test=1    a test to every device, with what each push service answers
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const url = new URL(req.url);
  if (!secret || (req.headers.get("authorization") !== `Bearer ${secret}` && url.searchParams.get("key") !== secret)) {
    return NextResponse.json({ error: "Niet toegestaan" }, { status: 401 });
  }
  if (!publicKey()) return NextResponse.json({ error: "VAPID-sleutels ontbreken" }, { status: 503 });
  const now = new Date();
  const subs = await allSubscriptions();

  if (url.searchParams.get("status") === "1") {
    const last = await lastCronRun();
    return NextResponse.json({
      lastRun: last?.ran_at ?? null,
      minutesAgo: last ? Math.round((now.getTime() - Date.parse(last.ran_at)) / 60_000) : null,
      lastReport: last?.report ?? null,
      devices: subs.map((s) => ({
        member: s.member,
        host: new URL(s.endpoint).host,
        tz: s.tz,
        localTime: (() => {
          const { day, min } = localNow(s.tz ?? "Europe/Amsterdam", now);
          return `${day} ${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
        })(),
        dailyTime: s.daily_time,
        daily: { ...DEFAULT_PREFS, ...s.prefs }.daily,
        lastDaily: s.last_daily,
      })),
    });
  }

  if (url.searchParams.get("test") === "1") {
    const results = await Promise.all(
      subs.map(async (s) => ({
        member: s.member,
        host: new URL(s.endpoint).host,
        ...(await sendTo(s.house_id, s, { title: "Test van de server", body: "De meldingen werken.", url: "/", tag: `test-${Date.now()}` })),
      })),
    );
    return NextResponse.json({ subject: vapidSubject(), results });
  }

  const report = { devices: subs.length, due: 0, sent: 0, nothing: 0, removed: 0, errors: 0 };
  // One reminder per house and day, however many devices get it.
  const notes = new Map<string, ReturnType<typeof dailyReminder> & {} | null>();
  const names = new Map<string, string>();
  for (const s of subs) {
    if (!{ ...DEFAULT_PREFS, ...s.prefs }.daily) continue;
    const day = dueDay(s.daily_time ?? "08:00", s.tz ?? "Europe/Amsterdam", s.last_daily, now);
    if (!day) continue;
    report.due++;
    const key = `${s.house_id}:${day}`;
    try {
      if (!notes.has(key)) {
        const { house, rows } = await loadHouse(s.house_id);
        names.set(s.house_id, String(house.name));
        const note = dailyReminder(fromRows(house, rows), day);
        notes.set(key, note);
        // The list behind the bell gets it once.
        if (note) await logNotification(s.house_id, { kind: "daily", title: note.title, body: note.body, url: noteUrl(String(house.name), note.open), key: `daily:${day}` });
      }
      const note = notes.get(key);
      if (note) {
        const r = await sendTo(s.house_id, s, { title: note.title, body: note.body, url: noteUrl(names.get(s.house_id)!, note.open), tag: `daily:${day}` });
        if (r.ok) report.sent++;
        else if (r.gone) {
          report.removed++;
          continue;
        } else {
          report.errors++;
          continue;
        }
      } else report.nothing++;
      // Also on a quiet day: checked, so not again today.
      await markDailySent(s.house_id, s.id, day);
    } catch {
      report.errors++;
    }
  }
  await logCronRun(report).catch(() => undefined);
  return NextResponse.json({ at: now.toISOString(), ...report });
}
