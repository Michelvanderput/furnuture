import type { Changes, Row } from "./db/rows";
import { addDays, deliveryPlan, shortDate } from "./delivery";
import { daysBetween, renovationOf, taskEnd } from "./renovation";
import { euro, shortName } from "./shopping";
import type { Project } from "./types";

/**
 * What is worth a notification. Shared by the server (after a save, and the morning
 * cron) and the tests; no network here.
 */

export interface Note {
  title: string;
  body: string;
  /** What tapping it opens: "item:<id>", "task:<id>" or a view ("verbouwing"). */
  open?: string;
}

/** The link a notification opens: the house by name, and optionally a product or job. */
export const noteUrl = (houseName: string, open?: string) => `/?woning=${encodeURIComponent(houseName)}${open ? `&open=${encodeURIComponent(open)}` : ""}`;

/** Several lines as one notification body: the first few, then "en nog 3". */
function summarise(lines: string[], max = 3): string {
  if (lines.length <= max) return lines.join("\n");
  return `${lines.slice(0, max).join("\n")}\nen nog ${lines.length - max}`;
}

// ---------------------------------------------------------------------------
// Someone changed something

/** The state before a save, as far as notifications care. */
export interface Before {
  items: Map<string, Row>;
  tasks: Map<string, Row>;
  quotes: Set<string>;
  house: Record<string, unknown> | null;
}

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

/**
 * What another member would like to know about a save: things ordered, chosen or
 * delivered, jobs done or (re)planned, quotes, new dates. Typing a note or a price is
 * not news. One notification per save, however much changed.
 */
export function activity(before: Before, changes: Changes, member: string): Note | null {
  const who = member || "Iemand";
  const lines: string[] = [];
  let open: string | undefined;
  const rowsOf = (table: string) => changes.upserts.filter((u) => u.table === table).flatMap((u) => u.rows);

  let added = 0;
  let firstAdded: Row | undefined;
  for (const r of rowsOf("items")) {
    if (r.alternative_of) continue;
    const old = before.items.get(r.id);
    const title = shortName(str(r.title), 40);
    if (!old) {
      // New on the list (placeholders from the AI count too, but only as a number).
      added++;
      firstAdded ??= r;
      continue;
    }
    if (old.status === r.status) continue;
    if (r.status === "besteld") lines.push(`${who} heeft ${title} besteld`);
    else if (r.status === "binnen") lines.push(`${title} is binnen`);
    else if (r.status === "gekozen" && old.status === "idee") lines.push(`${who} koos ${title}`);
    else continue;
    open ??= `item:${r.id}`;
  }
  if (added === 1 && firstAdded) {
    lines.push(`${who} zette ${shortName(str(firstAdded.title), 40)} op de lijst`);
    open ??= `item:${firstAdded.id}`;
  } else if (added > 1) lines.push(`${who} zette ${added} producten op de lijst`);

  let moved = 0;
  for (const r of rowsOf("tasks")) {
    const old = before.tasks.get(r.id);
    const title = shortName(str(r.title), 40);
    if (!old) {
      if (r.title) {
        lines.push(`Nieuwe klus: ${title}`);
        open ??= `task:${r.id}`;
      }
      continue;
    }
    if (old.status !== r.status && r.status === "klaar") {
      lines.push(`Klaar: ${title}`);
      open ??= `task:${r.id}`;
    } else if (old.status !== r.status && r.status === "bezig") {
      lines.push(`Begonnen: ${title}`);
      open ??= `task:${r.id}`;
    }
    if (str(old.chosen_quote) !== str(r.chosen_quote) && r.chosen_quote) {
      lines.push(`${who} koos een offerte voor ${title}`);
      open ??= `task:${r.id}`;
    }
    if (str(old.start).slice(0, 10) !== str(r.start).slice(0, 10) && r.start) moved++;
  }
  if (moved === 1) lines.push("De planning van een klus is verschoven");
  else if (moved > 1) lines.push(`Planning bijgewerkt: ${moved} klussen verschoven`);
  if (moved) open ??= "verbouwing";

  for (const r of rowsOf("quotes")) {
    if (before.quotes.has(r.id)) continue;
    lines.push(`Nieuwe offerte: ${str(r.company)}, ${euro(Number(r.amount))}`);
    open ??= `task:${r.task_id}`;
  }

  const h = changes.house as Record<string, unknown> | undefined;
  if (h && before.house) {
    if ("key_date" in h && str(h.key_date) !== str(before.house.key_date).slice(0, 10) && h.key_date) lines.push(`Sleuteloverdracht: ${shortDate(str(h.key_date))}`);
    if ("move_date" in h && str(h.move_date) !== str(before.house.move_date).slice(0, 10) && h.move_date) lines.push(`Verhuisdag: ${shortDate(str(h.move_date))}`);
  }

  if (!lines.length) return null;
  return { title: lines.length === 1 ? lines[0] : `${who} werkte het huis bij`, body: lines.length === 1 ? "" : summarise(lines), open };
}

// ---------------------------------------------------------------------------
// The morning reminder

/**
 * What matters today: what to order now (a week before, two days before and on
 * the last day), what arrives tomorrow, which job starts tomorrow, and the key and
 * moving day coming up. Only dates that fall on this day, so it never repeats.
 */
export function dailyReminder(p: Project, today: string): Note | null {
  const r = renovationOf(p);
  const plan = deliveryPlan(p);
  const tomorrow = addDays(today, 1);
  const lines: string[] = [];
  let open: string | undefined;

  for (const { item, advice } of plan.toOrder) {
    if (!advice.latest) continue;
    const d = daysBetween(today, advice.latest);
    if (d === 7 || d === 2) lines.push(`Bestel ${shortName(item.title, 36)} vóór ${shortDate(advice.latest)}`);
    else if (d === 0) lines.push(`Vandaag bestellen: ${shortName(item.title, 36)}, anders is het er niet op de verhuisdag`);
    else if (d === -1) lines.push(`Te laat besteld? ${shortName(item.title, 36)} haalt de verhuisdag niet meer`);
    else continue;
    open ??= `item:${item.id}`;
  }
  for (const { item, date, issue } of plan.incoming) {
    if (date !== tomorrow) continue;
    lines.push(`Morgen bezorgd: ${shortName(item.title, 36)}${issue === "voor-klaar" ? " (de kamer is nog niet klaar)" : ""}`);
    open ??= `item:${item.id}`;
  }
  for (const t of r.tasks) {
    if (t.status === "klaar") continue;
    if (t.start === tomorrow) {
      lines.push(`Morgen begint: ${shortName(t.title, 40)}`);
      open ??= `task:${t.id}`;
    } else if (taskEnd(t) === today && t.start !== today) {
      lines.push(`Vandaag klaar volgens planning: ${shortName(t.title, 40)}`);
      open ??= `task:${t.id}`;
    }
  }
  for (const [date, what] of [
    [r.keyDate, "de sleutel"],
    [r.moveDate, "de verhuizing"],
  ] as const) {
    if (!date) continue;
    const d = daysBetween(today, date);
    if (d === 7) lines.push(`Nog een week tot ${what}`);
    else if (d === 1) lines.push(`Morgen: ${what}!`);
  }

  if (!lines.length) return null;
  return { title: lines.length === 1 ? lines[0] : "Vandaag in je planning", body: lines.length === 1 ? "" : summarise(lines, 4), open: open ?? "overzicht" };
}
