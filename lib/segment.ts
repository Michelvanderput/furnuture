import { components } from "./masks";
import { imagePixels, isLowMemoryDevice, runAi, type Progress } from "./worker";

/**
 * Room recognition with SegFormer trained on ADE20K (150 indoor/outdoor classes),
 * free in the browser. Every pixel gets a class such as wall, floor, sofa or bed;
 * we split furniture and walls into separate objects.
 * B2 (~30 MB) on computers, the much lighter B0 (~4 MB) on iPad/iPhone.
 */
const MODEL = "Xenova/segformer-b2-finetuned-ade-512-512";
const MODEL_LIGHT = "Xenova/segformer-b0-finetuned-ade-512-512";

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

/** Working resolution of the recognition result (plenty for selecting and masks). */
const WORK_SIDE = 480;

export async function segmentRoom(photoUrl: string, onProgress?: Progress): Promise<RoomSegmentation> {
  onProgress?.("Foto voorbereiden…");
  // The model looks at 512×512 pixels; a larger photo only costs memory.
  const image = await imagePixels(photoUrl, 512);
  const f = WORK_SIDE / Math.max(image.width, image.height);
  const outW = Math.round(image.width * f);
  const outH = Math.round(image.height * f);
  const { classMap, id2label } = await runAi<{ classMap: Uint8Array; id2label: Record<number, string> }>(
    { task: "segment", image, model: isLowMemoryDevice() ? MODEL_LIGHT : MODEL, outW, outH },
    onProgress,
    [image.data.buffer],
  );
  return buildSegments(classMap, outW, outH, id2label, onProgress);
}

/** Turns a class-per-pixel map into selectable objects (floor, walls, furniture). */
export function buildSegments(
  classMap: Uint8Array,
  w: number,
  h: number,
  id2label: Record<number, string>,
  onProgress?: Progress,
): RoomSegmentation {
  const ids = new Int32Array(w * h);
  const segments: Segment[] = [];
  const minArea = w * h * 0.0015;
  const present = new Set(classMap);

  for (const cls of present) {
    const name = String(id2label[cls] ?? "").trim().split(",")[0].trim().toLowerCase();
    const kind: SegmentKind | undefined = KIND[name] ?? (FURNITURE[name] ? "furniture" : undefined);
    if (!kind) continue;
    const bin = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) bin[i] = classMap[i] === cls ? 1 : 0;

    // The floor stays one area; walls and furniture are split into separate objects.
    const { labels, sizes } = kind === "floor" || kind === "ceiling"
      ? { labels: bin as unknown as Int32Array, sizes: [0, bin.reduce((s, v) => s + v, 0)] }
      : components(bin, w, h);

    // Bounding boxes of all parts in one pass.
    const boxes = sizes.map(() => [w, h, -1, -1]);
    for (let i = 0; i < w * h; i++) {
      const c = labels[i];
      if (!c) continue;
      const x = i % w, y = (i / w) | 0, b = boxes[c];
      if (x < b[0]) b[0] = x;
      if (y < b[1]) b[1] = y;
      if (x > b[2]) b[2] = x;
      if (y > b[3]) b[3] = y;
    }
    const idOf = new Int32Array(sizes.length);
    for (let c = 1; c < sizes.length; c++) {
      if (sizes[c] < minArea) continue;
      idOf[c] = segments.length + 1;
      const label = kind === "furniture" ? FURNITURE[name] : PLAIN_LABEL[kind];
      segments.push({ id: idOf[c], kind, label, area: sizes[c], box: boxes[c] as Segment["box"] });
    }
    for (let i = 0; i < w * h; i++) if (labels[i] && idOf[labels[i]]) ids[i] = idOf[labels[i]];
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
