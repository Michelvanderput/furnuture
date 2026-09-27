import { roomLabel } from "./categories";
import type { Listing, Photo, Room, RoomType } from "./types";

export const newId = () => Math.random().toString(36).slice(2, 10);

export const ROOM_EMOJI: Record<RoomType, string> = {
  woonkamer: "🛋️",
  keuken: "🍳",
  slaapkamer: "🛏️",
  badkamer: "🛁",
  toilet: "🚽",
  hal: "🚪",
  werkkamer: "💻",
  zolder: "📦",
  tuin: "🌿",
  buitenkant: "🏡",
  plattegrond: "🗺️",
  overig: "✨",
};

/** Room types you can furnish (not the facade or the floor plan). */
export const FURNISHABLE: RoomType[] = ["woonkamer", "keuken", "slaapkamer", "badkamer", "toilet", "hal", "werkkamer", "zolder", "tuin", "overig"];

/** Leading number in "4", "4 slaapkamers", "5 kamers (4 slaapkamers)". */
function count(text: string | undefined, word?: RegExp): number | undefined {
  if (!text) return undefined;
  const m = word ? text.match(word) : text.match(/\d+/);
  const n = m ? parseInt(m[1] ?? m[0], 10) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

/**
 * A first layout of the house without AI: living room, kitchen, the bedrooms Funda
 * mentions, bathroom, toilet, hall, and a garden, study or attic when the photos show one.
 */
export function defaultRooms(listing: Listing | null): Room[] {
  const facts = listing?.facts;
  const shown = new Set((listing?.photos ?? []).map((p) => p.room));
  const bedrooms = Math.min(6, count(facts?.bedrooms) ?? count(facts?.rooms, /(\d+)\s*slaapkamer/) ?? (shown.has("slaapkamer") ? 2 : 1));
  const bathrooms = Math.min(3, count(facts?.bathrooms) ?? 1);
  const rooms: Room[] = [
    { id: newId(), name: "Woonkamer", type: "woonkamer" },
    { id: newId(), name: "Keuken", type: "keuken" },
    ...Array.from({ length: bedrooms }, (_, i): Room => ({
      id: newId(),
      name: bedrooms === 1 ? "Slaapkamer" : i === 0 ? "Hoofdslaapkamer" : `Slaapkamer ${i + 1}`,
      type: "slaapkamer",
    })),
    ...Array.from({ length: bathrooms }, (_, i): Room => ({ id: newId(), name: bathrooms === 1 ? "Badkamer" : `Badkamer ${i + 1}`, type: "badkamer" })),
    { id: newId(), name: "Toilet", type: "toilet" },
    { id: newId(), name: "Hal & overloop", type: "hal" },
  ];
  if (shown.has("werkkamer")) rooms.push({ id: newId(), name: "Werkkamer", type: "werkkamer" });
  if (shown.has("zolder")) rooms.push({ id: newId(), name: "Zolder", type: "zolder" });
  if (shown.has("tuin") || facts?.plotArea) rooms.push({ id: newId(), name: "Tuin", type: "tuin" });
  return rooms;
}

/** Photos without a room go to the first room of their kind. */
export function assignPhotos(photos: Photo[], rooms: Room[]): Photo[] {
  const ids = new Set(rooms.map((r) => r.id));
  return photos.map((p) => {
    if (p.roomId && ids.has(p.roomId)) return p;
    const room = rooms.find((r) => r.type === p.room);
    return room ? { ...p, roomId: room.id } : { ...p, roomId: undefined };
  });
}

export const roomPhotos = (listing: Listing | null, roomId: string) => (listing?.photos ?? []).filter((p) => p.roomId === roomId);

/** A new room of a kind, named so it does not clash ("Slaapkamer 3"). */
export function newRoom(type: RoomType, rooms: Room[]): Room {
  const base = roomLabel(type);
  const same = rooms.filter((r) => r.name.startsWith(base)).length;
  return { id: newId(), name: same ? `${base} ${same + 1}` : base, type };
}
