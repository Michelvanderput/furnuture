import { polygonMask } from "./masks";
import { project } from "./geometry";
import { imageToPlane, PLANE, planeToImage } from "./plane";
import { furnitureAt, type RegionMap } from "./regions";
import type { Pt, Quad } from "./types";
import { cloudUrl } from "./cloud";
import { isLightMode, isLowMemoryDevice, runAi, type Img, type Progress } from "./worker";

/** Largest crop sent to the AI: MI-GAN works at 512 px internally, more only costs memory. */
const maxCrop = () => (isLightMode() ? 640 : 1024);
/**
 * Content-aware fill works on a smaller crop: it is plain JavaScript. At 480 px a sofa
 * was filled at a third of the photo's resolution and stretched back: a haze. Twice
 * that is sharp and takes a few seconds (in a worker, once per erased object).
 */
const patchCrop = () => (isLightMode() ? 720 : 1000);

/** Fills `hole` (1 = fill) of a crop and returns the crop. `labels`: 1 = floor, 2 = the rest (optional). */
type Solver = (image: Img, hole: Uint8Array, labels: Uint8Array | undefined) => Promise<Img>;

/**
 * Fills the masked area of the canvas (in place) with a solver, working on a crop
 * with context around the object: small objects keep their detail and memory stays
 * low. The result is blended back with a soft edge, so no seam shows.
 * `floor` (photo pixels) separates floor from wall for the content-aware fill.
 */
async function cropInpaint(
  canvas: HTMLCanvasElement,
  mask: Uint8Array,
  maxSide: number,
  solve: Solver,
  floor?: Pt[],
  /** How much wider than the hole the crop is. PatchMatch (unlike a trained AI model)
   * needs real surrounding texture to copy from, and degrades badly once the hole is
   * a large share of its working image — a bigger crop (downscaled to the same
   * `maxSide`) gives it proportionally more of that at every pyramid level. */
  contextFactor = 2,
  /** Furniture per photo pixel (see regions.ts): never a source for the fill. */
  furniture?: (x: number, y: number) => boolean,
): Promise<void> {
  const W = canvas.width;
  const H = canvas.height;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let i = 0; i < W * H; i++) {
    if (!mask[i]) continue;
    const x = i % W, y = (i / W) | 0;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  if (x1 < 0) return;

  // Crop with context around the object, clamped to the photo.
  const side = Math.max(x1 - x0, y1 - y0) * contextFactor;
  const cw = Math.min(W, Math.max(256, side));
  const ch = Math.min(H, Math.max(256, side));
  const cx = Math.round(Math.min(Math.max(0, (x0 + x1) / 2 - cw / 2), W - cw));
  const cy = Math.round(Math.min(Math.max(0, (y0 + y1) / 2 - ch / 2), H - ch));
  const f = Math.min(1, maxSide / Math.max(cw, ch));
  const sw = Math.round(cw * f);
  const sh = Math.round(ch * f);

  const work = document.createElement("canvas");
  work.width = sw;
  work.height = sh;
  const wctx = work.getContext("2d", { willReadFrequently: true })!;
  wctx.drawImage(canvas, cx, cy, cw, ch, 0, 0, sw, sh);
  const image: Img = { data: wctx.getImageData(0, 0, sw, sh).data, width: sw, height: sh };
  const hole = new Uint8Array(sw * sh);
  for (let y = 0; y < sh; y++) {
    const sy = Math.min(H - 1, Math.floor(cy + ((y + 0.5) * ch) / sh));
    for (let x = 0; x < sw; x++) {
      const sx = Math.min(W - 1, Math.floor(cx + ((x + 0.5) * cw) / sw));
      hole[y * sw + x] = mask[sy * W + sx] ? 1 : 0;
    }
  }
  let labels: Uint8Array | undefined;
  if (floor && floor.length >= 3) {
    const inFloor = polygonMask(floor.map(([x, y]) => [(x - cx) * (sw / cw), (y - cy) * (sh / ch)]), sw, sh);
    labels = inFloor.map((v) => (v ? 1 : 2));
  }

  if (furniture) {
    // Never copy from furniture that stays (a table leg printed into the floor).
    labels ??= new Uint8Array(sw * sh).fill(2);
    for (let y = 0; y < sh; y++) {
      const sy = cy + ((y + 0.5) * ch) / sh;
      for (let x = 0; x < sw; x++) if (!hole[y * sw + x] && furniture(cx + ((x + 0.5) * cw) / sw, sy)) labels[y * sw + x] = 0;
    }
  }

  const out = await solve(image, hole, labels);
  wctx.putImageData(new ImageData(new Uint8ClampedArray(out.data), out.width, out.height), 0, 0);

  // Blend back only inside the (softened) mask.
  const patch = document.createElement("canvas");
  patch.width = cw;
  patch.height = ch;
  const pctx = patch.getContext("2d")!;
  pctx.drawImage(work, 0, 0, out.width, out.height, 0, 0, cw, ch);
  const alpha = document.createElement("canvas");
  alpha.width = cw;
  alpha.height = ch;
  const actx = alpha.getContext("2d")!;
  const aimg = actx.createImageData(cw, ch);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) if (mask[(cy + y) * W + cx + x]) aimg.data[(y * cw + x) * 4 + 3] = 255;
  actx.putImageData(aimg, 0, 0);
  pctx.globalCompositeOperation = "destination-in";
  // Soft edge of a few crop pixels: hides the border of the upscaled fill.
  pctx.filter = `blur(${Math.max(1.5, 1.5 / f)}px)`;
  pctx.drawImage(alpha, 0, 0);
  canvas.getContext("2d")!.drawImage(patch, cx, cy);
  // Free canvas memory immediately (Safari keeps backing stores around).
  for (const c of [work, patch, alpha]) c.width = c.height = 0;
}

