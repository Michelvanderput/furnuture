/**
 * When a device's morning reminder is due, in its own time zone. The cron may run
 * every few minutes (cron-job.org) or once a day (Vercel's free plan): a reminder is
 * still sent up to WINDOW minutes after its time, and never twice on one local day.
 */

export const WINDOW = 90;
/** Missed (the cron ran only once today)? Still sent later that day, but not after this local time. */
export const CATCH_UP_UNTIL = 22 * 60;

export const validTime = (t: unknown): t is string => typeof t === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
export function validTz(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The local day ("2026-10-01") and minute of the day in a time zone. */
export function localNow(tz: string, date = new Date()): { day: string; min: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return { day: `${parts.year}-${parts.month}-${parts.day}`, min: (Number(parts.hour) % 24) * 60 + Number(parts.minute) };
}

const toMin = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

/**
 * The local day whose reminder is due now, or null. A late cron still counts (up to
 * WINDOW minutes, also across midnight); a day already sent does not.
 */
export function dueDay(time: string, tz: string, lastSent: string | null | undefined, now = new Date(), window = WINDOW): string | null {
  const { day, min } = localNow(tz, now);
  const t = toMin(validTime(time) ? time : "08:00");
  const late = (min - t + 1440) % 1440;
  // Later the same day still counts (a once-a-day cron), but no reminders in the night.
  const catchUp = min >= t && min < CATCH_UP_UNTIL;
  if (late >= window && !catchUp) return null;
  // Past midnight but inside yesterday's window: the reminder belongs to yesterday.
  const slotDay = min < t ? localNow(tz, new Date(now.getTime() - late * 60_000)).day : day;
  return lastSent === slotDay ? null : slotDay;
}
