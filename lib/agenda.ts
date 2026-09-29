import { addDays, deliveryPlan, expectedDelivery, roomReady, shortDate, URGENT_DAYS } from "./delivery";
import { daysBetween, lateTasks, renovationOf, taskEnd, today } from "./renovation";
import { mainItems } from "./shopping";
import type { Project } from "./types";

/**
 * Everything with a date, in one list: key and moving day, jobs, deliveries and the
 * last day to order. The planning page, the calendar export and the dashboard read
 * from this.
 */

export type EventKind = "mijlpaal" | "klus" | "levering" | "bestellen";
export type Tone = "ok" | "warn" | "bad" | "done" | "info";

export interface AgendaEvent {
  id: string;
  kind: EventKind;
  date: string;
  /** Last day (jobs that take several days). */
  end?: string;
  title: string;
  /** Short extra: room, supplier, "uiterlijk", why it is a problem. */
  sub?: string;
  roomIds: string[];
  /** What tapping it opens: "item:<id>" or "task:<id>". */
  open?: string;
  tone: Tone;
}

export interface Unplanned {
  id: string;
  kind: "klus" | "levering" | "levertijd";
  title: string;
  why: string;
  roomIds: string[];
  open: string;
}

export interface Agenda {
  events: AgendaEvent[];
  unplanned: Unplanned[];
  /** Things to act on: late, too early, order now. */
  attention: AgendaEvent[];
}

const roomNames = (p: Project, ids: string[]) => (ids.length ? ids.map((id) => p.rooms.find((r) => r.id === id)?.name).filter(Boolean).join(", ") : "Hele huis");

export function agenda(p: Project, now = today()): Agenda {
  const r = renovationOf(p);
  const plan = deliveryPlan(p);
  const late = new Set(lateTasks(r).map((t) => t.id));
  const events: AgendaEvent[] = [];
  const unplanned: Unplanned[] = [];

  if (r.keyDate) events.push({ id: "sleutel", kind: "mijlpaal", date: r.keyDate, title: "Sleuteloverdracht", roomIds: [], tone: "info" });
  if (r.moveDate) events.push({ id: "verhuizing", kind: "mijlpaal", date: r.moveDate, title: "Verhuisdag", roomIds: [], tone: "info" });

  for (const t of r.tasks) {
    if (!t.title) continue;
    const end = taskEnd(t);
    if (!t.start || !end) {
      if (t.status !== "klaar") unplanned.push({ id: t.id, kind: "klus", title: t.title, why: "nog geen startdatum", roomIds: t.roomIds, open: `task:${t.id}` });
      continue;
    }
    const tone: Tone = t.status === "klaar" ? "done" : late.has(t.id) ? "bad" : t.status === "bezig" ? "warn" : t.status === "gepland" ? "ok" : "info";
    const chosen = t.quotes.find((q) => q.id === t.chosenQuote);
    events.push({
      id: `task:${t.id}`,
      kind: "klus",
      date: t.start,
      end: end !== t.start ? end : undefined,
      title: t.title,
      sub: [roomNames(p, t.roomIds), chosen?.company ?? (t.who === "zelf" ? "zelf" : undefined), late.has(t.id) ? "niet klaar vóór de verhuizing" : undefined].filter(Boolean).join(" · "),
      roomIds: t.roomIds,
      open: `task:${t.id}`,
      tone,
    });
  }

  for (const { item, date, issue } of plan.incoming) {
    const ready = issue === "voor-klaar" ? roomReady(p, item.roomId).date : undefined;
    events.push({
      id: `delivery:${item.id}`,
      kind: "levering",
      date,
      title: item.title,
      sub: [roomNames(p, item.roomId ? [item.roomId] : []), item.shop, issue === "na-verhuizing" ? "na de verhuizing" : ready ? `kamer pas ${shortDate(ready)} klaar` : undefined].filter(Boolean).join(" · "),
      roomIds: item.roomId ? [item.roomId] : [],
      open: `item:${item.id}`,
      tone: issue === "na-verhuizing" ? "bad" : issue === "voor-klaar" ? "warn" : "ok",
    });
  }
  // Delivered: in the past, for the record.
  for (const item of mainItems(p.items).filter((i) => i.status === "binnen")) {
    const date = expectedDelivery(item);
    if (!date) continue;
    events.push({ id: `delivery:${item.id}`, kind: "levering", date, title: item.title, sub: "binnen", roomIds: item.roomId ? [item.roomId] : [], open: `item:${item.id}`, tone: "done" });
  }

  for (const { item, advice } of plan.toOrder) {
    if (!advice.latest) continue;
    const days = daysBetween(now, advice.latest);
    events.push({
      id: `order:${item.id}`,
      kind: "bestellen",
      date: advice.late ? now : advice.latest,
      title: `Bestellen: ${item.title}`,
      sub: [
        roomNames(p, item.roomId ? [item.roomId] : []),
        advice.late ? "te laat voor de verhuisdag" : `uiterlijk ${shortDate(advice.latest)}`,
        advice.earliest ? `niet vóór ${shortDate(advice.earliest)}` : undefined,
      ]
        .filter(Boolean)
        .join(" · "),
      roomIds: item.roomId ? [item.roomId] : [],
      open: `item:${item.id}`,
      tone: advice.late ? "bad" : days <= URGENT_DAYS ? "warn" : "info",
    });
  }

  for (const item of plan.undated)
    unplanned.push({ id: item.id, kind: "levering", title: item.title, why: "besteld, leverdatum onbekend", roomIds: item.roomId ? [item.roomId] : [], open: `item:${item.id}` });
  for (const item of plan.noLead)
    unplanned.push({ id: item.id, kind: "levertijd", title: item.title, why: "gekozen, levertijd onbekend", roomIds: item.roomId ? [item.roomId] : [], open: `item:${item.id}` });

  events.sort((a, b) => a.date.localeCompare(b.date) || order(a) - order(b));
  // A job in progress is "warn" but not a problem; everything else red or orange is.
  const attention = events.filter((e) => (e.tone === "bad" || (e.tone === "warn" && e.kind !== "klus")) && ((e.end ?? e.date) >= now || e.kind === "bestellen"));
  return { events, unplanned, attention };
}

