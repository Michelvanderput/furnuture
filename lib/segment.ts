import { getPipeline, type Progress } from "./ai";
import { proxied } from "./images";
import { components } from "./masks";

/**
 * Room recognition with SegFormer-B2 trained on ADE20K (150 indoor/outdoor classes,
 * ~30 MB, runs free in the browser). Every pixel gets a class such as wall, floor,
 * sofa or bed; we split furniture and walls into separate objects.
 */
const MODEL = "Xenova/segformer-b2-finetuned-ade-512-512";

export type SegmentKind = "floor" | "wall" | "ceiling" | "furniture";

export interface Segment {
  id: number;
  kind: SegmentKind;
  label: string;
  area: number;
  box: [number, number, number, number]; // x0, y0, x1, y1
}

export interface RoomSegmentation {
  w: number;
  h: number;
  /** Segment id per pixel (0 = nothing selectable). */
  ids: Int32Array;
  segments: Segment[];
}

/** ADE20K class -> Dutch label. Only these can be selected. */
const FURNITURE: Record<string, string> = {
  sofa: "Bank",
  armchair: "Fauteuil",
  "swivel chair": "Bureaustoel",
  chair: "Stoel",
  stool: "Kruk",
  bench: "Bankje",
  ottoman: "Poef",
  bed: "Bed",
  cradle: "Wieg",
  table: "Tafel",
  "coffee table": "Salontafel",
  desk: "Bureau",
  "pool table": "Tafel",
  cabinet: "Kast",
  wardrobe: "Kledingkast",
  "chest of drawers": "Ladekast",
  bookcase: "Boekenkast",
  shelf: "Plank",
  buffet: "Dressoir",
  "kitchen island": "Kookeiland",
  lamp: "Lamp",
  chandelier: "Hanglamp",
  sconce: "Wandlamp",
  "television receiver": "Tv",
  "crt screen": "Scherm",
  monitor: "Scherm",
  cushion: "Kussen",
  pillow: "Kussen",
  blanket: "Plaid",
  rug: "Vloerkleed",
  curtain: "Gordijn",
  blind: "Jaloezie",
  "plant": "Plant",
  flower: "Bloemen",
  pot: "Pot",
  vase: "Vaas",
  painting: "Schilderij",
  poster: "Poster",
  mirror: "Spiegel",
  clock: "Klok",
  box: "Doos",
  basket: "Mand",
  bag: "Tas",
  "tray": "Dienblad",
  bottle: "Fles",
  book: "Boeken",
  plaything: "Speelgoed",
  seat: "Stoel",
  light: "Lamp",
  sculpture: "Beeld",
  computer: "Computer",
  screen: "Scherm",
  radiator: "Radiator",
  fan: "Ventilator",
  "washer": "Wasmachine",
  refrigerator: "Koelkast",
  "ashcan": "Prullenbak",
  "towel": "Handdoek",
  "apparel": "Kleding",
};

const KIND: Record<string, SegmentKind> = { floor: "floor", wall: "wall", ceiling: "ceiling" };
const PLAIN_LABEL: Record<SegmentKind, string> = { floor: "Vloer", wall: "Muur", ceiling: "Plafond", furniture: "" };

type SegOutput = { label: string | null; mask: { data: Uint8ClampedArray | Uint8Array; width: number; height: number } }[];

export async function segmentRoom(photoUrl: string, onProgress?: Progress): Promise<RoomSegmentation> {
  onProgress?.("Kamer-herkenning laden…");
  const segmenter = await getPipeline<(src: string) => Promise<SegOutput>>("image-segmentation", MODEL, onProgress);
  onProgress?.("Meubels, muren en vloer herkennen…");
  const result = await segmenter(new URL(proxied(photoUrl), window.location.href).toString());
  const w = result[0]?.mask.width ?? 0;
  const h = result[0]?.mask.height ?? 0;
  const ids = new Int32Array(w * h);
  const segments: Segment[] = [];
  const minArea = w * h * 0.0015;

  for (const { label, mask } of result) {
    const name = (label ?? "").trim().split(",")[0].trim().toLowerCase();
    const kind: SegmentKind | undefined = KIND[name] ?? (FURNITURE[name] ? "furniture" : undefined);
    if (!kind) continue;
    const bin = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) bin[i] = mask.data[i] > 127 ? 1 : 0;

    // The floor stays one area; walls and furniture are split into separate objects.
    const parts = kind === "floor" || kind === "ceiling" ? null : components(bin, w, h);
    const count = parts ? parts.sizes.length - 1 : 1;
    for (let c = 1; c <= count; c++) {
      const area = parts ? parts.sizes[c] : bin.reduce((s, v) => s + v, 0);
      if (area < minArea) continue;
      const id = segments.length + 1;
      let x0 = w, y0 = h, x1 = 0, y1 = 0;
      for (let i = 0; i < w * h; i++) {
        if (parts ? parts.labels[i] !== c : !bin[i]) continue;
        ids[i] = id;
        const x = i % w, y = (i / w) | 0;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
      segments.push({ id, kind, label: kind === "furniture" ? FURNITURE[name] : PLAIN_LABEL[kind], area, box: [x0, y0, x1, y1] });
    }
  }
  // Number duplicates: "Stoel 1", "Stoel 2".
  const total = new Map<string, number>();
  for (const s of segments) total.set(s.label, (total.get(s.label) ?? 0) + 1);
  const seen = new Map<string, number>();
  for (const s of segments) {
    if (total.get(s.label)! < 2) continue;
    const n = (seen.get(s.label) ?? 0) + 1;
    seen.set(s.label, n);
    s.label = `${s.label} ${n}`;
  }
  onProgress?.("");
  return { w, h, ids, segments };
}

export function segmentMask(seg: RoomSegmentation, id: number): Uint8Array {
  const out = new Uint8Array(seg.w * seg.h);
  for (let i = 0; i < out.length; i++) out[i] = seg.ids[i] === id ? 1 : 0;
  return out;
}

/** All recognised furniture: it hides the edges of floors and walls. */
export function furnitureMask(seg: RoomSegmentation): Uint8Array {
  const furniture = new Set(seg.segments.filter((s) => s.kind === "furniture").map((s) => s.id));
  const out = new Uint8Array(seg.w * seg.h);
  for (let i = 0; i < out.length; i++) out[i] = furniture.has(seg.ids[i]) ? 1 : 0;
  return out;
}
