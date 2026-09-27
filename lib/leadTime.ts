/** Delivery times as shops write them (used on the server when reading a product page). */

const UNITS: [RegExp, number, string, string][] = [
  [/^werkdag/, 7 / 5, "werkdag", "werkdagen"],
  [/^dag/, 1, "dag", "dagen"],
  [/^(week|weken|wk)/, 7, "week", "weken"],
  [/^maand/, 30, "maand", "maanden"],
];

/** "Levertijd: 4 - 6 weken", "Leverbaar binnen 3 werkdagen", "morgen in huis" → days (the longest). */
export function parseLeadTime(text: string): { days: number; text: string } | undefined {
  const t = text.replace(/\s+/g, " ");
  if (/\bmorgen (in huis|bezorgd|geleverd)|\bvandaag besteld,? morgen\b/i.test(t)) return { days: 1, text: "morgen in huis" };
  const m = t.match(
    /(levertijd|leverbaar (?:binnen|in)|geleverd (?:binnen|in)|bezorgd (?:binnen|in)|bezorgen|levering|in huis (?:binnen|in)|delivery time)[^0-9<>]{0,24}?(\d{1,2})(?:\s*(?:-|–|tot|à|a)\s*(\d{1,2}))?\s*(werkdagen|werkdag|dagen|dag|weken|week|wkn|wk|maanden|maand)\b/i,
  );
  if (!m) return undefined;
  const lo = Number(m[2]);
  const hi = m[3] ? Number(m[3]) : lo;
  const unit = UNITS.find(([re]) => re.test(m[4].toLowerCase()));
  if (!unit || !hi || hi < lo) return undefined;
  const days = Math.ceil(hi * unit[1]);
  if (days > 365) return undefined;
  return { days, text: `${lo === hi ? lo : `${lo} – ${hi}`} ${hi === 1 ? unit[2] : unit[3]}` };
}

/** schema.org: offers.deliveryLeadTime or offers.shippingDetails.deliveryTime. */
export function leadFromJsonLd(offers: unknown): { days: number; text: string } | undefined {
  const list = (Array.isArray(offers) ? offers : [offers]).filter((o): o is Record<string, unknown> => !!o && typeof o === "object");
  const days = (q: unknown): number | undefined => {
    if (!q || typeof q !== "object") return undefined;
    const v = q as { value?: unknown; maxValue?: unknown; unitCode?: unknown; unitText?: unknown };
    const n = Number(v.maxValue ?? v.value);
    if (!n) return undefined;
    const unit = String(v.unitCode ?? v.unitText ?? "DAY").toUpperCase();
    return Math.ceil(n * (unit.startsWith("WEE") || unit === "WK" ? 7 : unit.startsWith("MON") ? 30 : 1));
  };
  for (const o of list) {
    const direct = days(o.deliveryLeadTime);
    const ship = [o.shippingDetails].flat()[0] as { deliveryTime?: { handlingTime?: unknown; transitTime?: unknown } } | undefined;
    const viaShipping = ship?.deliveryTime ? (days(ship.deliveryTime.handlingTime) ?? 0) + (days(ship.deliveryTime.transitTime) ?? 0) : 0;
    const d = direct ?? (viaShipping || undefined);
    if (d && d <= 365) return { days: d, text: d % 7 === 0 && d >= 14 ? `${d / 7} weken` : `${d} dagen` };
  }
  return undefined;
}

/** A delivery time for display: "3 dagen", "6 weken". */
export const leadLabel = (days: number) => (days >= 14 && days % 7 === 0 ? `${days / 7} weken` : days === 1 ? "1 dag" : `${days} dagen`);

