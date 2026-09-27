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
