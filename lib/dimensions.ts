import type { Dims } from "./types";

/**
 * Product sizes from webshop pages. Shops put them in different places:
 * JSON-LD (width/depth/height), a specifications table ("Breedte: 220 cm"),
 * or the title ("Bank 3-zits 220x95x80 cm", "Bed 160x200").
 */

const toCm = (value: number, unit: string | undefined): number => {
  const u = (unit ?? "cm").toLowerCase();
  if (u === "mm" || u === "mmt") return value / 10;
  if (u === "m" || u === "mtr") return value * 100;
  return value;
};

const num = (s: string) => parseFloat(s.replace(/\s/g, "").replace(",", "."));
const round = (n: number) => Math.round(n * 10) / 10;
const sane = (n: number | undefined) => (n !== undefined && Number.isFinite(n) && n >= 1 && n <= 2000 ? round(n) : undefined);

type Quantity = { value?: unknown; unitCode?: string; unitText?: string } | string | number | undefined;

/** schema.org QuantitativeValue, "220 cm" or a bare number (cm). */
function quantity(q: Quantity): number | undefined {
  if (q === undefined || q === null) return undefined;
  if (typeof q === "number") return q;
  if (typeof q === "string") {
    const m = q.match(/([\d.,]+)\s*(mm|cm|m)?\b/i);
    return m ? toCm(num(m[1]), m[2]) : undefined;
  }
  const v = typeof q.value === "number" ? q.value : typeof q.value === "string" ? num(q.value) : NaN;
  if (!Number.isFinite(v)) return undefined;
  const unit = (q.unitCode ?? q.unitText ?? "cm").toLowerCase();
  return toCm(v, unit === "cmt" ? "cm" : unit === "mmt" ? "mm" : unit === "mtr" ? "m" : unit);
}

export function dimsFromJsonLd(product: Record<string, unknown> | undefined): Dims {
  if (!product) return {};
  return {
    w: sane(quantity(product.width as Quantity)),
    d: sane(quantity((product.depth ?? product.length) as Quantity)),
    h: sane(quantity(product.height as Quantity)),
  };
}

const LABELS: [keyof Dims, RegExp][] = [
  ["w", /\b(?:breedte|width|b)\s*[:=]?\s*([\d.,]+)\s*(mm|cm|m)\b/i],
  ["d", /\b(?:diepte|depth|lengte|length|d|l)\s*[:=]?\s*([\d.,]+)\s*(mm|cm|m)\b/i],
  ["h", /\b(?:hoogte|height|h)\s*[:=]?\s*([\d.,]+)\s*(mm|cm|m)\b/i],
];

/** "Breedte: 220 cm", "Diepte 95cm", "Hoogte: 0,8 m" in specification text. */
export function dimsFromLabels(text: string): Dims {
  const out: Dims = {};
  for (const [key, re] of LABELS) {
    const m = text.match(re);
    if (m) out[key] = sane(toCm(num(m[1]), m[2]));
  }
  return out;
}

/** "220x95x80 cm", "B220 x D95 x H80", "160 x 200" (bed: width × length). */
export function dimsFromTitle(text: string): Dims {
  const lettered = text.match(/\bB\s*([\d.,]+)\s*[x×*]\s*D\s*([\d.,]+)(?:\s*[x×*]\s*H\s*([\d.,]+))?\s*(mm|cm|m)?/i);
  if (lettered) {
    const [, w, d, h, unit] = lettered;
    return { w: sane(toCm(num(w), unit)), d: sane(toCm(num(d), unit)), h: h ? sane(toCm(num(h), unit)) : undefined };
  }
  const m = text.match(/(\d+(?:[.,]\d+)?)\s*[x×*]\s*(\d+(?:[.,]\d+)?)(?:\s*[x×*]\s*(\d+(?:[.,]\d+)?))?\s*(mm|cm|m)?\b/i);
  if (!m) return {};
  const [, a, b, c, unit] = m;
  const vals = [a, b, c].filter(Boolean).map((v) => toCm(num(v!), unit));
  // Two numbers (beds, rugs, tables): width × length.
  return vals.length === 2 ? { w: sane(vals[0]), d: sane(vals[1]) } : { w: sane(vals[0]), d: sane(vals[1]), h: sane(vals[2]) };
}

/** First known value wins, per dimension. */
export function mergeDims(...list: Dims[]): Dims | undefined {
  const out: Dims = {};
  for (const d of list) for (const k of ["w", "d", "h"] as const) out[k] ??= d[k];
  return out.w || out.d || out.h ? out : undefined;
}

/** Visible text of an HTML page (for the specifications), capped for speed. */
export function pageText(html: string): string {
  return html
    .slice(0, 1_500_000)
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/\s+/g, " ");
}

export const formatDims = (d?: Dims) =>
  d && (d.w || d.d || d.h) ? `${[d.w, d.d, d.h].map((v) => (v ? Math.round(v) : "?")).join(" × ")} cm` : "";
