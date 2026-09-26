import type { Progress } from "./ai";
import { loadImage, proxied } from "./images";
import { aiInpaint } from "./aiInpaint";
import { dilate, ensureMask, extendDown, polygonMask } from "./masks";
import type { EraseLayer } from "./types";

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

/**
 * Returns the photo with every erase layer painted out, as a JPEG data URL.
 * AI layers use MI-GAN; if that cannot run (download blocked, too little memory)
 * they fall back to the push-pull fill.
 */
export async function renderErased(
  photoUrl: string,
  layers: EraseLayer[],
  onProgress?: Progress,
): Promise<{ url: string; aiFailed: boolean }> {
  const img = await loadImage(proxied(photoUrl));
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  let aiFailed = false;

  for (const layer of layers) {
    const area = layer.mask ? await ensureMask(layer.mask, w, h) : polygonMask(layer.points, w, h);
    // Generous margin: the model must not see any rim of the old object, nor its contact shadow below it.
    const mask = dilate(extendDown(area, w, h, Math.round(h * 0.02)), w, h, Math.round(Math.max(4, w * 0.008)));
    if (layer.method === "ai") {
      try {
        await aiInpaint(canvas, mask, onProgress);
        continue;
      } catch (e) {
        console.warn("AI inpainting failed, using simple fill", e);
        aiFailed = true;
      }
    }
    const photo = ctx.getImageData(0, 0, w, h);
    pushPullFill(photo.data, mask, w, h);
    ctx.putImageData(photo, 0, 0);
  }
  onProgress?.("");
  const url = canvas.toDataURL("image/jpeg", 0.92);
  canvas.width = canvas.height = 0; // free the backing store right away (Safari keeps it otherwise)
  return { url, aiFailed };
}
