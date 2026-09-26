import { canvasToUrl, loadImage, proxied } from "./images";
import { decodeMask, polygonMask } from "./masks";

/**
 * Light and shadow of the room on a new floor or wallpaper.
 *
 * A texture laid over the photo is lit evenly, so it looks pasted on: no light
 * from the window, no shadow under the sofa. We measure how the original
 * surface is lit (its colour, blurred so the old planks or pattern disappear,
 * relative to its average) and put that over the texture: `multiply` for the
 * darker parts, `screen` for the brighter ones. Per colour channel, so warm
 * sunlight stays warm.
 */

/** Working size: lighting is smooth, so a small map is plenty (and cheap). */
const SIDE = 320;

/** Box blur that only averages pixels inside the mask (so the wall does not bleed into the floor). */
function maskedBlur(values: Float32Array, weight: Float32Array, w: number, h: number, r: number, passes = 3): Float32Array {
  let v = values.slice();
  let wt = weight.slice();
  const tmpV = new Float32Array(w * h);
  const tmpW = new Float32Array(w * h);
  const pass = (src: Float32Array, dst: Float32Array, horizontal: boolean) => {
    const [n, m] = horizontal ? [h, w] : [w, h];
    for (let a = 0; a < n; a++) {
      let sum = 0;
      const at = (b: number) => (horizontal ? a * w + b : b * w + a);
      for (let b = -r; b <= r; b++) sum += src[at(Math.min(m - 1, Math.max(0, b)))];
      for (let b = 0; b < m; b++) {
        dst[at(b)] = sum / (2 * r + 1);
        sum += src[at(Math.min(m - 1, b + r + 1))] - src[at(Math.max(0, b - r))];
      }
    }
  };
  for (let i = 0; i < passes; i++) {
    pass(v, tmpV, true);
    pass(tmpV, v, false);
    pass(wt, tmpW, true);
    pass(tmpW, wt, false);
  }
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = wt[i] > 1e-4 ? v[i] / wt[i] : 0;
  return out;
}

export interface ShadingMaps {
  /** RGBA, multiply: 255 = unchanged, darker = shadow. */
  multiply: Uint8ClampedArray;
  /** RGBA, screen: 0 = unchanged, lighter = extra light. */
  screen: Uint8ClampedArray;
}

/**
 * Lighting maps of the masked area of an RGBA image (mask: 1 = the surface).
 * Pure function, so it can be tested and run anywhere.
 */
export function shadingFromPixels(rgba: Uint8ClampedArray, mask: Uint8Array, w: number, h: number, strength = 1): ShadingMaps {
  const n = w * h;
  const weight = new Float32Array(n);
  let count = 0;
  for (let i = 0; i < n; i++) if (mask[i]) (weight[i] = 1), count++;
  const multiply = new Uint8ClampedArray(n * 4).fill(255);
  const screen = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) screen[i * 4 + 3] = 255;
  if (!count) return { multiply, screen };
  // Blur about 2.5% of the image: removes planks and patterns, keeps window light and shadows.
  const r = Math.max(2, Math.round(Math.max(w, h) * 0.025));
  for (let c = 0; c < 3; c++) {
    const ch = new Float32Array(n);
    let mean = 0;
    for (let i = 0; i < n; i++) {
      // Linear light: a shadow halves the light, not the sRGB value.
      const lin = (rgba[i * 4 + c] / 255) ** 2.2;
      ch[i] = lin * weight[i];
      mean += ch[i];
    }
    mean /= count;
    const lit = maskedBlur(ch, weight, w, h, r);
    for (let i = 0; i < n; i++) {
      const ratio = mean > 1e-5 ? (1 + (lit[i] / mean - 1) * strength) : 1;
      // Back to sRGB for the blend (multiply/screen work on displayed values).
      const k = Math.max(0, ratio) ** (1 / 2.2);
      multiply[i * 4 + c] = Math.min(1, k) * 255;
      screen[i * 4 + c] = Math.min(1, Math.max(0, (k - 1) * 0.8)) * 255;
    }
  }
  return { multiply, screen };
}

const cache = new Map<string, Promise<{ multiply: string; screen: string }>>();

/**
 * Lighting maps (object URLs) for a surface in a photo. `area` is the surface's
 * mask PNG or its polygon in photo pixels (photoW × photoH).
 */
export function surfaceShading(
  background: string,
  area: { mask: string } | { points: [number, number][] },
  photoW: number,
  photoH: number,
): Promise<{ multiply: string; screen: string }> {
  const key = `${background}|${"mask" in area ? area.mask : JSON.stringify(area.points)}|${photoW}x${photoH}`;
  let hit = cache.get(key);
  if (!hit) {
    hit = (async () => {
      const f = SIDE / Math.max(photoW, photoH);
      const w = Math.max(1, Math.round(photoW * f));
      const h = Math.max(1, Math.round(photoH * f));
      const img = await loadImage(proxied(background));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(img, 0, 0, w, h);
      const rgba = ctx.getImageData(0, 0, w, h).data;
      const mask =
        "mask" in area ? (await decodeMask(area.mask, w, h)).mask : polygonMask(area.points.map(([x, y]) => [x * f, y * f]), w, h);
      const maps = shadingFromPixels(rgba, mask, w, h);
      const toUrl = (data: Uint8ClampedArray) => {
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        c.getContext("2d")!.putImageData(new ImageData(data as Uint8ClampedArray<ArrayBuffer>, w, h), 0, 0);
        return canvasToUrl(c);
      };
      canvas.width = canvas.height = 0;
      const [multiply, screen] = await Promise.all([toUrl(maps.multiply), toUrl(maps.screen)]);
      return { multiply, screen };
    })();
    cache.set(key, hit);
    hit.catch(() => cache.delete(key));
    // Bounded: the oldest maps are freed.
    while (cache.size > 24) {
      const [oldKey, old] = cache.entries().next().value!;
      cache.delete(oldKey);
      old.then((m) => (URL.revokeObjectURL(m.multiply), URL.revokeObjectURL(m.screen))).catch(() => undefined);
    }
  }
  return hit;
}
