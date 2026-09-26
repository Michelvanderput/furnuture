import type { Category, RoomType } from "./types";

/**
 * `clip`: descriptions for the photo-sorting AI (CLIP). Several per room: a room
 * wins when any of its descriptions fits best, which is much more reliable than a
 * single description (a dining corner is a living room too, a bedroom may be in
 * the attic). Floor plans are recognised without AI (see ai.ts).
 */
export const ROOMS: { id: RoomType; label: string; clip: string[] }[] = [
  {
    id: "woonkamer",
    label: "Woonkamer",
    clip: ["a living room with a sofa", "a dining room with a dining table and chairs", "an open-plan living and dining room", "a living room with a fireplace"],
  },
  { id: "keuken", label: "Keuken", clip: ["a kitchen", "a kitchen counter with a sink and a stove", "an open kitchen with cabinets"] },
  { id: "slaapkamer", label: "Slaapkamer", clip: ["a bedroom with a bed", "a bedroom", "a small bedroom with a bed under a window"] },
  { id: "badkamer", label: "Badkamer", clip: ["a bathroom with a shower or bathtub", "a bathroom with a sink and a mirror"] },
  { id: "toilet", label: "Toilet", clip: ["a small toilet room", "a toilet with a small hand basin"] },
  {
    id: "hal",
    label: "Hal & trap",
    clip: ["a hallway with a staircase", "an entrance hall with a front door", "a narrow corridor with doors", "an indoor landing at the top of the stairs"],
  },
  { id: "werkkamer", label: "Werkkamer", clip: ["a home office with a desk", "a study room with a desk and a chair", "a small room with a desk under the window"] },
  { id: "zolder", label: "Zolder", clip: ["an attic room with a sloped roof", "an attic with a sloping wooden ceiling"] },
  { id: "tuin", label: "Tuin & balkon", clip: ["a back garden with a fence", "a garden with plants and a patio", "a backyard with grass and the back of the house", "a balcony", "a roof terrace"] },
  {
    id: "buitenkant",
    label: "Buitenkant",
    clip: ["the front facade of a house", "a street with houses", "the outside of a building", "a public playground or park near houses"],
  },
  { id: "plattegrond", label: "Plattegrond", clip: ["an architectural floor plan drawing"] },
  { id: "overig", label: "Overig", clip: [] },
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

/**
 * The most specific text decides: the title first, then the shop's category, the
 * breadcrumb, … ("Baseline laminaat" in the menu "Tegels & vloeren" is a floor).
 */
export function guessCategory(...texts: (string | undefined)[]): Category {
  for (const text of texts) {
    const t = (text ?? "").toLowerCase();
    if (!t) continue;
    for (const [cat, re] of RULES) if (re.test(t)) return cat;
  }
  return "overig";
}

const ROOM_RULES: [RoomType, RegExp][] = [
  ["plattegrond", /plattegrond|floor ?plan|indeling/],
  ["keuken", /keuken|kitchen/],
  ["badkamer", /badkamer|bathroom|douche/],
  ["toilet", /toilet|\bwc\b/],
  ["slaapkamer", /slaapkamer|bedroom/],
  ["woonkamer", /woonkamer|living|zitkamer|eetkamer/],
  ["hal", /\bhal\b|entree|trap|overloop|hallway/],
  ["werkkamer", /werkkamer|kantoor|studeerkamer|office/],
  ["zolder", /zolder|vliering|attic/],
  ["tuin", /tuin|balkon|terras|dakterras|garden|balcony/],
  ["buitenkant", /gevel|voorzijde|achterzijde|exterieur|straat|facade/],
];

/** Room type from a caption such as Funda's photo DisplayName. */
export function guessRoom(text: string | undefined): RoomType | undefined {
  const t = (text ?? "").toLowerCase();
  return ROOM_RULES.find(([, re]) => re.test(t))?.[0];
}
