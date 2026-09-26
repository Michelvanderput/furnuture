import type { Progress } from "./ai";
import { loadImage, proxied } from "./images";
import { aiInpaint, patchInpaint } from "./aiInpaint";
import { decodeMask, dilate, polygonMask } from "./masks";
import { fingerprint, getCached, putCached } from "./aiCache";
import type { EraseLayer, Pt } from "./types";

/**
 * Fills a masked area from its surroundings with a push-pull pyramid (no AI):
 * the image is repeatedly halved while averaging only known pixels, then the
 * coarse levels are blended back into the holes. Works well on walls and floors
 * (smooth areas); on busy textures the result is blurry.
 *
 * `rgb` is RGBA data, `mask` is 1 for pixels to fill. Mutates `rgb`.
 */
export function pushPullFill(rgb: Uint8ClampedArray, mask: Uint8Array, w: number, h: number): void {
  type Level = { w: number; h: number; c: Float32Array; a: Float32Array }; // premultiplied colour + weight
  const base: Level = { w, h, c: new Float32Array(w * h * 3), a: new Float32Array(w * h) };
  for (let i = 0; i < w * h; i++) {
    const known = mask[i] ? 0 : 1;
    base.a[i] = known;
    for (let k = 0; k < 3; k++) base.c[i * 3 + k] = rgb[i * 4 + k] * known;
  }

  // Push: downsample, summing only known pixels.
  const levels: Level[] = [base];
  while (levels.at(-1)!.w > 1 || levels.at(-1)!.h > 1) {
    const f = levels.at(-1)!;
    const nw = Math.max(1, Math.ceil(f.w / 2));
    const nh = Math.max(1, Math.ceil(f.h / 2));
    const n: Level = { w: nw, h: nh, c: new Float32Array(nw * nh * 3), a: new Float32Array(nw * nh) };
    for (let y = 0; y < f.h; y++) {
      for (let x = 0; x < f.w; x++) {
        const i = y * f.w + x;
        const j = (y >> 1) * nw + (x >> 1);
        n.a[j] += f.a[i];
        for (let k = 0; k < 3; k++) n.c[j * 3 + k] += f.c[i * 3 + k];
      }
    }
    // Normalise so a fully known coarse pixel has weight 1.
    for (let j = 0; j < nw * nh; j++) {
      const a = n.a[j];
      if (a > 0) {
        const s = Math.min(1, a) / a;
        n.a[j] = Math.min(1, a);
        for (let k = 0; k < 3; k++) n.c[j * 3 + k] *= s;
      }
    }
    levels.push(n);
  }

  // Pull: fill the missing weight of each level from the (bilinear) coarser level.
  for (let l = levels.length - 2; l >= 0; l--) {
    const f = levels[l];
    const c = levels[l + 1];
    for (let y = 0; y < f.h; y++) {
      for (let x = 0; x < f.w; x++) {
        const i = y * f.w + x;
        const missing = 1 - f.a[i];
        if (missing <= 0) continue;
        const cx = Math.min(c.w - 1, Math.max(0, (x - 0.5) / 2));
        const cy = Math.min(c.h - 1, Math.max(0, (y - 0.5) / 2));
        const x0 = Math.floor(cx), y0 = Math.floor(cy);
        const x1 = Math.min(c.w - 1, x0 + 1), y1 = Math.min(c.h - 1, y0 + 1);
        const fx = cx - x0, fy = cy - y0;
        const taps: [number, number][] = [
          [y0 * c.w + x0, (1 - fx) * (1 - fy)],
          [y0 * c.w + x1, fx * (1 - fy)],
          [y1 * c.w + x0, (1 - fx) * fy],
          [y1 * c.w + x1, fx * fy],
        ];
        let wa = 0;
        const col = [0, 0, 0];
        for (const [j, t] of taps) {
          wa += c.a[j] * t;
          for (let k = 0; k < 3; k++) col[k] += c.c[j * 3 + k] * t;
        }
        if (wa <= 0) continue;
        for (let k = 0; k < 3; k++) f.c[i * 3 + k] += (missing * col[k]) / wa;
        f.a[i] = 1;
      }
    }
  }

  for (let i = 0; i < w * h; i++) {
    if (!mask[i]) continue;
    // A little grain so the patch does not look plastic.
    const grain = (Math.random() - 0.5) * 6;
    for (let k = 0; k < 3; k++) rgb[i * 4 + k] = base.c[i * 3 + k] / (base.a[i] || 1) + grain;
  }
}

/** Largest side the erased photo is worked on: bigger photos only cost memory (the screen scales it). */
const MAX_SIDE = 2048;

/**
 * Stable short identity of an erase layer's content (same across visits, so
 * results can be cached). Layers are immutable, so it is computed once per object:
 * stringifying every mask PNG on each render used to churn through megabytes.
 */
