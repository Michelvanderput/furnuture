import { newId } from "./rooms";
import type { Item, ProductInfo } from "./types";

/** Same product page, ignoring tracking parameters and a trailing slash. */
export const sameLink = (a: string, b: string) =>
  a.replace(/[?#].*$/, "").replace(/\/$/, "") === b.replace(/[?#].*$/, "").replace(/\/$/, "");

export class ProductError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function readProduct(url: string): Promise<ProductInfo> {
  const res = await fetch("/api/product", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url }),
  });
  const data = (await res.json().catch(() => ({}))) as ProductInfo & { error?: string };
  if (!res.ok) throw new ProductError(data.error ?? "Ophalen mislukt", res.status);
  return data;
}

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

/**
 * A webshop link as an item (title, photo, price, size, category). When the shop
 * blocks us the link is kept anyway (with `error`): fill it in by hand or from a screenshot.
 */
export async function itemFromLink(url: string, roomId: string | null): Promise<{ item: Item; error?: string }> {
  const base: Item = { id: newId(), roomId, title: host(url), url, images: [], qty: 1, category: "overig", status: "idee", note: "", addedAt: Date.now(), source: "link" };
  try {
    const p = await readProduct(url);
    return {
      item: {
        ...base,
        url: p.url || url,
        title: p.title || base.title,
        image: p.image || undefined,
        images: p.images ?? [],
        shop: p.shop,
        price: p.priceValue,
        category: p.category,
        dims: p.dims,
        color: p.color,
        priceHistory: p.priceValue ? [{ at: new Date().toISOString().slice(0, 10), value: p.priceValue }] : undefined,
      },
    };
  } catch (e) {
    return { item: { ...base, shop: host(url) }, error: `${host(url)}: ${e instanceof Error ? e.message : e}` };
  }
}

/** The shop's current price; the item with it (and the old one in its history), or null when unchanged or unknown. */
export async function refreshPrice(item: Item): Promise<Item | null> {
  if (!item.url) return null;
  const p = await readProduct(item.url);
  if (!p.priceValue || p.priceValue === item.price) return null;
  const history = [...(item.priceHistory ?? (item.price ? [{ at: "", value: item.price }] : [])), { at: new Date().toISOString().slice(0, 10), value: p.priceValue }];
  return { ...item, price: p.priceValue, priceHistory: history.slice(-10) };
}

/** Price change since the first price seen (negative = cheaper now). */
export function priceChange(item: Item): number | null {
  const h = item.priceHistory;
  if (!h || h.length < 2 || item.price === undefined) return null;
  const diff = item.price - h[0].value;
  return Math.abs(diff) >= 0.5 ? diff : null;
}

/** A product found on the web, read from the shop's own page where possible. */
export interface Found {
  title: string;
  shop: string;
  url: string;
  why: string;
  price?: number;
  image?: string;
  images: string[];
  dims?: Item["dims"];
  category?: Item["category"];
  /** Read from the shop's page (photo and price are real), not only the AI's word. */
  verified: boolean;
}

/**
 * Reads the pages of products the AI found, all at once: photo, current price and size
 * come from the shop itself. Links that do not lead to a product (gone, or made up)
 * are dropped; a shop that blocks us keeps the AI's data, without photo.
 */
export async function verifyFound(options: { title: string; shop: string; url: string; why: string; price?: number }[]): Promise<Found[]> {
  const results = await Promise.all(
    options.map(async (o): Promise<Found | null> => {
      try {
        const p = await readProduct(o.url);
        return { ...o, title: p.title || o.title, shop: p.shop || o.shop, url: p.url || o.url, price: p.priceValue ?? o.price, image: p.image, images: p.images ?? [], dims: p.dims, category: p.category, verified: true };
      } catch (e) {
        // 404 / not a product page: a dead or invented link.
        if (e instanceof ProductError && (e.status === 400 || e.status === 404 || e.status === 410 || e.status === 422)) return null;
        return { ...o, images: [], verified: false };
      }
    }),
  );
  const found = results.filter((f): f is Found => !!f);
  // With photo first.
  return [...found.filter((f) => f.image), ...found.filter((f) => !f.image)];
}