/**
 * LaMa (~200 MB) gives clearly better fills on big areas like a sofa, but needs
 * more memory than an iPad tab has: computers get LaMa, iPad/iPhone MI-GAN (27 MB).
 */
export const inpaintModel = (): "lama" | "migan" => (isLightMode() || isLowMemoryDevice() ? "migan" : "lama");

/** An image (and its hole) resampled to another size. */
function resized(image: Img, hole: Uint8Array, w: number, h: number): { image: Img; hole: Uint8Array } {
  const src = document.createElement("canvas");
  src.width = image.width;
  src.height = image.height;
  src.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0);
  const dst = document.createElement("canvas");
  dst.width = w;
  dst.height = h;
  const dctx = dst.getContext("2d", { willReadFrequently: true })!;
  dctx.drawImage(src, 0, 0, w, h);
  const out: Img = { data: dctx.getImageData(0, 0, w, h).data, width: w, height: h };
  const m = new Uint8Array(w * h);
  // Nearest-neighbour, but grown: any hole pixel under the resampled one counts.
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor((y * image.height) / h), y1 = Math.max(y0, Math.ceil(((y + 1) * image.height) / h) - 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor((x * image.width) / w), x1 = Math.max(x0, Math.ceil(((x + 1) * image.width) / w) - 1);
      let v = 0;
      for (let yy = y0; yy <= y1 && !v; yy++) for (let xx = x0; xx <= x1 && !v; xx++) v = hole[yy * image.width + xx];
      m[y * w + x] = v;
    }
  }
  src.width = src.height = dst.width = dst.height = 0;
  return { image: out, hole: m };
}

/** Removes the masked area with AI in a worker: LaMa on computers, MI-GAN on iPad (and as fallback). */
export function aiInpaint(canvas: HTMLCanvasElement, mask: Uint8Array, onProgress?: Progress): Promise<void> {
  // MI-GAN on this device, or whatever the AI server runs (LaMa).
  const plain = (image: Img, hole: Uint8Array) => {
    // 255 = keep, 0 = remove.
    const keep = hole.map((v) => (v ? 0 : 255));
    return runAi<Img>({ task: "inpaint", image, mask: keep }, onProgress, [image.data.buffer, keep.buffer]);
  };
  return cropInpaint(canvas, mask, cloudUrl() ? 1024 : maxCrop(), async (image, hole) => {
    // On the AI server (LaMa there) the crop goes as it is.
    if (cloudUrl()) return plain(image, hole);
    if (inpaintModel() === "lama") {
      try {
        // LaMa takes a fixed 512×512 input; the result is scaled back to the crop.
        const sq = resized(image, hole, 512, 512);
        const keep = sq.hole.map((v) => (v ? 0 : 255));
        const out = await runAi<Img>({ task: "inpaint", image: sq.image, mask: keep, model: "lama" }, onProgress, [sq.image.data.buffer, keep.buffer]);
        return resized(out, new Uint8Array(512 * 512), image.width, image.height).image;
      } catch (e) {
        console.warn("LaMa failed, using MI-GAN", e);
      }
    }
    return plain(image, hole);
  });
}

