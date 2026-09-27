import { fingerprint, getCached, putCached } from "./aiCache";
import { CATEGORIES, categoryLabel } from "./categories";
import { falRun, FalError, VISION, type Progress } from "./fal";
import { FURNISHABLE, newId } from "./rooms";
import { lineCost } from "./shopping";
import type { Category, Dims, Item, Listing, Project, Room, RoomType } from "./types";

/**
 * The AI helpers. One fast vision-language model (Gemini Flash via fal) reads photos,
 * floor plans, screenshots and the list, and answers in JSON. Every answer is cached
 * under its question: asking the same again is free and instant.
 */

const LLM = "google/gemini-2.5-flash";

interface Ask {
  prompt: string;
  system?: string;
  images?: string[];
  web?: boolean;
  maxTokens?: number;
}

/** Asks the model; the answer's JSON object, cached under `key` (plus the question itself). */
async function ask<T>(key: string, q: Ask, label: string, onProgress?: Progress): Promise<T> {
  const cacheKey = `ai1:${key}:${fingerprint(JSON.stringify(q))}`;
  const hit = await getCached<T>(cacheKey);
  if (hit) return hit;
  const out = await falRun<{ output?: string }>(
    VISION,
    {
      model: LLM,
      system_prompt: q.system ?? SYSTEM,
      prompt: q.prompt,
      ...(q.images?.length ? { image_urls: q.images } : {}),
      ...(q.web ? { enable_web_search: true } : {}),
      max_tokens: q.maxTokens ?? 1500,
      temperature: 0.2,
    },
    onProgress,
    label,
    120_000,
  );
  const value = parseJson<T>(out.output ?? "");
  putCached(cacheKey, value);
  return value;
}

const SYSTEM =
  "You are a friendly, practical Dutch interior advisor helping people who just bought a house to plan what to buy per room. " +
  "You always answer with one JSON object only, no markdown. All texts for the user are in Dutch, short and concrete. Prices are in euros at typical Dutch shops (IKEA, JYSK, Leen Bakker, Kwantum, Loods 5, bol, Karwei, Praxis, Gamma, vtwonen, Fonq).";

/** The JSON object in a model answer (it sometimes wraps it in ```json fences or text). */
export function parseJson<T>(text: string): T {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new FalError("De AI gaf geen bruikbaar antwoord. Probeer het nog eens.");
  try {
    return JSON.parse(text.slice(start, end + 1)) as T;
  } catch {
    throw new FalError("De AI gaf geen bruikbaar antwoord. Probeer het nog eens.");
  }
}

/** A Funda photo at a small size: at most 384 px counts as one cheap image tile for the model. */
export function smallPhoto(url: string, width = 384): string | null {
  if (/cloud\.funda\.nl/.test(url)) return url.replace(/\?.*$/, "") + `?options=width=${width}`;
  if (/^https?:/.test(url)) return url;
  // Uploaded photos (data URLs) only when small enough to send along.
  return url.length < 400_000 ? url : null;
}

const TYPES = FURNISHABLE.join(", ");
const CATS = CATEGORIES.map((c) => c.id).join(", ");
const asType = (t: unknown): RoomType => (FURNISHABLE.includes(t as RoomType) ? (t as RoomType) : "overig");
const asCategory = (c: unknown): Category => (CATEGORIES.some((x) => x.id === c) ? (c as Category) : "overig");
const num = (n: unknown) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.round(n) : undefined);
const text = (s: unknown, max = 200) => (typeof s === "string" ? s.trim().slice(0, max) : "");

function factsText(listing: Listing | null): string {
  const f = listing?.facts ?? {};
  return [
    listing?.title && `Adres: ${listing.title}`,
    f.kind && `Soort: ${f.kind}`,
    f.livingArea && `Woonoppervlakte: ${f.livingArea}`,
    f.rooms && `Kamers: ${f.rooms}`,
    f.bathrooms && `Badkamers: ${f.bathrooms}`,
    f.stories && `Woonlagen: ${f.stories}`,
    f.buildYear && `Bouwjaar: ${f.buildYear}`,
  ]
    .filter(Boolean)
    .join("\n");
}

