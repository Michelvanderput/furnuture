import { renovationOf, taskEnd, today } from "./renovation";
import { mainItems } from "./shopping";
import type { Item, Project, RenoKind, Task } from "./types";

/**
 * Delivery times: when things arrive, compared with the renovation (a sofa should not
 * arrive before the floor is laid) and with moving day (the bed should be there).
 */

const parse = (s: string) => new Date(`${s}T12:00:00Z`);
export const addDays = (s: string, n: number) => {
  const d = parse(s);
  d.setUTCDate(d.getUTCDate() + Math.round(n));
  return d.toISOString().slice(0, 10);
};
export const shortDate = (s: string) => parse(s).toLocaleDateString("nl-NL", { day: "numeric", month: "short" });

export { leadLabel } from "./leadTime";

// ---------------------------------------------------------------------------
// Planning

/** Whole-house jobs that make every room unready for furniture. */
const HOUSE_BLOCKING = new Set<RenoKind>(["sloop", "stucwerk", "schilderen", "vloeren"]);

/** Jobs that have to be done before furniture can go into this room. */
export function roomJobs(p: Project, roomId: string | null): Task[] {
  if (!roomId) return [];
  return renovationOf(p).tasks.filter(
    (t) => t.status !== "klaar" && t.kind !== "schoonmaak" && (t.roomIds.includes(roomId) || (!t.roomIds.length && HOUSE_BLOCKING.has(t.kind))),
  );
}

/** When the room is ready for furniture (the last job there ends), and jobs not planned yet. */
export function roomReady(p: Project, roomId: string | null): { date?: string; unplanned: Task[] } {
  const jobs = roomJobs(p, roomId);
  const ends = jobs.map(taskEnd).filter((d): d is string => !!d);
  return { date: ends.sort().at(-1), unplanned: jobs.filter((t) => !t.start) };
}

/** When it arrives: the date given, or ordered + delivery time. */
export function expectedDelivery(i: Item): string | undefined {
  if (i.status !== "besteld" && i.status !== "binnen") return undefined;
  if (i.deliveryDate) return i.deliveryDate;
  if (i.orderedAt && i.leadDays !== undefined) return addDays(i.orderedAt, i.leadDays);
  return undefined;
}

export interface OrderAdvice {
  /** Order on or before this day to have it on moving day. */
  latest?: string;
  /** Not before this day: it would arrive before the room is ready. */
  earliest?: string;
  /** The room is ready on this day (renovation). */
  ready?: string;
  /** Too late already: even ordered today it arrives after moving day. */
  late: boolean;
}

/** When to order something that is not ordered yet. */
export function orderAdvice(p: Project, i: Item): OrderAdvice {
  const move = renovationOf(p).moveDate;
  const ready = roomReady(p, i.roomId).date;
  const lead = i.leadDays;
  if (lead === undefined) return { ready, late: false };
  const latest = move ? addDays(move, -lead) : undefined;
  const earliest = ready ? addDays(ready, 1 - lead) : undefined;
  return { latest, earliest: earliest && earliest > today() ? earliest : undefined, ready, late: !!latest && latest < today() };
}

export type DeliveryIssue = "na-verhuizing" | "voor-klaar" | undefined;

/** A problem with an arriving delivery: after moving day, or before the room is ready. */
export function deliveryIssue(p: Project, i: Item, date: string): DeliveryIssue {
  const move = renovationOf(p).moveDate;
  if (move && date > move && (i.must || ["bedden", "banken", "tafels", "stoelen", "keuken", "sanitair"].includes(i.category))) return "na-verhuizing";
  const ready = roomReady(p, i.roomId).date;
  if (ready && date <= ready) return "voor-klaar";
  return undefined;
}

export interface DeliveryPlan {
  /** Not ordered yet, with a delivery time: order by… (soonest first). */
  toOrder: { item: Item; advice: OrderAdvice }[];
  /** Ordered, with an expected date (soonest first). */
  incoming: { item: Item; date: string; issue: DeliveryIssue }[];
  /** Ordered, but no date known. */
  undated: Item[];
  /** Chosen but no delivery time known: the plan cannot say when to order. */
  noLead: Item[];
  arrived: number;
}

export function deliveryPlan(p: Project): DeliveryPlan {
  const items = mainItems(p.items);
  const plan: DeliveryPlan = { toOrder: [], incoming: [], undated: [], noLead: [], arrived: 0 };
  for (const item of items) {
    if (item.status === "binnen") plan.arrived++;
    else if (item.status === "besteld") {
      const date = expectedDelivery(item);
      if (date) plan.incoming.push({ item, date, issue: deliveryIssue(p, item, date) });
      else plan.undated.push(item);
    } else if (item.leadDays !== undefined) plan.toOrder.push({ item, advice: orderAdvice(p, item) });
    else if (item.status === "gekozen") plan.noLead.push(item);
  }
  plan.toOrder.sort((a, b) => (a.advice.latest ?? "9999").localeCompare(b.advice.latest ?? "9999") || (b.item.leadDays ?? 0) - (a.item.leadDays ?? 0));
  plan.incoming.sort((a, b) => a.date.localeCompare(b.date));
  return plan;
}

/** Days until an order-by date is urgent. */
export const URGENT_DAYS = 7;