/** Content-aware fill (lib/patchFill.ts) in its own worker, so the page stays responsive. */
function runFill(image: Img, hole: Uint8Array, labels: Uint8Array | undefined, lowVariancePenalty?: number): Promise<Img> {
  return new Promise<Img>((resolve, reject) => {
    const worker = new Worker(new URL("./fill.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<Img>) => (worker.terminate(), resolve(e.data));
    worker.onerror = (e) => (worker.terminate(), reject(new Error(e.message || "Gummen mislukt")));
    worker.postMessage({ image, hole, labels, lowVariancePenalty }, [image.data.buffer]);
  });
}

/** Region label for pixels that are no part of the picture (never copied, never filled). */
const VOID = 255;
/** Size of the top-down floor view the fill works in (400 left the floor near the camera blurry). */
const rectSide = () => (isLightMode() ? 600 : 900);

/**
 * Fills the floor part of the hole in a top-down view of the floor. In the photo,
 * planks and tiles shrink with depth, so no piece of floor matches another; seen
 * from above they repeat, the fill can continue them, and projecting back puts them
 * in perspective again. Returns the part of the mask that is not floor.
 */
async function fillFloorFromAbove(
  canvas: HTMLCanvasElement,
  mask: Uint8Array,
  quad: Quad,
  furniture?: (x: number, y: number) => boolean,
): Promise<Uint8Array> {
  const W = canvas.width, H = canvas.height;
  const inFloor = polygonMask(quad, W, H);
  const toPlane = imageToPlane(quad);
  const toImage = planeToImage(quad);
  // Plane area around the floor part of the hole, with context.
  let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity, any = false;
  for (let y = 0; y < H; y += 2) {
    for (let x = 0; x < W; x += 2) {
      const i = y * W + x;
      if (!mask[i] || !inFloor[i]) continue;
      const [u, v] = project(toPlane, [x, y]);
      any = true;
      if (u < u0) u0 = u;
      if (u > u1) u1 = u;
      if (v < v0) v0 = v;
      if (v > v1) v1 = v;
    }
  }
  const rest = mask.map((m, i) => (m && !inFloor[i] ? 1 : 0));
  if (!any) return mask;
  const mu = Math.max(40, (u1 - u0) * 0.6), mv = Math.max(40, (v1 - v0) * 0.6);
  u0 = Math.max(0, u0 - mu), u1 = Math.min(PLANE, u1 + mu), v0 = Math.max(0, v0 - mv), v1 = Math.min(PLANE, v1 + mv);
  const scale = rectSide() / Math.max(u1 - u0, v1 - v0);
  const rw = Math.max(8, Math.round((u1 - u0) * scale)), rh = Math.max(8, Math.round((v1 - v0) * scale));

  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const photo = ctx.getImageData(0, 0, W, H);
  const src = photo.data;
  const data = new Uint8ClampedArray(rw * rh * 4);
  const hole = new Uint8Array(rw * rh);
  const labels = new Uint8Array(rw * rh);
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const j = y * rw + x;
      const [px, py] = project(toImage, [u0 + (x + 0.5) / scale, v0 + (y + 0.5) / scale]);
      const ix = Math.round(px), iy = Math.round(py);
      data[j * 4 + 3] = 255;
      if (ix < 0 || iy < 0 || ix >= W || iy >= H || !inFloor[iy * W + ix]) {
        labels[j] = VOID;
        continue;
      }
      const i = iy * W + ix;
      // Floor (and rugs); furniture standing on it is never copied.
      labels[j] = !mask[i] && furniture?.(ix, iy) ? 0 : 1;
      if (mask[i]) hole[j] = 1;
      else for (let c = 0; c < 3; c++) data[j * 4 + c] = src[i * 4 + c];
    }
  }
  // Seen from above, anything standing on the floor (a table leg, a radiator) is stretched
  // into long streaks: the most "textured" patches there, so a strong preference for
  // texture pulled those streaks into the floor. Much weaker here.
  const out = await runFill({ data, width: rw, height: rh }, hole, labels, 20_000);

  // Back into the photo: every floor pixel of the hole samples the filled top-down view.
  const o = out.data;
  const sample = (x: number, y: number, c: number) => {
    const fx = Math.min(rw - 1, Math.max(0, x)), fy = Math.min(rh - 1, Math.max(0, y));
    const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(rw - 1, x0 + 1), y1 = Math.min(rh - 1, y0 + 1);
    const ax = fx - x0, ay = fy - y0;
    const at = (xx: number, yy: number) => o[(yy * rw + xx) * 4 + c];
    return at(x0, y0) * (1 - ax) * (1 - ay) + at(x1, y0) * ax * (1 - ay) + at(x0, y1) * (1 - ax) * ay + at(x1, y1) * ax * ay;
  };
  for (let i = 0; i < W * H; i++) {
    if (!mask[i] || !inFloor[i]) continue;
    const [u, v] = project(toPlane, [i % W, (i / W) | 0]);
    const rx = (u - u0) * scale - 0.5, ry = (v - v0) * scale - 0.5;
    for (let c = 0; c < 3; c++) src[i * 4 + c] = sample(rx, ry, c);
  }
  ctx.putImageData(photo, 0, 0);
  return rest;
}

/**
 * Removes the masked area without AI: content-aware fill. With a known floor, the
 * floor part is filled in a top-down view (planks continue in perspective) and the
 * rest (wall, skirting) from the non-floor part of the photo.
 */
export async function patchInpaint(
  canvas: HTMLCanvasElement,
  mask: Uint8Array,
  floor?: Pt[],
  onProgress?: Progress,
  /** The room recognition, when known: the fill never copies from furniture. */
  regionMap?: RegionMap,
): Promise<void> {
  onProgress?.("Gummen…");
  const furniture = regionMap ? furnitureAt(regionMap, canvas.width, canvas.height) : undefined;
  let rest = mask;
  if (floor?.length === 4) {
    try {
      rest = await fillFloorFromAbove(canvas, mask, floor as Quad, furniture);
    } catch (e) {
      console.warn("Floor fill failed", e);
    }
  }
  if (!rest.some(Boolean)) return;
  await cropInpaint(canvas, rest, patchCrop(), runFill, floor, 3, furniture);
}
