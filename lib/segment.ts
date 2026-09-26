import { loadTransformers, type Progress } from "./ai";
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

/* eslint-disable @typescript-eslint/no-explicit-any */
let model: Promise<{ t: any; processor: any; model: any }> | null = null;

function loadModel(onProgress?: Progress) {
  model ??= (async () => {
    const t = await loadTransformers();
    const progress_callback = (e: { status: string; file?: string; progress?: number }) => {
      if (e.status === "progress" && e.file?.endsWith(".onnx")) onProgress?.(`Kamer-herkenning downloaden… ${Math.round(e.progress ?? 0)}%`);
    };
    const [processor, m] = await Promise.all([
      t.AutoProcessor.from_pretrained(MODEL),
      t.AutoModelForSemanticSegmentation.from_pretrained(MODEL, { dtype: "q8", progress_callback }),
    ]);
    return { t, processor, model: m };
  })();
  model.catch(() => (model = null));
  return model;
}

/**
 * Class per pixel from the model's low-resolution logits [C, h, w].
 *
 * The standard post-processing first scales all 150 class maps up to the photo
 * size (~1 GB for a Funda photo) and crashed browsers. Instead we upscale
 * bilinearly to at most `maxSide` pixels, one pixel at a time, take the best
 * class, and repeat that label map (nearest) up to the photo size.
 */
export function labelsFromLogits(
  logits: Float32Array,
  classes: number,
  h: number,
  w: number,
  outW: number,
  outH: number,
  maxSide = 480,
): Uint8Array {
  const f = Math.min(1, maxSide / Math.max(outW, outH));
  const mw = Math.max(1, Math.round(outW * f));
  const mh = Math.max(1, Math.round(outH * f));
  const mid = new Uint8Array(mw * mh);
  const plane = h * w;
  for (let y = 0; y < mh; y++) {
    const sy = Math.min(h - 1, Math.max(0, ((y + 0.5) * h) / mh - 0.5));
    const y0 = Math.floor(sy), y1 = Math.min(h - 1, y0 + 1), fy = sy - y0;
    for (let x = 0; x < mw; x++) {
      const sx = Math.min(w - 1, Math.max(0, ((x + 0.5) * w) / mw - 0.5));
      const x0 = Math.floor(sx), x1 = Math.min(w - 1, x0 + 1), fx = sx - x0;
      const a = y0 * w + x0, b = y0 * w + x1, c = y1 * w + x0, d = y1 * w + x1;
      const wa = (1 - fx) * (1 - fy), wb = fx * (1 - fy), wc = (1 - fx) * fy, wd = fx * fy;
      let best = 0, bestV = -Infinity;
      for (let k = 0; k < classes; k++) {
        const o = k * plane;
        const v = logits[o + a] * wa + logits[o + b] * wb + logits[o + c] * wc + logits[o + d] * wd;
        if (v > bestV) (bestV = v), (best = k);
      }
      mid[y * mw + x] = best;
    }
  }
  if (mw === outW && mh === outH) return mid;
  const out = new Uint8Array(outW * outH);
  for (let y = 0; y < outH; y++) {
    const row = Math.min(mh - 1, Math.floor((y * mh) / outH)) * mw;
    for (let x = 0; x < outW; x++) out[y * outW + x] = mid[row + Math.min(mw - 1, Math.floor((x * mw) / outW))];
  }
  return out;
}

export async function segmentRoom(photoUrl: string, onProgress?: Progress): Promise<RoomSegmentation> {
  onProgress?.("Kamer-herkenning laden…");
  const { t, processor, model: m } = await loadModel(onProgress);
  onProgress?.("Meubels, muren en vloer herkennen…");
  const image = await t.RawImage.fromURL(new URL(proxied(photoUrl), window.location.href).toString());
  const w: number = image.width;
  const h: number = image.height;
  const inputs = await processor(image);
  const { logits } = await m(inputs);
  const [, classes, lh, lw] = logits.dims as number[];
  const classMap = labelsFromLogits(logits.data as Float32Array, classes, lh, lw, w, h);
  logits.dispose?.();
  return buildSegments(classMap, w, h, m.config.id2label as Record<number, string>, onProgress);
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
