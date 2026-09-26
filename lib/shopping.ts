import { categoryLabel, roomLabel } from "./categories";
import type { Product, RoomType } from "./types";

export const euro = (n: number) => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(n);

/** "€ 1.299,95", "1299.95", "24,95" -> number (Dutch and English notation). */
export function parsePrice(text: string): number | undefined {
  const t = text.replace(/[^\d,.-]/g, "");
  if (!t) return undefined;
  const lastComma = t.lastIndexOf(",");
  const lastDot = t.lastIndexOf(".");
  const decimal = lastComma > lastDot ? "," : ".";
  const n = parseFloat(decimal === "," ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** All http(s) links in pasted text ("Bekijk dit op IKEA: https://…"), without trailing punctuation. */
export function extractLinks(text: string): string[] {
  return [...new Set((text.match(/https?:\/\/[^\s<>"']+/gi) ?? []).map((u) => u.replace(/[),.;!?]+$/, "")))];
}

/** Budget per room for the favourites (products without a room count as "Algemeen"). */
export function totalsPerRoom(products: Product[]): { room: RoomType | null; label: string; total: number; count: number }[] {
  const map = new Map<RoomType | null, { total: number; count: number }>();
  for (const p of products) {
    if (p.status !== "favoriet") continue;
    const key = p.room ?? null;
    const t = map.get(key) ?? { total: 0, count: 0 };
    t.total += p.priceValue ?? 0;
    t.count++;
    map.set(key, t);
  }
  return [...map.entries()]
    .map(([room, t]) => ({ room, label: room ? roomLabel(room) : "Algemeen", ...t }))
    .sort((a, b) => b.total - a.total);
}

/** Favourites as a plain-text list, ready to paste into WhatsApp or Notes. */
export function shoppingListText(products: Product[]): string {
  const favs = products.filter((p) => p.status === "favoriet");
  const lines = ["🛒 Boodschappenlijst", ""];
  for (const { room, label } of totalsPerRoom(products)) {
    lines.push(`— ${label} —`);
    for (const p of favs.filter((x) => (x.room ?? null) === room)) {
      lines.push(`• ${p.title} (${p.shop})${p.price ? ` — ${p.price}` : ""}${p.note ? ` — ${p.note}` : ""}`, `  ${p.url}`);
    }
    lines.push("");
  }
  lines.push(`Totaal: ${euro(favs.reduce((s, p) => s + (p.priceValue ?? 0), 0))}`);
  return lines.join("\n");
}

/** Favourites as CSV (opens in Excel/Numbers; ; as separator for Dutch Excel). */
export function shoppingListCsv(products: Product[]): string {
  const cell = (v: string | number | undefined) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = [["Product", "Winkel", "Soort", "Ruimte", "Prijs", "Notitie", "Link"].map(cell).join(";")];
  for (const p of products.filter((x) => x.status === "favoriet")) {
    rows.push(
      [p.title, p.shop, categoryLabel(p.category), p.room ? roomLabel(p.room) : "", p.priceValue?.toFixed(2).replace(".", ","), p.note, p.url]
        .map(cell)
        .join(";"),
    );
  }
  return "﻿" + rows.join("\n");
}
