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
