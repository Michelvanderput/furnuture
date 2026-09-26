/** Pure helpers shared by the page and the AI worker (no DOM access). */

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