// ---------------------------------------------------------------------------
// 1. The rooms of the house, from the photos, floor plans and description

export interface RoomProposal {
  rooms: (Room & { photoIdx: number[] })[];
  /** Photo index -> what it shows. */
  photoTypes: Record<number, RoomType | "buitenkant" | "plattegrond">;
}

export async function aiRooms(listing: Listing, onProgress?: Progress): Promise<RoomProposal> {
  const photos = listing.photos.filter((p) => p.room !== "plattegrond").slice(0, 34);
  const plans = listing.photos.filter((p) => p.room === "plattegrond").slice(0, 4);
  const photoUrls = photos.map((p) => smallPhoto(p.url));
  const planUrls = plans.map((p) => smallPhoto(p.url, 1200)).filter((u): u is string => !!u);
  const sent = photoUrls.map((u, i) => ({ u, i })).filter((x): x is { u: string; i: number } => !!x.u);
  const prompt =
    `${factsText(listing)}\n\nOmschrijving van de makelaar:\n${(listing.description ?? "").slice(0, 3500)}\n\n` +
    `Hierbij ${sent.length} foto's van de woning (in deze volgorde genummerd 0 t/m ${sent.length - 1})` +
    (planUrls.length ? ` en daarna ${planUrls.length} plattegrond(en).` : ".") +
    "\n\nBepaal welke ruimtes deze woning heeft die ingericht moeten worden (per verdieping, van beneden naar boven). " +
    "Gebruik de plattegrond en omschrijving voor namen, verdieping en m² (alleen als je het kunt aflezen of berekenen, anders null). " +
    "Geef elke slaapkamer een eigen ruimte. Alleen ruimtes van deze woning zelf (met eigen tuin, balkon, berging of garage), niet de straat, de buurt of een speeltuin. Koppel elke foto aan de ruimte die hij toont." +
    `\nAntwoord als JSON: {"rooms":[{"name":"Woonkamer","type":"woonkamer","floor":"Begane grond","area_m2":32,"photos":[0,3],"note":"open keuken, grote tuindeuren op het zuiden"}],"photo_types":["woonkamer","buitenkant",…]}` +
    `\n"type" is een van: ${TYPES}. "photo_types" heeft per foto (in volgorde) een van: ${TYPES}, buitenkant, plattegrond. "note": max 12 woorden over wat handig is om te weten bij het inrichten.`;
  type Answer = { rooms?: { name?: unknown; type?: unknown; floor?: unknown; area_m2?: unknown; photos?: unknown; note?: unknown }[]; photo_types?: unknown[] };
  const a = await ask<Answer>(`rooms:${fingerprint(listing.url + listing.photos.length)}`, { prompt, images: [...sent.map((x) => x.u), ...planUrls], maxTokens: 2500 }, "✨ Kamers herkennen", onProgress);
  const rooms = (a.rooms ?? [])
    .filter((r) => text(r.name))
    .slice(0, 20)
    .map((r) => ({
      id: newId(),
      name: text(r.name, 40),
      type: asType(r.type),
      floor: text(r.floor, 30) || undefined,
      area: num(r.area_m2),
      note: text(r.note, 120) || undefined,
      // Answer indices are of the photos sent; map them back to listing photos.
      photoIdx: (Array.isArray(r.photos) ? r.photos : []).map(Number).filter((i) => sent[i]).map((i) => sent[i].i),
    }));
  if (!rooms.length) throw new FalError("De AI vond geen kamers. Probeer het nog eens.");
  const photoTypes: RoomProposal["photoTypes"] = {};
  (a.photo_types ?? []).forEach((t, i) => {
    if (!sent[i]) return;
    photoTypes[sent[i].i] = t === "buitenkant" || t === "plattegrond" ? t : asType(t);
  });
  return { rooms, photoTypes };
}

