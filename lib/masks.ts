/** Binary masks (1 byte per pixel) and their PNG form used by layers. */

export function dilate(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return mask;
  // Separable max filter: horizontal pass, then vertical.
  const tmp = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    let last = -Infinity;
    for (let x = 0; x < w; x++) if (mask[y * w + x]) last = x;
      else if (x - last <= r) tmp[y * w + x] = 1;
    last = Infinity;
    for (let x = w - 1; x >= 0; x--) {
      if (mask[y * w + x]) (last = x), (tmp[y * w + x] = 1);
      else if (last - x <= r) tmp[y * w + x] = 1;
    }
  }
  const out = new Uint8Array(w * h);
  for (let x = 0; x < w; x++) {
    let last = -Infinity;
    for (let y = 0; y < h; y++) if (tmp[y * w + x]) (last = y), (out[y * w + x] = 1);
      else if (y - last <= r) out[y * w + x] = 1;
    last = Infinity;
    for (let y = h - 1; y >= 0; y--) if (tmp[y * w + x]) last = y;
      else if (last - y <= r) out[y * w + x] = 1;
  }
  return out;
}

/** 4-connected components; returns a label per pixel (0 = none) and the pixel count per label. */
export function components(mask: Uint8Array, w: number, h: number): { labels: Int32Array; sizes: number[] } {
  const labels = new Int32Array(w * h);
  const sizes = [0];
  const stack: number[] = [];
  for (let start = 0; start < w * h; start++) {
    if (!mask[start] || labels[start]) continue;
    const id = sizes.length;
    let size = 0;
    labels[start] = id;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop()!;
      size++;
      const x = i % w;
      for (const n of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i >= w ? i - w : -1, i < w * (h - 1) ? i + w : -1]) {
        if (n >= 0 && mask[n] && !labels[n]) {
          labels[n] = id;
          stack.push(n);
        }
      }
    }
    sizes.push(size);
  }
  return { labels, sizes };
}

export function polygonMask(polygon: [number, number][], w: number, h: number): Uint8Array {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.beginPath();
  polygon.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fill();
  const d = ctx.getImageData(0, 0, w, h).data;
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = d[i * 4 + 3] > 127 ? 1 : 0;
  return out;
}

/** Mask as an orange PNG: its alpha is the area, the colour doubles as highlight. */
export function maskToDataUrl(mask: Uint8Array, w: number, h: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    if (!mask[i]) continue;
    img.data.set([233, 96, 31, 255], i * 4);
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL("image/png");
}

const decoded = new Map<string, Promise<{ w: number; h: number; mask: Uint8Array }>>();

/** PNG mask back to a binary mask, resized to w×h (cached). */
export function decodeMask(url: string, w: number, h: number): Promise<{ w: number; h: number; mask: Uint8Array }> {
  const key = `${w}x${h}:${url}`;
  if (!decoded.has(key)) {
    decoded.set(
      key,
      new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
          ctx.drawImage(img, 0, 0, w, h);
          const d = ctx.getImageData(0, 0, w, h).data;
          const mask = new Uint8Array(w * h);
          for (let i = 0; i < w * h; i++) mask[i] = d[i * 4 + 3] > 127 ? 1 : 0;
          resolve({ w, h, mask });
        };
        img.onerror = reject;
        img.src = url;
      }),
    );
  }
  return decoded.get(key)!;
}

/** Synchronous lookup for masks that were decoded (or created) before. */
const ready = new Map<string, Uint8Array>();
export const rememberMask = (url: string, w: number, h: number, mask: Uint8Array) => ready.set(`${w}x${h}:${url}`, mask);
export const readyMask = (url: string, w: number, h: number) => ready.get(`${w}x${h}:${url}`);
export async function ensureMask(url: string, w: number, h: number): Promise<Uint8Array> {
  const hit = readyMask(url, w, h);
  if (hit) return hit;
  const { mask } = await decodeMask(url, w, h);
  rememberMask(url, w, h, mask);
  return mask;
}

