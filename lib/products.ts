import { guessCategory } from "./categories";
import { shopName } from "./extract";
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

/**
 * A readable name from the link itself, for shops that do not let us read the page:
 * ".../assortiment/karwei-binnenlak-zijdeglans-750-ml/p/B455123" → "Karwei binnenlak zijdeglans 750 ml".
 */
export function titleFromUrl(url: string): string | undefined {
  try {
    const segs = new URL(url).pathname.split("/").map((s) => decodeURIComponent(s)).filter(Boolean);
    const best = segs.filter((s) => /[a-z]{3}/i.test(s) && /[-_]/.test(s)).sort((a, b) => b.length - a.length)[0];
    if (!best) return undefined;
    const words = best
      .replace(/\.(html?|aspx?|php)$/i, "")
      .replace(/[-_+]+/g, " ")
      .replace(/\b[a-z]{0,2}\d{5,}\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    return words.length >= 4 ? words.charAt(0).toUpperCase() + words.slice(1) : undefined;
  } catch {
    return undefined;
  }
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
export async function itemFromLink(url: string, roomId: string | null): Promise<{ item: Item; error?: string; notAProduct?: boolean; blocked?: boolean }> {
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
        leadDays: p.leadDays,
        leadText: p.leadText,
        priceHistory: p.priceValue ? [{ at: new Date().toISOString().slice(0, 10), value: p.priceValue }] : undefined,
      },
    };
  } catch (e) {
    // A dead link, or not a product page: nothing worth keeping.
    const notAProduct = e instanceof ProductError && [400, 404, 410, 422].includes(e.status);
    // Otherwise keep what the link itself tells: the shop, a name and so the kind of product.
    let shop = host(url);
    try {
      shop = shopName(url);
    } catch {
      // keep the host
    }
    const title = titleFromUrl(url) ?? base.title;
    const blocked = e instanceof ProductError && e.status === 403;
    return {
      item: { ...base, title, shop, category: guessCategory(title) },
      error: blocked
        ? `${shop} laat de pagina niet automatisch uitlezen. De naam komt uit de link: vul de prijs zelf in, of gebruik de knop "Product naar furnuture" hieronder.`
        : `${shop}: ${e instanceof Error ? e.message : e}`,
      notAProduct,
      blocked,
    };
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
