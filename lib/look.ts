import { loadImage, proxied } from "./images";

/**
 * Makes a studio packshot fit the room without AI: product photos are brighter and
 * more neutral than a lived-in room, so we dim and warm them to match the photo.
 */
export interface Look {
  /** CSS brightness() for products in this photo. */
  light: number;
  /** CSS sepia() amount: warm rooms get warmer products. */
  warmth: number;
}

const cache = new Map<string, Promise<Look>>();

export function photoLook(photoUrl: string): Promise<Look> {
  if (!cache.has(photoUrl)) {
    cache.set(
      photoUrl,
      loadImage(proxied(photoUrl)).then((img) => {
        const c = document.createElement("canvas");
        c.width = c.height = 48;
        const ctx = c.getContext("2d", { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0, 48, 48);
        const d = ctx.getImageData(0, 0, 48, 48).data;
        let lum = 0, warm = 0;
        for (let i = 0; i < d.length; i += 4) {
          lum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
          warm += d[i] - d[i + 2];
        }
        const n = d.length / 4;
        return lookFromStats(lum / n, warm / n);
      }),
    );
  }
  return cache.get(photoUrl)!;
}

/** Mean luminance (0..255) and mean red-minus-blue of the room -> product look. */
export function lookFromStats(meanLum: number, meanWarm: number): Look {
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  return {
    light: +clamp(0.55 + (0.5 * meanLum) / 255, 0.7, 1.05).toFixed(2),
    warmth: +clamp((meanWarm / 255) * 1.5, 0, 0.3).toFixed(2),
  };
}

export const productFilter = (light = 1, warmth = 0) => `brightness(${light}) sepia(${warmth}) saturate(${1 - warmth / 3})`;

/**
 * Where the light comes from, horizontally: -1 = from the left, 1 = from the
 * right, 0 = frontal or unclear. The centroid of the brightest pixels (a window,
 * a sunlit wall) relative to the middle of the photo. RGBA pixels of a small thumbnail.
 */
export function lightSideFromPixels(data: Uint8ClampedArray, w: number, h: number): number {
  const n = w * h;
  const lum = new Float32Array(n);
  for (let i = 0; i < n; i++) lum[i] = 0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2];
  const sorted = Float32Array.from(lum).sort();
  const threshold = sorted[Math.floor(n * 0.96)];
  const spread = sorted[Math.floor(n * 0.96)] - sorted[Math.floor(n * 0.5)];
  if (spread < 25) return 0; // evenly lit: no clear direction
  let sx = 0, count = 0;
  for (let i = 0; i < n; i++) if (lum[i] >= threshold) (sx += (i % w) + 0.5), count++;
  const side = (sx / count / w - 0.5) * 2;
  return Math.abs(side) < 0.15 ? 0 : +Math.max(-1, Math.min(1, side * 1.4)).toFixed(2);
}

const sides = new Map<string, Promise<number>>();

/** Light direction of a room photo (cached per photo). */
export function photoLightSide(photoUrl: string): Promise<number> {
  if (!sides.has(photoUrl)) {
    sides.set(
      photoUrl,
      loadImage(proxied(photoUrl)).then((img) => {
        const w = 64, h = Math.max(1, Math.round((64 * img.naturalHeight) / img.naturalWidth));
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        const ctx = c.getContext("2d", { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0, w, h);
        return lightSideFromPixels(ctx.getImageData(0, 0, w, h).data, w, h);
      }),
    );
  }
  return sides.get(photoUrl)!;
}

/**
 * Shade over a product for side light: the side away from the light gets darker.
 * `side` from `photoLightSide`, `strength` 0..1 (layer setting). CSS gradient, in
 * the product image's own orientation (mirrored products flip it back).
 */
export function sideShade(side: number, strength: number, flip: boolean): string | null {
  const a = Math.abs(side) * strength * 0.42;
  if (a < 0.02) return null;
  const towardsRight = (side < 0) !== flip; // light from the left: the right side is darker
  return `linear-gradient(to ${towardsRight ? "right" : "left"}, rgba(255,250,240,${(a * 0.25).toFixed(3)}) 0%, rgba(0,0,0,0) 45%, rgba(0,0,0,${a.toFixed(3)}) 100%)`;
}