const layerIds = new WeakMap<EraseLayer, string>();
export function eraseLayerId(l: EraseLayer): string {
  let id = layerIds.get(l);
  if (!id) {
    id = fingerprint(`${l.method}:${l.mask ?? JSON.stringify(l.points.map((p) => p.map(Math.round)))}`);
    layerIds.set(l, id);
  }
  return id;
}

/**
 * The last result, so adding one erase layer only processes that layer instead
 * of redoing every earlier one (each AI layer starts a worker with a 27 MB model).
 */
let last: { photoUrl: string; keys: string[]; blob: Blob } | null = null;

/** Fills `mask` (1 = fill) in the canvas from its surroundings, working only on the area around it. */
function simpleFill(ctx: CanvasRenderingContext2D, mask: Uint8Array, w: number, h: number) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let i = 0; i < w * h; i++) {
    if (!mask[i]) continue;
    const x = i % w, y = (i / w) | 0;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  if (x1 < 0) return;
  // Enough context around the hole; the whole photo is not needed (and costs ~16 bytes per pixel).
  const m = Math.max(48, Math.round(Math.max(x1 - x0, y1 - y0) * 0.5));
  const cx = Math.max(0, x0 - m), cy = Math.max(0, y0 - m);
  const cw = Math.min(w, x1 + m + 1) - cx, ch = Math.min(h, y1 + m + 1) - cy;
  const part = ctx.getImageData(cx, cy, cw, ch);
  const sub = new Uint8Array(cw * ch);
  for (let y = 0; y < ch; y++) sub.set(mask.subarray((cy + y) * w + cx, (cy + y) * w + cx + cw), y * cw);
  pushPullFill(part.data, sub, cw, ch);
  ctx.putImageData(part, cx, cy);
}

/**
 * Returns the photo with every erase layer painted out, as an object URL (the
 * caller revokes it). AI layers use MI-GAN; "quick" layers, and AI layers when
 * the AI cannot run (download blocked, too little memory), use content-aware fill.
 * `layers` is newest first, as in the scene.
 */
export async function renderErased(
  photoUrl: string,
  layers: EraseLayer[],
  onProgress?: Progress,
  /** The floor's outline in photo pixels, if known: floor and wall are then filled separately. */
  floor?: Pt[],
): Promise<{ url: string; aiFailed: boolean }> {
  const ordered = [...layers].reverse(); // oldest first
  const keys = ordered.map(eraseLayerId);
  const cacheKey = `erased2:${fingerprint(photoUrl)}:${keys.join(".")}`;
  if (last && last.photoUrl === photoUrl && last.keys.join(".") === keys.join(".")) return { url: URL.createObjectURL(last.blob), aiFailed: false };
  const stored = await getCached<Blob>(cacheKey);
  if (stored instanceof Blob) {
    last = { photoUrl, keys, blob: stored };
    return { url: URL.createObjectURL(stored), aiFailed: false };
  }
  const reuse = last && last.photoUrl === photoUrl && last.keys.length <= keys.length && last.keys.every((k, i) => k === keys[i]) ? last : null;

  const img = await loadImage(proxied(photoUrl));
  const f = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * f);
  const h = Math.round(img.naturalHeight * f);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  if (reuse) {
    const bitmap = await createImageBitmap(reuse.blob);
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
  } else ctx.drawImage(img, 0, 0, w, h);
  img.src = "";
  let aiFailed = false;

  for (const layer of ordered.slice(reuse ? reuse.keys.length : 0)) {
    const area = layer.mask ? (await decodeMask(layer.mask, w, h)).mask : polygonMask(layer.points.map(([x, y]) => [x * f, y * f]), w, h);
    // Grow the area a little so outlines and contact shadows go too.
    const mask = dilate(area, w, h, Math.round(Math.max(3, w / 200)));
    if (layer.method === "ai") {
      try {
        await aiInpaint(canvas, mask, onProgress);
        continue;
      } catch (e) {
        console.warn("AI inpainting failed, using simple fill", e);
        aiFailed = true;
      }
    }
    try {
      await patchInpaint(canvas, mask, floor?.map(([x, y]) => [x * f, y * f] as Pt), onProgress);
    } catch (e) {
      console.warn("Content-aware fill failed, using the smooth fill", e);
      simpleFill(ctx, mask, w, h);
    }
  }
  onProgress?.("");
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Gummen mislukt"))), "image/jpeg", 0.94),
  );
  canvas.width = canvas.height = 0; // free the backing store right away (Safari keeps it otherwise)
  last = { photoUrl, keys, blob };
  // Remembered for next time, unless the AI could not run (then it is tried again later).
  if (!aiFailed) putCached(cacheKey, blob);
  return { url: URL.createObjectURL(blob), aiFailed };
}