/**
 * Applies a proposal: rooms of the same kind keep their id (and so their items and
 * budget, in order: the first bedroom stays the first), rooms that still hold items
 * are kept, and every photo moves to the room the AI saw in it.
 */
export function applyRooms(project: Project, proposal: RoomProposal): Project {
  const old = [...project.rooms];
  const photos = project.listing?.photos.filter((p) => p.room !== "plattegrond").slice(0, 34) ?? [];
  const rooms: Room[] = proposal.rooms.map(({ photoIdx: _, ...r }) => {
    const i = old.findIndex((o) => o.type === r.type);
    if (i < 0) return r;
    const [match] = old.splice(i, 1);
    return { ...r, id: match.id, budget: match.budget, name: r.name };
  });
  const keep = old.filter((o) => project.items.some((it) => it.roomId === o.id));
  const allRooms = [...rooms, ...keep];
  const photoRoom = new Map<string, string>();
  proposal.rooms.forEach((r, i) => r.photoIdx.forEach((idx) => photos[idx] && photoRoom.set(photos[idx].id, rooms[i].id)));
  const typeOf = new Map<string, RoomType>();
  Object.entries(proposal.photoTypes).forEach(([idx, t]) => photos[+idx] && typeOf.set(photos[+idx].id, t));
  return {
    ...project,
    rooms: allRooms,
    listing: project.listing && {
      ...project.listing,
      photos: project.listing.photos.map((p) => ({ ...p, room: typeOf.get(p.id) ?? p.room, roomId: photoRoom.get(p.id) ?? (allRooms.some((r) => r.id === p.roomId) ? p.roomId : undefined) })),
    },
  };
}

// ---------------------------------------------------------------------------
// 2. What is still missing in a room?

export interface Suggestion {
  title: string;
  category: Category;
  estimate?: number;
  qty: number;
  must: boolean;
  why: string;
}
export interface Advice {
  summary: string;
  suggestions: Suggestion[];
  tips: string[];
}

export async function aiAdvice(project: Project, room: Room, onProgress?: Progress): Promise<Advice> {
  const photos = (project.listing?.photos ?? []).filter((p) => p.roomId === room.id).slice(0, 4);
  const images = photos.map((p) => smallPhoto(p.url, 512)).filter((u): u is string => !!u);
  const items = project.items.filter((i) => i.roomId === room.id && !i.alternativeOf);
  const list = items.length
    ? items.map((i) => `- ${i.title} (${categoryLabel(i.category)}${lineCost(i).known ? `, € ${Math.round(lineCost(i).value)}` : ""})`).join("\n")
    : "(nog niets)";
  const prompt =
    `${factsText(project.listing)}\n\nRuimte: ${room.name} (${room.type})${room.floor ? `, ${room.floor}` : ""}${room.area ? `, ${room.area} m²` : ""}.` +
    (room.note ? `\nOver deze ruimte: ${room.note}` : "") +
    (project.style ? `\nGewenste stijl: ${project.style}` : "") +
    (room.budget ? `\nBudget voor deze ruimte: € ${room.budget}` : "") +
    `\n\nAl op de lijst:\n${list}\n\n` +
    (images.length ? `De foto's tonen de ruimte zoals hij nu is (van de vorige bewoners; hun spullen gaan mee).\n` : "") +
    "Wat hebben de nieuwe bewoners nog nodig om deze ruimte compleet en fijn te maken? Denk aan meubels, verlichting, raamdecoratie, vloer/wand als die zichtbaar aandacht nodig heeft, opbergen en de kleine dingen die vaak vergeten worden. " +
    "Niet herhalen wat al op de lijst staat. Houd rekening met de maat van de ruimte en het budget. Geef realistische prijzen voor één stuk bij gangbare Nederlandse winkels (middensegment, of passend bij het budget)." +
    `\nAntwoord als JSON: {"summary":"1-2 zinnen","suggestions":[{"title":"Eettafel voor 4-6 personen, ca. 180×90 cm","category":"tafels","estimate":450,"qty":1,"must":true,"why":"max 12 woorden"}],"tips":["max 3 korte tips"]}` +
    `\nMaximaal 10 suggesties, belangrijkste eerst. "category" is een van: ${CATS}.`;
  type Answer = { summary?: unknown; suggestions?: { title?: unknown; category?: unknown; estimate?: unknown; qty?: unknown; must?: unknown; why?: unknown }[]; tips?: unknown[] };
  const a = await ask<Answer>(`advice:${room.id}`, { prompt, images, maxTokens: 1800 }, "✨ Advies", onProgress);
  return {
    summary: text(a.summary, 400),
    suggestions: (a.suggestions ?? [])
      .filter((s) => text(s.title))
      .slice(0, 10)
      .map((s) => ({
        title: text(s.title, 90),
        category: asCategory(s.category),
        estimate: num(s.estimate),
        qty: Math.min(12, num(s.qty) ?? 1),
        must: s.must === true,
        why: text(s.why, 100),
      })),
    tips: (a.tips ?? []).map((t) => text(t, 160)).filter(Boolean).slice(0, 3),
  };
}

