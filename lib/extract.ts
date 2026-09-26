import { guessCategory, guessRoom } from "./categories";
import type { FundaResult, ProductInfo, RoomType } from "./types";

/** Minimal HTML helpers: we only need meta tags, JSON-LD and URLs, so no DOM parser. */

export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function attr(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i"));
  return m ? decodeEntities(m[2] ?? m[3] ?? "") : undefined;
}

/** All <meta> tags as a map of property/name -> content values (in document order). */
export function extractMeta(html: string): Map<string, string[]> {
  const meta = new Map<string, string[]>();
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const key = (attr(tag, "property") ?? attr(tag, "name") ?? attr(tag, "itemprop"))?.toLowerCase();
    const content = attr(tag, "content");
    if (!key || content === undefined) continue;
    meta.set(key, [...(meta.get(key) ?? []), content]);
  }
  return meta;
}

export function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decodeEntities(m[1]).replace(/\s+/g, " ").trim() : "";
}

type Json = Record<string, unknown>;

/** Every JSON-LD object on the page, with @graph arrays flattened. */
export function extractJsonLd(html: string): Json[] {
  const out: Json[] = [];
  const visit = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (node && typeof node === "object") {
      out.push(node as Json);
      const graph = (node as Json)["@graph"];
      if (graph) visit(graph);
    }
  };
  for (const m of html.matchAll(/<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      visit(JSON.parse(m[1].trim()));
    } catch {
      // Some shops ship invalid JSON-LD; ignore that block.
    }
  }
  return out;
}

const hasType = (node: Json, type: string) => {
  const t = node["@type"];
  return Array.isArray(t) ? t.includes(type) : t === type;
};

function asImageList(v: unknown): string[] {
  if (!v) return [];
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.flatMap(asImageList);
  if (typeof v === "object") {
    const o = v as Json;
    return asImageList(o.contentUrl ?? o.url);
  }
  return [];
}