export function erode(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const inv = new Uint8Array(w * h);
  for (let i = 0; i < inv.length; i++) inv[i] = mask[i] ? 0 : 1;
  // Pixels at the photo border count as outside too.
  for (let x = 0; x < w; x++) (inv[x] = 1), (inv[(h - 1) * w + x] = 1);
  for (let y = 0; y < h; y++) (inv[y * w] = 1), (inv[y * w + w - 1] = 1);
  const grown = dilate(inv, w, h, r);
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = grown[i] ? 0 : 1;
  return out;
}

/**
 * A few points well inside a mask, spread over it (farthest-point sampling,
 * starting from `start`). Used as extra "this is the object" taps for SAM, so it
 * selects the whole sofa instead of one cushion.
 */
export function interiorPoints(mask: Uint8Array, w: number, h: number, count: number, start: [number, number]): [number, number][] {
  let inner = erode(mask, w, h, Math.max(2, Math.round(Math.min(w, h) / 60)));
  if (!inner.some(Boolean)) inner = mask;
  const cand: [number, number][] = [];
  const step = Math.max(1, Math.round(Math.sqrt((w * h) / 20000)));
  for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) if (inner[y * w + x]) cand.push([x, y]);
  if (!cand.length) return [];
  const chosen: [number, number][] = [start];
  const out: [number, number][] = [];
  for (let n = 0; n < count; n++) {
    let best: [number, number] | null = null, bd = -1;
    for (const c of cand) {
      const d = Math.min(...chosen.map((p) => (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2));
      if (d > bd) (bd = d), (best = c);
    }
    if (!best) break;
    chosen.push(best);
    out.push(best);
  }
  return out;
}

/** Fill holes (areas not connected to the mask's outside). */
export function fillHoles(mask: Uint8Array, w: number, h: number): Uint8Array {
  const outside = new Uint8Array(w * h);
  const stack: number[] = [];
  const push = (i: number) => !outside[i] && !mask[i] && ((outside[i] = 1), stack.push(i));
  for (let x = 0; x < w; x++) push(x), push((h - 1) * w + x);
  for (let y = 0; y < h; y++) push(y * w), push(y * w + w - 1);
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (i >= w) push(i - w);
    if (i < w * (h - 1)) push(i + w);
  }
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = outside[i] ? 0 : 1;
  return out;
}

/** Drop loose specks: keep parts that are big (≥ minShare of the whole) or contain the seed. */
export function dropSpecks(mask: Uint8Array, w: number, h: number, seed?: [number, number], minShare = 0.03): Uint8Array {
  const { labels, sizes } = components(mask, w, h);
  const total = sizes.reduce((s, v) => s + v, 0);
  const seedLabel = seed ? labels[Math.round(seed[1]) * w + Math.round(seed[0])] : 0;
  const keep = sizes.map((sz, i) => i > 0 && (sz >= total * minShare || i === seedLabel));
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = keep[labels[i]] ? 1 : 0;
  return out;
}

/** Paint a filled circle into a mask (brush). */
export function paintCircle(mask: Uint8Array, w: number, h: number, cx: number, cy: number, r: number, value: 0 | 1) {
  for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(h - 1, Math.ceil(cy + r)); y++) {
    for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(w - 1, Math.ceil(cx + r)); x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) mask[y * w + x] = value;
    }
  }
}

/** Grow a mask downwards by `s` pixels: furniture casts a contact shadow right below it. */
export function extendDown(mask: Uint8Array, w: number, h: number, s: number): Uint8Array {
  const out = mask.slice();
  for (let x = 0; x < w; x++) {
    let since = Infinity;
    for (let y = 0; y < h; y++) {
      if (mask[y * w + x]) since = 0;
      else if (++since <= s) out[y * w + x] = 1;
    }
  }
  return out;
}