// ---------------------------------------------------------------------------
// 3. A product from a screenshot (when a shop blocks reading its page)

export interface ScreenshotProduct {
  title: string;
  price?: number;
  shop?: string;
  category: Category;
  dims?: Dims;
  url?: string;
}

export async function aiScreenshot(image: string, onProgress?: Progress): Promise<ScreenshotProduct> {
  const prompt =
    "Dit is een screenshot of foto van een product (meestal een webshoppagina). Lees af wat het is." +
    `\nAntwoord als JSON: {"title":"productnaam zoals de winkel hem noemt","price":199.95,"shop":"IKEA","category":"banken","dims":{"w":200,"d":90,"h":80},"url":"https://… als zichtbaar in de adresbalk, anders null"}` +
    `\nPrijs als getal in euro (de huidige prijs, niet de doorgestreepte). Maten in cm (breedte, diepte, hoogte) als ze erop staan, anders null. "category" is een van: ${CATS}.`;
  type Answer = { title?: unknown; price?: unknown; shop?: unknown; category?: unknown; dims?: { w?: unknown; d?: unknown; h?: unknown }; url?: unknown };
  const a = await ask<Answer>("shot", { prompt, images: [image], maxTokens: 400 }, "✨ Screenshot lezen", onProgress);
  const url = text(a.url, 500);
  const price = typeof a.price === "number" && a.price > 0 ? Math.round(a.price * 100) / 100 : undefined;
  const dims = a.dims && { w: num(a.dims.w), d: num(a.dims.d), h: num(a.dims.h) };
  if (!text(a.title)) throw new FalError("Op deze afbeelding is geen product te lezen.");
  return {
    title: text(a.title, 120),
    price,
    shop: text(a.shop, 40) || undefined,
    category: asCategory(a.category),
    dims: dims && (dims.w || dims.d || dims.h) ? dims : undefined,
    url: /^https?:\/\/\S+\.\S+/.test(url) ? url : undefined,
  };
}

// ---------------------------------------------------------------------------
// 4. Alternatives on the web

export interface Alternative {
  title: string;
  shop: string;
  price?: number;
  url: string;
  why: string;
}