function absolutize(u: string, base: string): string | null {
  try {
    const url = new URL(u.startsWith("//") ? `https:${u}` : u, base);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

const unique = <T,>(xs: T[]) => [...new Set(xs)];

// ---------------------------------------------------------------------------
// Funda

/**
 * Funda serves listing photos from cloud.funda.nl/valentina_media/<a>/<b>/<c>.jpg.
 * The same photo appears many times in different sizes (?options=width=...),
 * so we dedupe on the path and request one large size.
 */
const FUNDA_PHOTO = /https?:(?:\\?\/){2}cloud\.funda\.nl(?:\\?\/)valentina_media(?:(?:\\?\/)\d+){2,}(?:_\d+x\d+)?\.(?:jpe?g|png|webp)/gi;

export function extractFundaPhotos(html: string, width = 1440): string[] {
  const byPhoto = new Map<string, string>();
  for (const [raw] of html.matchAll(FUNDA_PHOTO)) {
    // URLs inside embedded JSON may have escaped slashes.
    const clean = raw.replace(/\\\//g, "/").replace(/^http:/, "https:");
    // Older URLs carry the size in the name (123_720x480.jpg); it is the same photo.
    const key = clean.replace(/_\d+x\d+(?=\.\w+$)/, "");
    if (!byPhoto.has(key)) byPhoto.set(key, clean);
  }
  return [...byPhoto.values()].map((p) => `${p}?options=width=${width}`);
}

export function parseFunda(html: string, pageUrl: string): FundaResult {
  const meta = extractMeta(html);
  let photos = extractFundaPhotos(html);
  if (photos.length === 0) {
    // Fallback for pages that only expose og:image / JSON-LD images.
    const ld = extractJsonLd(html).flatMap((n) => asImageList(n.image ?? n.photo));
    photos = unique([...(meta.get("og:image") ?? []), ...ld])
      .map((u) => absolutize(u, pageUrl))
      .filter((u): u is string => !!u);
  }
  const title = meta.get("og:title")?.[0] ?? extractTitle(html);
  return { title: title.replace(/\s*\|\s*funda\s*$/i, "").trim(), photos };
}

/** The numeric listing id at the end of a funda.nl detail URL (e.g. .../huis-straat-1/43117443/). */
export function fundaListingId(u: string): string | null {
  try {
    const ids = new URL(u).pathname.match(/\/(\d{7,9})(?=\/|$)/g);
    return ids ? ids[ids.length - 1].slice(1) : null;
  } catch {
    return null;
  }
}

/**
 * Parses the JSON of Funda's mobile-app API (listing-detail-page.funda.io), which,
 * unlike the website, is not behind a browser challenge. Media groups look like
 * { MediaBaseUrl: "https://cloud.funda.nl/valentina_media/{id}.jpg", Items: [{ Id, DisplayName }] }.
 */
export function parseFundaApi(data: unknown): FundaResult {
  const d = (data ?? {}) as Json;
  const media = (d.Media ?? {}) as Json;
  const photos: string[] = [];
  const rooms: Record<string, RoomType> = {};

  const collect = (group: unknown, fixedRoom?: RoomType) => {
    const g = (group ?? {}) as Json;
    const base = typeof g.MediaBaseUrl === "string" ? g.MediaBaseUrl : "";
    for (const item of (Array.isArray(g.Items) ? g.Items : []) as Json[]) {
      const id = item.Id == null ? "" : String(item.Id);
      if (!base || !id) continue;
      const url = base.replace("{id}", id).replace(/^http:/, "https:");
      if (photos.includes(url)) continue;
      photos.push(url);
      const room = fixedRoom ?? guessRoom(item.DisplayName as string | undefined);
      if (room) rooms[url] = room;
    }
  };
  collect(media.Photos);
  collect(media.FloorPlan ?? media.LegacyFloorPlan, "plattegrond");

  // Unknown shape? Fall back to any photo URL in the JSON.
  if (photos.length === 0) photos.push(...extractFundaPhotos(JSON.stringify(data)));

  const address = (d.AddressDetails ?? {}) as Json;
  const title = [address.Title, address.SubTitle].filter((x) => typeof x === "string" && x).join(", ");
  return { title, photos, rooms };
}

export function isFundaUrl(u: string): boolean {
  try {
    return /(^|\.)funda\.nl$/i.test(new URL(u).hostname);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Products

type Price = { price: string; priceValue: number };

function formatPrice(amount: unknown, currency: unknown): Price | undefined {
  const n = typeof amount === "number" ? amount : parseFloat(String(amount ?? "").replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return undefined;
  const cur = typeof currency === "string" && currency ? currency : "EUR";
  let price: string;
  try {
    price = new Intl.NumberFormat("nl-NL", { style: "currency", currency: cur }).format(n);
  } catch {
    price = `${cur} ${n.toFixed(2)}`;
  }
  return { price, priceValue: n };
}

function priceFromOffers(offers: unknown): Price | undefined {
  const list = Array.isArray(offers) ? offers : offers ? [offers] : [];
  for (const o of list as Json[]) {
    const p = formatPrice(o.price ?? o.lowPrice ?? (o.priceSpecification as Json | undefined)?.price, o.priceCurrency);
    if (p) return p;
  }
  return undefined;
}

export function shopName(pageUrl: string): string {
  const host = new URL(pageUrl).hostname.replace(/^www\d?\./, "");
  const name = host.split(".").slice(-2, -1)[0] ?? host;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function breadcrumbText(ld: Json[]): string {
  const crumbs = ld.filter((n) => hasType(n, "BreadcrumbList"));
  return crumbs
    .flatMap((c) => (Array.isArray(c.itemListElement) ? (c.itemListElement as Json[]) : []))
    .map((i) => String(i.name ?? (i.item as Json | undefined)?.name ?? ""))
    .join(" ");
}

/** Pulls a hex colour from paint product data if the shop exposes one. */
function extractColor(html: string, product: Json | undefined): string | undefined {
  const c = product?.color;
  if (typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c.trim())) return c.trim();
  const m = html.match(/["'](?:hex|colou?r(?:Hex|Code)?)["']\s*:\s*["'](#?[0-9a-f]{6})["']/i);
  return m ? `#${m[1].replace("#", "")}` : undefined;
}

export function parseProduct(html: string, pageUrl: string): ProductInfo {
  const meta = extractMeta(html);
  const ld = extractJsonLd(html);
  const product = ld.find((n) => hasType(n, "Product")) ?? ld.find((n) => hasType(n, "ProductGroup"));

  const title =
    (product?.name as string | undefined) ??
    meta.get("og:title")?.[0] ??
    meta.get("twitter:title")?.[0] ??
    extractTitle(html);

  const images = unique(
    [
      ...asImageList(product?.image),
      ...(meta.get("og:image") ?? []),
      ...(meta.get("og:image:secure_url") ?? []),
      ...(meta.get("twitter:image") ?? []),
    ]
      .map((u) => absolutize(u.trim(), pageUrl))
      .filter((u): u is string => !!u),
  );

  const price =
    priceFromOffers(product?.offers) ??
    formatPrice(
      meta.get("product:price:amount")?.[0] ?? meta.get("og:price:amount")?.[0],
      meta.get("product:price:currency")?.[0] ?? meta.get("og:price:currency")?.[0],
    );

  const brand = product?.brand;
  const brandName = typeof brand === "string" ? brand : ((brand as Json | undefined)?.name as string | undefined);

  const category = guessCategory(
    title,
    product?.category as string | undefined,
    breadcrumbText(ld),
    brandName,
    new URL(pageUrl).pathname.replace(/[-_/]/g, " "),
  );

  return {
    url: pageUrl,
    title: decodeEntities(String(title)).replace(/\s+/g, " ").trim() || shopName(pageUrl),
    image: images[0] ?? "",
    images,
    ...price,
    shop: shopName(pageUrl),
    category,
    color: category === "verf" ? extractColor(html, product) : undefined,
  };
}
