import { categoryLabel } from "./categories";
import type { Item, ItemStatus, Project, Room, RoomType } from "./types";

export const euro = (n: number, cents = false) =>
  new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 }).format(n);

/** "€ 1.299,95", "1299.95", "24,95" -> number (Dutch and English notation). */
export function parsePrice(text: string): number | undefined {
  const t = text.replace(/[^\d,.-]/g, "");
  if (!t) return undefined;
  const lastComma = t.lastIndexOf(",");
  const lastDot = t.lastIndexOf(".");
  // "1.299" is thousands, "12.99" is cents.
  const decimal = lastComma > lastDot ? "," : lastDot >= 0 && t.length - lastDot - 1 === 3 && lastComma < 0 ? "none" : ".";
  const clean = decimal === "," ? t.replace(/\./g, "").replace(",", ".") : decimal === "none" ? t.replace(/\./g, "") : t.replace(/,/g, "");
  const n = parseFloat(clean);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** All http(s) links in pasted text ("Bekijk dit op IKEA: https://…"), without trailing punctuation. */
export function extractLinks(text: string): string[] {
  return [...new Set((text.match(/https?:\/\/[^\s<>"']+/gi) ?? []).map((u) => u.replace(/[),.;!?]+$/, "")))];
}

export const STATUS: { id: ItemStatus; label: string; emoji: string }[] = [
  { id: "idee", label: "Idee", emoji: "💡" },
  { id: "gekozen", label: "Gekozen", emoji: "💚" },
  { id: "besteld", label: "Besteld", emoji: "📦" },
  { id: "binnen", label: "In huis", emoji: "✅" },
];
export const statusLabel = (s: ItemStatus) => STATUS.find((x) => x.id === s)!;
export const nextStatus = (s: ItemStatus): ItemStatus => STATUS[(STATUS.findIndex((x) => x.id === s) + 1) % STATUS.length].id;
export const isBought = (i: Item) => i.status === "besteld" || i.status === "binnen";

/** What one line costs (price × quantity), and whether that is only an estimate. */
export function lineCost(i: Item): { value: number; estimate: boolean; known: boolean } {
  if (i.price !== undefined) return { value: i.price * i.qty, estimate: false, known: true };
  if (i.estimate !== undefined) return { value: i.estimate * i.qty, estimate: true, known: true };
  return { value: 0, estimate: false, known: false };
}

/** Items that count: alternatives are options for another item, not extra purchases. */
export const mainItems = (items: Item[]) => items.filter((i) => !i.alternativeOf);
export const alternativesOf = (items: Item[], id: string) => items.filter((i) => i.alternativeOf === id);

export interface Totals {
  /** Everything planned (known prices plus estimates). */
  planned: number;
  /** Part of `planned` that is only estimated. */
  estimated: number;
  /** Ordered or in the house. */
  spent: number;
  count: number;
  bought: number;
  /** Lines without any price. */
  unpriced: number;
  must: number;
}

export function totals(items: Item[]): Totals {
  const t: Totals = { planned: 0, estimated: 0, spent: 0, count: 0, bought: 0, unpriced: 0, must: 0 };
  for (const i of mainItems(items)) {
    const c = lineCost(i);
    t.count++;
    t.planned += c.value;
    if (c.estimate) t.estimated += c.value;
    if (!c.known) t.unpriced++;
    if (isBought(i)) (t.spent += c.value), t.bought++;
    if (i.must) t.must += c.value;
  }
  return t;
}

export const itemsIn = (items: Item[], roomId: string | null) => items.filter((i) => i.roomId === roomId);

/** Items per shop (for ordering in one go), biggest spend first. */
export function byShop(items: Item[]): { shop: string; items: Item[]; total: number }[] {
  const map = new Map<string, Item[]>();
  for (const i of mainItems(items)) {
    const shop = i.shop || (i.url ? "Overig" : "Nog te vinden");
    map.set(shop, [...(map.get(shop) ?? []), i]);
  }
  return [...map.entries()]
    .map(([shop, list]) => ({ shop, items: list, total: list.reduce((n, i) => n + lineCost(i).value, 0) }))
    .sort((a, b) => (a.shop === "Nog te vinden" ? 1 : b.shop === "Nog te vinden" ? -1 : b.total - a.total));
}

/** How a total budget is usually spread over rooms (share per room type, normalised over the rooms there are). */
const SHARE: Record<RoomType, number> = {
  woonkamer: 30,
  keuken: 8,
  slaapkamer: 12,
  badkamer: 5,
  toilet: 1.5,
  hal: 4,
  werkkamer: 8,
  zolder: 4,
  tuin: 8,
  buitenkant: 0,
  plattegrond: 0,
  overig: 4,
};
/** A budget split over the rooms, rounded to tens. The main bedroom gets a bit more. */
export function suggestSplit(budget: number, rooms: Room[]): Record<string, number> {
  const weight = (r: Room, i: number) => SHARE[r.type] * (r.type === "slaapkamer" && rooms.findIndex((x) => x.type === "slaapkamer") === i ? 1.4 : 1);
  const sum = rooms.reduce((n, r, i) => n + weight(r, i), 0) || 1;
  return Object.fromEntries(rooms.map((r, i) => [r.id, Math.round((budget * weight(r, i)) / sum / 10) * 10]));
}

const priceText = (i: Item) => {
  const c = lineCost(i);
  if (!c.known) return "prijs onbekend";
  return `${c.estimate ? "± " : ""}${euro(c.value, !c.estimate)}${i.qty > 1 ? ` (${i.qty}×)` : ""}`;
};

/** The whole plan as plain text, ready to paste into WhatsApp or Notes. */
export function planText(project: Project, onlyToBuy = false): string {
  const lines = [`🏡 ${project.listing?.title ?? "Ons nieuwe huis"} — inkooplijst`, ""];
  const groups: { name: string; items: Item[] }[] = [
    ...project.rooms.map((r) => ({ name: r.name, items: itemsIn(project.items, r.id) })),
    { name: "Nog geen kamer", items: itemsIn(project.items, null) },
  ];
  for (const g of groups) {
    const list = mainItems(g.items).filter((i) => !onlyToBuy || !isBought(i));
    if (!list.length) continue;
    lines.push(`— ${g.name} (${euro(totals(list).planned)}) —`);
    for (const i of list) {
      lines.push(`${i.status === "binnen" ? "✅" : i.status === "besteld" ? "📦" : "☐"} ${i.title}${i.shop ? ` · ${i.shop}` : ""} — ${priceText(i)}`);
      if (i.url) lines.push(`   ${i.url}`);
    }
    lines.push("");
  }
  const t = totals(project.items);
  lines.push(`Totaal: ${euro(t.planned)}${t.estimated ? ` (waarvan ± ${euro(t.estimated)} geschat)` : ""}`);
  if (project.budget) lines.push(`Budget: ${euro(project.budget)} · nog over: ${euro(project.budget - t.planned)}`);
  return lines.join("\n");
}

/** The plan as CSV (opens in Excel/Numbers; ; as separator for Dutch Excel). */
export function planCsv(project: Project): string {
  const cell = (v: string | number | undefined) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const num = (n: number | undefined) => (n === undefined ? "" : n.toFixed(2).replace(".", ","));
  const room = (id: string | null) => project.rooms.find((r) => r.id === id)?.name ?? "";
  const rows = [["Kamer", "Product", "Winkel", "Soort", "Status", "Aantal", "Prijs per stuk", "Schatting", "Totaal", "Must-have", "Notitie", "Link"].map(cell).join(";")];
  for (const i of mainItems(project.items)) {
    rows.push(
      [room(i.roomId), i.title, i.shop, categoryLabel(i.category), statusLabel(i.status).label, i.qty, num(i.price), num(i.estimate), num(lineCost(i).value), i.must ? "ja" : "", i.note, i.url]
        .map((v) => cell(v))
        .join(";"),
    );
  }
  return "﻿" + rows.join("\n");
}
