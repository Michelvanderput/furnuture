import { components, dilate } from "./masks";
import { imagePixels, isLightMode, runAi, gpuEnabled, type Progress } from "./worker";

/**
 * Room recognition with SegFormer trained on ADE20K (150 indoor/outdoor classes),
 * free in the browser. Every pixel gets a class such as wall, floor, sofa or bed;
 * we split furniture and walls into separate objects.
 * B2 (~30 MB) by default; the much lighter B0 (~4 MB) in light mode (switched on
 * automatically when a device ran out of memory before).
 */
const MODEL = "Xenova/segformer-b2-finetuned-ade-512-512";
const MODEL_LIGHT = "Xenova/segformer-b0-finetuned-ade-512-512";
/** SegFormer-B5 at 640 px: the strongest ADE20K model, only on a GPU with half precision (see ai.worker.ts). */
const MODEL_GPU = "Xenova/segformer-b5-finetuned-ade-640-640";

export type SegmentKind = "floor" | "wall" | "ceiling" | "furniture";

export interface Segment {
  id: number;
  kind: SegmentKind;
  label: string;
  /** ADE20K class name, e.g. "sofa". */
  className?: string;
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
  const gpu = gpuEnabled();
  const image = await imagePixels(photoUrl, gpu ? 640 : 512);
  const f = WORK_SIDE / Math.max(image.width, image.height);
  const outW = Math.round(image.width * f);
  const outH = Math.round(image.height * f);
  const { classMap, id2label } = await runAi<{ classMap: Uint8Array; id2label: Record<number, string> }>(
    { task: "segment", image, models: [isLightMode() ? MODEL_LIGHT : MODEL], gpuModels: gpu ? [MODEL_GPU] : undefined, outW, outH },
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
    let bin: Uint8Array = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) bin[i] = classMap[i] === cls ? 1 : 0;
    // Furniture often comes out in pieces (a sofa split by a shadow): close small gaps.
    if (kind === "furniture") bin = close(bin, w, h, Math.max(2, Math.round(Math.max(w, h) / 160)));

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
      segments.push({ id: idOf[c], kind, label, className: name, area: sizes[c], box: boxes[c] as Segment["box"] });
    }
    // Closing may reach into pixels another class already claimed: keep the first owner.
    for (let i = 0; i < w * h; i++) if (labels[i] && idOf[labels[i]] && !ids[i]) ids[i] = idOf[labels[i]];
  }

  mergeAccessories(segments, ids, w, h);
  for (const seg of segments) if (seg.kind === "furniture") fillHoles(seg, segments, ids, w);
  // Recount: filling holes can swallow small pieces completely.
  const areas = new Map<number, number>();
  for (let i = 0; i < ids.length; i++) if (ids[i]) areas.set(ids[i], (areas.get(ids[i]) ?? 0) + 1);
  for (const seg of [...segments]) {
    seg.area = areas.get(seg.id) ?? 0;
    if (seg.area < minArea) {
      segments.splice(segments.indexOf(seg), 1);
      for (let i = 0; i < ids.length; i++) if (ids[i] === seg.id) ids[i] = 0;
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

/** Morphological closing: grow, then shrink back. Joins pieces closer than 2r. */
function close(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  // Pad with empty space so the image border does not count as "inside".
  const pw = w + 2 * r, ph = h + 2 * r;
  const padded = new Uint8Array(pw * ph);
  for (let y = 0; y < h; y++) padded.set(mask.subarray(y * w, y * w + w), (y + r) * pw + r);
  const grown = dilate(padded, pw, ph, r);
  for (let i = 0; i < grown.length; i++) grown[i] = grown[i] ? 0 : 1;
  const shrunk = dilate(grown, pw, ph, r);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = shrunk[(y + r) * pw + x + r] ? 0 : 1;
  return out;
}

const HOSTS = new Set(["sofa", "armchair", "swivel chair", "chair", "bed", "bench", "ottoman", "stool"]);
const ACCESSORIES = new Set(["cushion", "pillow", "blanket"]);

/** Cushions and plaids on a sofa or bed belong to it: selecting the sofa should take them along. */
function mergeAccessories(segments: Segment[], ids: Int32Array, w: number, h: number) {
  const byId = new Map(segments.map((s) => [s.id, s]));
  for (const acc of segments.filter((s) => ACCESSORIES.has(s.className ?? ""))) {
    const votes = new Map<number, number>();
    const [x0, y0, x1, y1] = acc.box;
    for (let y = Math.max(0, y0 - 2); y <= Math.min(h - 1, y1 + 2); y++) {
      for (let x = Math.max(0, x0 - 2); x <= Math.min(w - 1, x1 + 2); x++) {
        const other = byId.get(ids[y * w + x]);
        if (other && HOSTS.has(other.className ?? "")) votes.set(other.id, (votes.get(other.id) ?? 0) + 1);
      }
    }
    const host = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
    if (!host) continue;
    const target = byId.get(host[0])!;
    for (let i = 0; i < ids.length; i++) if (ids[i] === acc.id) ids[i] = target.id;
    target.area += acc.area;
    target.box = [Math.min(target.box[0], x0), Math.min(target.box[1], y0), Math.max(target.box[2], x1), Math.max(target.box[3], y1)];
    segments.splice(segments.indexOf(acc), 1);
    byId.delete(acc.id);
  }
}

/** Holes inside a piece of furniture (wall seen through a chair back, a label mix-up) become part of it. */
function fillHoles(seg: Segment, segments: Segment[], ids: Int32Array, w: number) {
  const [x0, y0, x1, y1] = seg.box;
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  const outside = new Uint8Array(bw * bh);
  const stack: number[] = [];
  const at = (x: number, y: number) => ids[(y0 + y) * w + x0 + x];
  const push = (x: number, y: number) => {
    const i = y * bw + x;
    if (!outside[i] && at(x, y) !== seg.id) (outside[i] = 1), stack.push(i);
  };
  for (let x = 0; x < bw; x++) push(x, 0), push(x, bh - 1);
  for (let y = 0; y < bh; y++) push(0, y), push(bw - 1, y);
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % bw, y = (i / bw) | 0;
    if (x > 0) push(x - 1, y);
    if (x < bw - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < bh - 1) push(x, y + 1);
  }
  const furniture = new Set(segments.filter((s) => s.kind === "furniture" && s.id !== seg.id).map((s) => s.id));
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const i = (y0 + y) * w + x0 + x;
      if (!outside[y * bw + x] && ids[i] !== seg.id && !furniture.has(ids[i])) (ids[i] = seg.id), seg.area++;
    }
  }
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
