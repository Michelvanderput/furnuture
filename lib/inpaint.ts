import { loadImage, proxied } from "./images";
import type { Pt } from "./types";

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

/** Returns the photo with the given polygons painted out, as a JPEG data URL. */
export async function erasePolygons(photoUrl: string, polygons: Pt[][]): Promise<string> {
  const img = await loadImage(proxied(photoUrl));
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

  // Rasterise the mask (slightly grown, so object outlines disappear too).
  ctx.fillStyle = "#000";
  ctx.strokeStyle = "#000";
  ctx.lineWidth = Math.max(4, w / 250);
  ctx.lineJoin = "round";
  for (const poly of polygons) {
    ctx.beginPath();
    poly.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  const maskData = ctx.getImageData(0, 0, w, h).data;
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) mask[i] = maskData[i * 4 + 3] > 0 ? 1 : 0;

  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0);
  const photo = ctx.getImageData(0, 0, w, h);
  pushPullFill(photo.data, mask, w, h);
  ctx.putImageData(photo, 0, 0);
  return canvas.toDataURL("image/jpeg", 0.92);
}