export async function aiAlternatives(item: Item, onProgress?: Progress): Promise<Alternative[]> {
  const c = lineCost(item);
  const dims = item.dims ? ` Maten: ${[item.dims.w, item.dims.d, item.dims.h].filter(Boolean).join(" × ")} cm.` : "";
  const prompt =
    `Product: "${item.title}"${item.shop ? ` van ${item.shop}` : ""}${c.known ? `, € ${Math.round(c.value / item.qty)}` : ""} (${categoryLabel(item.category)}).${dims}` +
    "\nZoek op internet 3 tot 4 vergelijkbare producten die nu te koop zijn bij Nederlandse webshops: zelfde soort, vergelijkbare maat en stijl, bij voorkeur goedkoper, of duidelijk beter voor weinig meer. " +
    "Geef alleen echte productpagina's die je gevonden hebt (geen categorie- of zoekpagina's)." +
    `\nAntwoord als JSON: {"options":[{"title":"","shop":"","price":0,"url":"https://…","why":"max 10 woorden, bv. 'zelfde maat, € 60 goedkoper'"}]}`;
  type Answer = { options?: { title?: unknown; shop?: unknown; price?: unknown; url?: unknown; why?: unknown }[] };
  const a = await ask<Answer>(`alt:${item.id}`, { prompt, web: true, maxTokens: 900 }, "✨ Alternatieven zoeken", onProgress);
  return (a.options ?? [])
    .map((o) => ({ title: text(o.title, 120), shop: text(o.shop, 40), price: typeof o.price === "number" && o.price > 0 ? o.price : undefined, url: text(o.url, 500), why: text(o.why, 100) }))
    .filter((o) => o.title && /^https?:\/\/[^/]+\/.+/.test(o.url) && o.url !== item.url)
    .slice(0, 4);
}

// ---------------------------------------------------------------------------
// 5. Style check: do the chosen things go together?

export interface StyleCheck {
  score: number;
  verdict: string;
  palette: string[];
  tips: string[];
}

export async function aiStyle(project: Project, room: Room, onProgress?: Progress): Promise<StyleCheck> {
  const items = project.items.filter((i) => i.roomId === room.id && !i.alternativeOf && /^https?:/.test(i.image ?? ""));
  if (items.length < 2) throw new FalError("Zet eerst minstens 2 producten met foto in deze kamer.");
  const photo = (project.listing?.photos ?? []).find((p) => p.roomId === room.id);
  const images = [...items.slice(0, 8).map((i) => i.image!), ...(photo ? [smallPhoto(photo.url, 512)].filter((u): u is string => !!u) : [])];
  const prompt =
    `Ruimte: ${room.name}.${project.style ? ` Gewenste stijl: ${project.style}.` : ""}\n` +
    `De eerste ${Math.min(8, items.length)} afbeeldingen zijn de producten die gekozen zijn:\n${items
      .slice(0, 8)
      .map((i, n) => `${n + 1}. ${i.title}`)
      .join("\n")}` +
    (photo ? "\nDe laatste afbeelding is de ruimte zelf (met spullen van de vorige bewoners)." : "") +
    "\nPassen de producten bij elkaar en bij de ruimte (kleur, materiaal, stijl, verhoudingen)? Wees eerlijk en concreet." +
    `\nAntwoord als JSON: {"score":8,"verdict":"1-2 zinnen","palette":["#hex", 5 kleuren die samen het kleurenpalet van deze kamer vormen],"tips":["max 3 concrete tips, bv. welk product eruit valt en wat beter past"]}`;
  type Answer = { score?: unknown; verdict?: unknown; palette?: unknown[]; tips?: unknown[] };
  const a = await ask<Answer>(`style:${room.id}`, { prompt, images, maxTokens: 700 }, "✨ Stijlcheck", onProgress);
  return {
    score: Math.max(1, Math.min(10, num(a.score) ?? 5)),
    verdict: text(a.verdict, 300),
    palette: (a.palette ?? []).map((c) => text(c, 9)).filter((c) => /^#[0-9a-f]{6}$/i.test(c)).slice(0, 6),
    tips: (a.tips ?? []).map((t) => text(t, 160)).filter(Boolean).slice(0, 3),
  };
}
