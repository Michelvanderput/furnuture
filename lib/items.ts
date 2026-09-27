import { newId } from "./rooms";
import type { Item, Project, Room } from "./types";

type P = Project;

export const patchItem = (id: string, patch: Partial<Item>) => (p: P): P => ({
  ...p,
  items: p.items.map((i) => (i.id === id ? { ...i, ...patch } : i)),
});

export const addItems = (items: Item[]) => (p: P): P => ({ ...p, items: [...p.items, ...items] });

/** Removes an item. Its alternatives stay: the first becomes the main item. */
export const removeItem = (id: string) => (p: P): P => {
  const alts = p.items.filter((i) => i.alternativeOf === id);
  const [first] = alts;
  return {
    ...p,
    items: p.items
      .filter((i) => i.id !== id)
      .map((i) => (i.id === first?.id ? { ...i, alternativeOf: undefined } : i.alternativeOf === id ? { ...i, alternativeOf: first.id } : i)),
  };
};

/** Makes an alternative the chosen one: the old main item becomes an alternative of it. */
export const chooseAlternative = (altId: string) => (p: P): P => {
  const alt = p.items.find((i) => i.id === altId);
  const mainId = alt?.alternativeOf;
  if (!alt || !mainId) return p;
  return {
    ...p,
    items: p.items.map((i) =>
      i.id === altId
        ? { ...i, alternativeOf: undefined, status: i.status === "idee" ? "gekozen" : i.status }
        : i.id === mainId || i.alternativeOf === mainId
          ? { ...i, alternativeOf: altId }
          : i,
    ),
  };
};

/** Moves an item (with its alternatives) to another room. */
export const moveItem = (id: string, roomId: string | null) => (p: P): P => ({
  ...p,
  items: p.items.map((i) => (i.id === id || i.alternativeOf === id ? { ...i, roomId } : i)),
});

export const duplicateItem = (id: string) => (p: P): P => {
  const i = p.items.find((x) => x.id === id);
  if (!i) return p;
  const copy: Item = { ...i, id: newId(), status: "idee", alternativeOf: undefined, addedAt: Date.now() };
  const at = p.items.indexOf(i);
  return { ...p, items: [...p.items.slice(0, at + 1), copy, ...p.items.slice(at + 1)] };
};

export const patchRoom = (id: string, patch: Partial<Room>) => (p: P): P => ({
  ...p,
  rooms: p.rooms.map((r) => (r.id === id ? { ...r, ...patch } : r)),
});

/** Removes a room; its items go to "Nog geen kamer", its photos lose their room. */
export const removeRoom = (id: string) => (p: P): P => ({
  ...p,
  renovation: p.renovation && { ...p.renovation, tasks: p.renovation.tasks.map((t) => ({ ...t, roomIds: t.roomIds.filter((r) => r !== id) })) },
  rooms: p.rooms.filter((r) => r.id !== id),
  items: p.items.map((i) => (i.roomId === id ? { ...i, roomId: null } : i)),
  listing: p.listing && { ...p.listing, photos: p.listing.photos.map((ph) => (ph.roomId === id ? { ...ph, roomId: undefined } : ph)) },
});

export const moveRoom = (id: string, dir: -1 | 1) => (p: P): P => {
  const i = p.rooms.findIndex((r) => r.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= p.rooms.length) return p;
  const rooms = [...p.rooms];
  [rooms[i], rooms[j]] = [rooms[j], rooms[i]];
  return { ...p, rooms };
};

/** Something still to find: no product link and no shop price, only (maybe) an estimate. */
export const isPlaceholder = (i: Item) => !i.url && i.price === undefined;

/** The one "still to find" item a new product of the same kind in the same room takes the place of, if there is exactly one. */
export function placeholderFor(items: Item[], product: Item, taken: Set<string> = new Set()): Item | undefined {
  if (product.alternativeOf || product.category === "overig") return undefined;
  const matches = items.filter((p) => p.roomId === product.roomId && isPlaceholder(p) && !p.alternativeOf && p.category === product.category && !taken.has(p.id) && p.id !== product.id);
  if (matches.length <= 1) return matches[0];
  // Several of the same kind ("Nachtkastjes", "Kledingkast"): the one whose name the product shares.
  const named = matches.filter((p) => sharesName(p.suggestion ?? p.title, product.title));
  return named.length === 1 ? named[0] : undefined;
}

/** Words of 4+ letters, lower case, without plural endings: "Kledingkasten" → "kledingkast". */
const words = (s: string) =>
  (s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").match(/[a-z]{4,}/g) ?? []).map((w) => w.replace(/(en|jes|je|s)$/, ""));
/** Does the product's name contain a word of what was to find ("kledingkast" in "KLEDINGKAST 2 DEUREN")? */
export function sharesName(wanted: string, title: string): boolean {
  const have = words(title);
  return words(wanted).some((w) => w.length >= 4 && have.some((h) => h === w || h.includes(w) || w.includes(h)));
}

/** The product's data in the placeholder's place: its room, quantity, must-have, note and where it came from stay. */
export const fillPlaceholder = (placeholder: Item, product: Item): Item => ({
  ...product,
  id: placeholder.id,
  roomId: placeholder.roomId,
  qty: placeholder.qty,
  must: placeholder.must,
  note: placeholder.note || product.note,
  suggestion: placeholder.suggestion ?? placeholder.title,
  why: placeholder.why ?? product.why,
  estimate: placeholder.estimate,
  status: placeholder.status === "idee" ? "gekozen" : placeholder.status,
  addedAt: placeholder.addedAt,
});

/** Adds products; each takes the place of the one matching placeholder in its room, if any. Returns what was replaced. */
export function addOrFill(products: Item[]) {
  const replaced: { product: Item; placeholder: Item }[] = [];
  const apply = (p: Project): Project => {
    const taken = new Set<string>();
    const fresh: Item[] = [];
    replaced.length = 0;
    for (const it of products) {
      const ph = placeholderFor(p.items, it, taken);
      if (ph) {
        taken.add(ph.id);
        replaced.push({ product: it, placeholder: ph });
      } else fresh.push(it);
    }
    return {
      ...p,
      items: [
        ...p.items.map((x) => {
          const r = replaced.find((y) => y.placeholder.id === x.id);
          return r ? fillPlaceholder(x, r.product) : x;
        }),
        ...fresh,
      ],
    };
  };
  return { apply, replaced };
}
