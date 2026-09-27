import { guessCategory, guessRoom } from "./categories";
import { dimsFromJsonLd, dimsFromLabels, dimsFromNamedMeasures, dimsFromTitle, mergeDims, pageText } from "./dimensions";
import { leadFromJsonLd, parseLeadTime } from "./leadTime";
import type { FundaResult, HouseFacts, ProductInfo, RoomType } from "./types";

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
  const description = (d.ListingDescription as Json | undefined)?.Description;
  return { title, photos, rooms, facts: fundaFacts(d), description: typeof description === "string" ? description.slice(0, 6000) : undefined };
}

/** The facts buyers look at (asking price, m², bedrooms…), from the app API's quick view and "kenmerken". */
export function fundaFacts(d: Json): HouseFacts {
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const fast = (d.FastView ?? {}) as Json;
  const price = (d.Price ?? {}) as Json;
  const address = (d.AddressDetails ?? {}) as Json;
  // Kenmerken are nested sections of { Id, Label, Value, KenmerkenList }.
  const byId = new Map<string, string>();
  const walk = (list: unknown) => {
    for (const k of (Array.isArray(list) ? list : []) as Json[]) {
      if (typeof k.Id === "string" && typeof k.Value === "string") byId.set(k.Id, k.Value);
      walk(k.KenmerkenList);
    }
  };
  for (const section of (Array.isArray(d.KenmerkSections) ? d.KenmerkSections : []) as Json[]) walk(section.KenmerkenList);
  const facts: HouseFacts = {
    price: str(price.SellingPrice),
    livingArea: str(fast.LivingArea),
    plotArea: str(fast.PlotArea),
    bedrooms: str(fast.NumberOfBedrooms),
    energyLabel: str(fast.EnergyLabel),
    rooms: str(byId.get("indeling-totalrooms")),
    bathrooms: str(byId.get("indeling-totalbathroom")),
    stories: str(byId.get("indeling-totalstories")),
    buildYear: str(byId.get("bouw-bouwjaar")),
    kind: str(byId.get("bouw-soortobject")),
    city: str(address.City),
    neighborhood: str(address.NeighborhoodName),
  };
  return Object.fromEntries(Object.entries(facts).filter(([, v]) => v)) as HouseFacts;
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

/** Logos, icons, placeholders and tracking pixels: never the product photo. */
const JUNK_IMAGE = /(logo|favicon|sprite|icon|placeholder|no[-_]?image|blank|spacer|pixel|badge|banner|payment|social|share[-_]?default)/i;

/**
 * Many shops put a thumbnail URL in their meta tags. Ask their image CDN for a
 * large version instead: Shopify (_200x.jpg), IKEA (?f=xs), and the common
 * width/height query parameters.
 */
export function largeImageUrl(u: string): string {
  let out = u;
  try {
    let url = new URL(out);
    if (/(^|\.)shopify\.com$/i.test(url.hostname) || url.pathname.includes("/cdn/shop/")) {
      url = new URL(u.replace(/_(\d{2,4}x\d{0,4}|x\d{2,4})(?=(@2x)?\.(jpe?g|png|webp)(\?|$))/i, ""));
    }
    // Signed URLs (imgix, Cloudinary tokens) break when a parameter changes.
    if (["s", "sig", "signature", "token"].some((k) => url.searchParams.has(k))) return u;
    if (/ikea\.com$/i.test(url.hostname) && url.searchParams.has("f")) url.searchParams.set("f", "xl");
    // Size in a folder name (Praxis and others on CloudFront): /products/1/s01/424x424/origin.webp
    if (/cloudfront\.net$/i.test(url.hostname)) url.pathname = url.pathname.replace(/\/(\d{2,3})x(\d{2,3})\//, (all, a, b) => (Number(a) < 1000 && Number(b) < 1000 ? "/1400x1400/" : all));
    for (const k of ["width", "w", "wid", "imwidth"]) {
      const v = Number(url.searchParams.get(k));
      if (v && v < 1000) url.searchParams.set(k, "1200");
    }
    for (const k of ["height", "h", "hei"]) {
      const v = Number(url.searchParams.get(k));
      if (v && v < 1000) url.searchParams.delete(k);
    }
    out = url.toString();
  } catch {
    // keep as is
  }
  return out;
}

/** Candidate image URLs cleaned up: absolute, no logos/SVGs/GIFs, large versions, deduplicated. */
export function productImages(candidates: string[], pageUrl: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  // The original (smaller) URLs go last: a fallback should the large version not exist.
  const originals: string[] = [];
  for (const raw of candidates) {
    const abs = absolutize(decodeEntities(raw.trim()), pageUrl);
    if (!abs) continue;
    const path = new URL(abs).pathname;
    if (/\.(svg|gif|ico)$/i.test(path) || JUNK_IMAGE.test(path)) continue;
    const big = largeImageUrl(abs);
    // The same photo in another size counts once.
    const key = big.replace(/[?#].*$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(big);
    if (big !== abs) originals.push(abs);
  }
  return [...out, ...originals];
}

/** <link rel="image_src"> and <img itemprop="image"> (older shop templates). */
function linkImages(html: string): string[] {
  const out: string[] = [];
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) if (/image_src/i.test(attr(tag, "rel") ?? "")) out.push(attr(tag, "href") ?? "");
  for (const [tag] of html.matchAll(/<img\b[^>]*>/gi)) {
    if (!/^image$/i.test(attr(tag, "itemprop") ?? "")) continue;
    const srcset = attr(tag, "srcset") ?? attr(tag, "data-srcset");
    const largest = srcset?.split(",").map((s) => s.trim().split(/\s+/)[0]).at(-1);
    out.push(largest || attr(tag, "data-src") || attr(tag, "src") || "");
  }
  return out.filter(Boolean);
}

/** "Kleur van het Jaar 2025 | True Joy™ | Flexa" → "Kleur van het Jaar 2025 | True Joy™": the shop's name is shown anyway. */
export function withoutShopName(title: string, shop: string): string {
  const parts = title.split(/\s+[|–—-]\s+/);
  while (parts.length > 1 && parts[parts.length - 1].toLowerCase().replace(/[^a-z0-9]/g, "").includes(shop.toLowerCase().replace(/[^a-z0-9]/g, ""))) parts.pop();
  return parts.join(" | ") === title ? title : title.slice(0, title.lastIndexOf(parts[parts.length - 1]) + parts[parts.length - 1].length);
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

  const variants = Array.isArray(product?.hasVariant) ? (product!.hasVariant as Json[]) : [];
  const images = productImages(
    [
      ...asImageList(product?.image),
      ...variants.flatMap((v) => asImageList(v.image)),
      ...(meta.get("og:image") ?? []),
      ...(meta.get("og:image:secure_url") ?? []),
      ...(meta.get("twitter:image") ?? []),
      ...(meta.get("twitter:image:src") ?? []),
      ...(meta.get("image") ?? []),
      ...linkImages(html),
    ],
    pageUrl,
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

  const cleanTitle = withoutShopName(decodeEntities(String(title)).replace(/\s+/g, " ").trim(), shopName(pageUrl));
  const dims = mergeDims(
    dimsFromJsonLd(product),
    dimsFromNamedMeasures(html),
    dimsFromLabels(pageText(html)),
    dimsFromTitle(cleanTitle),
    dimsFromTitle(String(product?.description ?? meta.get("og:description")?.[0] ?? "")),
  );

  // Delivery time: structured data first, else the page's own words ("Levertijd: 4 - 6 weken").
  const lead = leadFromJsonLd(product?.offers) ?? leadFromJsonLd(variants.map((v) => v.offers).flat()) ?? parseLeadTime(pageText(html));

  return {
    url: pageUrl,
    dims,
    leadDays: lead?.days,
    leadText: lead?.text,
    title: cleanTitle || shopName(pageUrl),
    image: images[0] ?? "",
    images,
    ...price,
    shop: shopName(pageUrl),
    category,
    color: category === "verf" ? extractColor(html, product) : undefined,
  };
}
