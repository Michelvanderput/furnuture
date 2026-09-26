import type { Category, RoomType } from "./types";

export const ROOMS: { id: RoomType; label: string; clip: string }[] = [
  { id: "woonkamer", label: "Woonkamer", clip: "a living room with a sofa" },
  { id: "keuken", label: "Keuken", clip: "a kitchen" },
  { id: "slaapkamer", label: "Slaapkamer", clip: "a bedroom" },
  { id: "badkamer", label: "Badkamer", clip: "a bathroom with a shower or bathtub" },
  { id: "toilet", label: "Toilet", clip: "a small toilet room" },
  { id: "hal", label: "Hal & trap", clip: "a hallway or staircase" },
  { id: "werkkamer", label: "Werkkamer", clip: "a home office or empty small room" },
  { id: "zolder", label: "Zolder", clip: "an attic room with a sloped roof" },
  { id: "tuin", label: "Tuin & balkon", clip: "a garden, balcony or terrace" },
  { id: "buitenkant", label: "Buitenkant", clip: "the exterior facade of a house" },
  { id: "plattegrond", label: "Plattegrond", clip: "an architectural floor plan drawing" },
  { id: "overig", label: "Overig", clip: "" },
];

export const CATEGORIES: { id: Category; label: string; group: "meubels" | "afwerking" | "accessoires" }[] = [
  { id: "banken", label: "Banken & fauteuils", group: "meubels" },
  { id: "stoelen", label: "Stoelen", group: "meubels" },
  { id: "tafels", label: "Tafels", group: "meubels" },
  { id: "kasten", label: "Kasten", group: "meubels" },
  { id: "bedden", label: "Bedden & matrassen", group: "meubels" },
  { id: "keuken", label: "Keuken", group: "meubels" },
  { id: "vloeren", label: "Vloeren", group: "afwerking" },
  { id: "verf", label: "Verf", group: "afwerking" },
  { id: "behang", label: "Behang", group: "afwerking" },
  { id: "tegels", label: "Tegels", group: "afwerking" },
  { id: "sanitair", label: "Sanitair", group: "afwerking" },
  { id: "raamdecoratie", label: "Gordijnen & raamdecoratie", group: "afwerking" },
  { id: "verlichting", label: "Verlichting", group: "accessoires" },
  { id: "vloerkleden", label: "Vloerkleden", group: "accessoires" },
  { id: "decoratie", label: "Decoratie", group: "accessoires" },
  { id: "planten", label: "Planten", group: "accessoires" },
  { id: "overig", label: "Overig", group: "accessoires" },
];

export const roomLabel = (id: RoomType) => ROOMS.find((r) => r.id === id)?.label ?? id;
export const categoryLabel = (id: Category) => CATEGORIES.find((c) => c.id === id)?.label ?? id;

/**
 * Keyword rules (Dutch + English). Order matters: the first rule with a hit wins,
 * so specific rules ("vloerkleed") come before generic ones ("vloer").
 */
const RULES: [Category, RegExp][] = [
  ["vloerkleden", /vloerkle(e)?d|karpet|\brug\b|rugs?\b|tapijt(?!tegel)/],
  ["verf", /\bverf\b|muurverf|lak\b|latex|primer|grondverf|flexa|histor|sikkens|levis|\bpaint\b|wall ?paint/],
  ["behang", /behang|wallpaper|fotobehang/],
  ["tegels", /tegel|\btile|mozaiek|mozaïek/],
  ["vloeren", /laminaat|pvc[- ]?vloer|visgraat|parket|vinyl|vloerdeel|houten vloer|click ?vloer|gietvloer|\bflooring\b|\bvloer(en)?\b|tapijttegel/],
  ["raamdecoratie", /gordijn|jaloezie|rolgordijn|vouwgordijn|plissé|plisse|curtain|blind(s)?\b|vitrage|duette/],
  ["verlichting", /lamp|verlichting|hanglamp|vloerlamp|plafondlamp|wandlamp|spot(je)?s?\b|kroonluchter|\blight(ing)?\b|pendant/],
  ["banken", /bank(en)?\b|\bsofa|couch|fauteuil|armchair|chaise|poef|hocker/],
  ["bedden", /\bbed(den)?\b|boxspring|matras|mattress|hoofdbord|headboard|bedframe/],
  ["stoelen", /stoel|chair|kruk|stool|\bbankje\b/],
  ["tafels", /tafel|\btable|bureau|\bdesk\b|salontafel|bijzettafel|eettafel/],
  ["kasten", /kast\b|kasten|dressoir|tv-meubel|tv meubel|boekenkast|wandkast|kledingkast|wardrobe|cabinet|sideboard|shelf|shelving|wandplank|ladekast/],
  ["keuken", /keuken|kitchen|aanrecht|kraan keuken|werkblad|afzuigkap|oven\b|kookplaat/],
  ["sanitair", /toilet|\bwc\b|badkamer|wastafel|douche|shower|bathtub|\bbad\b|kraan|faucet|badmeubel/],
  ["planten", /\bplant(en)?\b|monstera|ficus|pot(ten)? voor plant|bloempot|plantenbak/],
  ["decoratie", /\bvaas|kussen|plaid|spiegel|mirror|poster|schilderij|\bdecor|kaars|kandelaar|lijst|cushion|vase|wall art|klok/],
];

export function guessCategory(...texts: (string | undefined)[]): Category {
  const haystack = texts.filter(Boolean).join(" ").toLowerCase();
  for (const [cat, re] of RULES) if (re.test(haystack)) return cat;
  return "overig";
}