const order = (e: AgendaEvent) => ({ mijlpaal: 0, bestellen: 1, klus: 2, levering: 3 })[e.kind];

/** Does an event fall on (or run through) this day? Jobs skip the weekend. */
export function onDay(e: AgendaEvent, day: string): boolean {
  if (!e.end) return e.date === day;
  if (day < e.date || day > e.end) return false;
  const wd = new Date(`${day}T12:00:00Z`).getUTCDay();
  return wd !== 0 && wd !== 6;
}

// ---------------------------------------------------------------------------
// Weeks and months

/** The Monday of the week of a day. */
export function weekStart(day: string): string {
  const wd = new Date(`${day}T12:00:00Z`).getUTCDay();
  return addDays(day, -((wd + 6) % 7));
}

/** ISO week number. */
export function weekNumber(day: string): number {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7));
  const jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((d.getTime() - jan4.getTime()) / 86_400_000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
}

/** "Deze week", "Volgende week" or "Week 43 · 19 – 25 okt". */
export function weekLabel(monday: string, now = today()): string {
  const thisWeek = weekStart(now);
  if (monday === thisWeek) return "Deze week";
  if (monday === addDays(thisWeek, 7)) return "Volgende week";
  if (monday === addDays(thisWeek, -7)) return "Vorige week";
  return `Week ${weekNumber(monday)} · ${shortDate(monday)} – ${shortDate(addDays(monday, 6))}`;
}

/** "vandaag", "morgen", or "do 15 okt". */
export function dayLabel(day: string, now = today()): string {
  const d = daysBetween(now, day);
  const date = new Date(`${day}T12:00:00Z`).toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  return d === 0 ? `Vandaag · ${date}` : d === 1 ? `Morgen · ${date}` : d === -1 ? `Gisteren · ${date}` : date;
}

/** The days shown for a month: whole weeks, Monday first. */
export function monthGrid(month: string): string[] {
  const first = `${month}-01`;
  const start = weekStart(first);
  const next = new Date(`${first}T12:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const last = addDays(next.toISOString().slice(0, 10), -1);
  const end = addDays(weekStart(last), 6);
  const days: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);
  return days;
}

export const monthOf = (day: string) => day.slice(0, 7);
export function shiftMonth(month: string, n: number): string {
  const d = new Date(`${month}-01T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 7);
}
export const monthLabel = (month: string) => new Date(`${month}-01T12:00:00Z`).toLocaleDateString("nl-NL", { month: "long", year: "numeric", timeZone: "UTC" });

// ---------------------------------------------------------------------------
// Calendar file (iPhone, Google, Outlook)

const icsText = (s: string) => s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/[,;]/g, (m) => `\\${m}`);
const icsDate = (d: string) => d.replace(/-/g, "");
/** Lines of at most 75 octets, as the standard wants. */
const fold = (line: string) => line.replace(/(.{73})/g, "$1\r\n ").replace(/\r\n $/, "");

/** All-day events for a calendar app; a subscription picks up changes by itself. */
export function toIcs(events: AgendaEvent[], name: string, url?: string): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const emoji: Record<EventKind, string> = { mijlpaal: "🔑", klus: "🔨", levering: "📦", bestellen: "🛒" };
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//furnuture//planning//NL",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsText(`${name} · furnuture`)}`,
    "X-WR-TIMEZONE:Europe/Amsterdam",
    "REFRESH-INTERVAL;VALUE=DURATION:PT6H",
    "X-PUBLISHED-TTL:PT6H",
  ];
  for (const e of events) {
    if (e.tone === "done" && e.kind === "levering") continue;
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.id.replace(/[^A-Za-z0-9:_-]/g, "")}@furnuture`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${icsDate(e.date)}`,
      `DTEND;VALUE=DATE:${icsDate(addDays(e.end ?? e.date, 1))}`,
      `SUMMARY:${icsText(`${emoji[e.kind]} ${e.title}`)}`,
      ...(e.sub ? [`DESCRIPTION:${icsText(e.sub)}`] : []),
      ...(url ? [`URL:${url}`] : []),
      "TRANSP:TRANSPARENT",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
