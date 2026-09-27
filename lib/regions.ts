import { dilate } from "./masks";
import type { RoomSegmentation } from "./segment";

/**
 * Where furniture is, from the room recognition: the content-aware fill never copies
 * from it. Before, a filled-in rug or floor got table legs and bits of chair in it.
 * (Splitting further — rug only from rug, each wall from itself — was tried and made
 * it worse: too few sources, so stretched radiator and parquet patterns came in.)
 */
export interface RegionMap {
  /** 1 = furniture (grown a little: its edges and shadow count too). */
  furniture: Uint8Array;
  w: number;
  h: number;
}

/** Recognised things that belong to the room itself, so may be copied (not furniture). */
const ROOM_PARTS = new Set(["rug", "carpet", "curtain", "radiator", "windowpane", "door", "blind"]);

export function regionMap(seg: RoomSegmentation): RegionMap {
  const isFurniture = new Set(seg.segments.filter((s) => s.kind === "furniture" && !ROOM_PARTS.has(s.className ?? "")).map((s) => s.id));
  const mask = new Uint8Array(seg.w * seg.h);
  for (let i = 0; i < mask.length; i++) if (isFurniture.has(seg.ids[i])) mask[i] = 1;
  return { furniture: dilate(mask, seg.w, seg.h, 2), w: seg.w, h: seg.h };
}

/** Lookup in the pixels of an image of W×H. */
export function furnitureAt(map: RegionMap, W: number, H: number): (x: number, y: number) => boolean {
  const { w, h, furniture } = map;
  return (x, y) =>
    furniture[Math.min(h - 1, Math.max(0, Math.floor((y * h) / H))) * w + Math.min(w - 1, Math.max(0, Math.floor((x * w) / W)))] === 1;
}
