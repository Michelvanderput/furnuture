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

/**
 * SAM predicts a 256×256 mask (logits) for its 1024×1024 input: the photo scaled
 * so its long side is 1024 (rw×rh), padded at the right/bottom. Sample that mask
 * straight into an outW×outH mask of the photo (bilinear, then > 0).
 */
export function samMaskToPhoto(
  logits: Float32Array,
  rw: number,
  rh: number,
  outW: number,
  outH: number,
  low = 256,
  pad = 1024,
): Uint8Array {
  const out = new Uint8Array(outW * outH);
  const k = low / pad;
  for (let y = 0; y < outH; y++) {
    const my = Math.min(low - 1, Math.max(0, ((y + 0.5) * rh) / outH * k - 0.5));
    const y0 = Math.floor(my), y1 = Math.min(low - 1, y0 + 1), fy = my - y0;
    for (let x = 0; x < outW; x++) {
      const mx = Math.min(low - 1, Math.max(0, ((x + 0.5) * rw) / outW * k - 0.5));
      const x0 = Math.floor(mx), x1 = Math.min(low - 1, x0 + 1), fx = mx - x0;
      const v =
        logits[y0 * low + x0] * (1 - fx) * (1 - fy) +
        logits[y0 * low + x1] * fx * (1 - fy) +
        logits[y1 * low + x0] * (1 - fx) * fy +
        logits[y1 * low + x1] * fx * fy;
      out[y * outW + x] = v > 0 ? 1 : 0;
    }
  }
  return out;
}

/** Working resolution for recognition masks: long side 480 px. */
export function workSize(w: number, h: number, side = 480): { w: number; h: number } {
  const f = side / Math.max(w, h);
  return { w: Math.round(w * f), h: Math.round(h * f) };
}

/** Half-precision float (IEEE 754 binary16 bits) to a number. */
function half(h: number): number {
  const s = h & 0x8000 ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const f = h & 0x3ff;
  if (e === 0) return s * f * 2 ** -24;
  if (e === 31) return f ? NaN : s * Infinity;
  return s * (1 + f / 1024) * 2 ** (e - 15);
}

/** Tensor data as float32; fp16 models (WebGPU) return half floats as raw 16-bit values. */
export function toFloat32(tensor: { type?: string; data: ArrayLike<number> }): Float32Array {
  const d = tensor.data;
  if (d instanceof Float32Array) return d;
  if (tensor.type === "float16" && d instanceof Uint16Array) {
    const out = new Float32Array(d.length);
    for (let i = 0; i < d.length; i++) out[i] = half(d[i]);
    return out;
  }
  return Float32Array.from(d);
}
