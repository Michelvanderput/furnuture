import type { Category } from "./types";

/**
 * Where to look for something: the search pages of Dutch shops, fitting the kind of
 * product. Opens the shop with the name already searched; paste the product link
 * back to put it on the list.
 */

export interface Shop {
  name: string;
  search: (q: string) => string;
}

const q = encodeURIComponent;
const SHOPS = {
  ikea: { name: "IKEA", search: (s: string) => `https://www.ikea.com/nl/nl/search/?q=${q(s)}` },
  kwantum: { name: "Kwantum", search: (s: string) => `https://www.kwantum.nl/search?query=${q(s)}` },
  leenbakker: { name: "Leen Bakker", search: (s: string) => `https://www.leenbakker.nl/search?q=${q(s)}` },
  jysk: { name: "JYSK", search: (s: string) => `https://jysk.nl/search?query=${q(s)}` },
  fonq: { name: "fonQ", search: (s: string) => `https://www.fonq.nl/zoeken/?q=${q(s)}` },
  loods5: { name: "Loods 5", search: (s: string) => `https://loods5.nl/zoeken?q=${q(s)}` },
  beterbed: { name: "Beter Bed", search: (s: string) => `https://www.beterbed.nl/zoeken?q=${q(s)}` },
  coolblue: { name: "Coolblue", search: (s: string) => `https://www.coolblue.nl/zoeken?query=${q(s)}` },
  bol: { name: "bol", search: (s: string) => `https://www.bol.com/nl/nl/s/?searchtext=${q(s)}` },
  action: { name: "Action", search: (s: string) => `https://www.action.com/nl-nl/search/?q=${q(s)}` },
  praxis: { name: "Praxis", search: (s: string) => `https://www.praxis.nl/search?text=${q(s)}` },
  gamma: { name: "GAMMA", search: (s: string) => `https://www.gamma.nl/assortiment/zoeken?text=${q(s)}` },
  karwei: { name: "Karwei", search: (s: string) => `https://www.karwei.nl/assortiment/zoeken?text=${q(s)}` },
  hornbach: { name: "Hornbach", search: (s: string) => `https://www.hornbach.nl/s/${q(s)}` },
  marktplaats: { name: "Marktplaats", search: (s: string) => `https://www.marktplaats.nl/q/${q(s.replace(/\//g, " "))}/` },
} satisfies Record<string, Shop>;

const BY_CATEGORY: Partial<Record<Category, (keyof typeof SHOPS)[]>> = {
  bedden: ["beterbed", "ikea", "leenbakker", "jysk", "fonq", "marktplaats"],
  keuken: ["coolblue", "bol", "ikea", "action", "fonq", "marktplaats"],
  sanitair: ["bol", "ikea", "kwantum", "action", "fonq"],
  decoratie: ["action", "ikea", "kwantum", "fonq", "loods5", "bol"],
  planten: ["action", "ikea", "kwantum", "fonq", "bol"],
  verlichting: ["ikea", "kwantum", "fonq", "loods5", "bol", "marktplaats"],
  raamdecoratie: ["kwantum", "leenbakker", "ikea", "jysk", "fonq"],
  vloerkleden: ["kwantum", "ikea", "jysk", "fonq", "loods5", "marktplaats"],
  overig: ["bol", "coolblue", "ikea", "action", "marktplaats"],
  vloeren: ["praxis", "gamma", "karwei", "hornbach", "kwantum", "leenbakker", "marktplaats"],
  verf: ["praxis", "gamma", "karwei", "hornbach", "action"],
  behang: ["kwantum", "leenbakker", "praxis", "gamma", "karwei"],
  tegels: ["praxis", "gamma", "karwei", "hornbach", "marktplaats"],
};
const FURNITURE: (keyof typeof SHOPS)[] = ["ikea", "kwantum", "leenbakker", "jysk", "fonq", "loods5", "marktplaats"];

/** The shops worth searching for this kind of product, most likely first. */
export const shopsFor = (category: Category): Shop[] => (BY_CATEGORY[category] ?? FURNITURE).map((k) => SHOPS[k]);

/** A search term without the extras: "Eetkamerstoelen (set van 4-6)" → "eetkamerstoelen". */
export const searchTerm = (title: string) =>
  title
    .replace(/\(.*?\)/g, "")
    .replace(/\s+(of|en)\s+.*$/i, "")
    .replace(/[,:;].*$/, "")
    .trim()
    .toLowerCase();
