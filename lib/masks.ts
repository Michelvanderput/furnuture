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

/** Decodes a PNG mask to a binary mask of w×h (default: the PNG's own size). Not cached. */
export function decodeMask(url: string, w?: number, h?: number): Promise<{ w: number; h: number; mask: Uint8Array }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const W = w ?? img.naturalWidth;
      const H = h ?? img.naturalHeight;
      const canvas = document.createElement("canvas");
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(img, 0, 0, W, H);
      const d = ctx.getImageData(0, 0, W, H).data;
      canvas.width = canvas.height = 0; // free the backing store right away (Safari keeps it otherwise)
      const mask = new Uint8Array(W * H);
      for (let i = 0; i < W * H; i++) mask[i] = d[i * 4 + 3] > 127 ? 1 : 0;
      resolve({ w: W, h: H, mask });
    };
    img.onerror = reject;
    img.src = url;
  });
}

/**
 * Masks for hit-testing, kept at their own (small, ~480 px) size in a bounded
 * cache. Decoding them at photo size and keeping them forever used to cost
 * several MB per mask and grew with every photo visited.
 */
type Hit = { w: number; h: number; mask: Uint8Array };
const MAX_HITS = 40;
const hits = new Map<string, Hit>();
const pendingHits = new Map<string, Promise<Hit>>();

function remember(url: string, hit: Hit) {
  hits.delete(url);
  hits.set(url, hit);
  while (hits.size > MAX_HITS) hits.delete(hits.keys().next().value!);
}

export const rememberMask = (url: string, w: number, h: number, mask: Uint8Array) => remember(url, { w, h, mask });

/** Loads a mask into the hit cache (no-op when it is there already). */
export function loadHitMask(url: string): Promise<Hit> {
  const hit = hits.get(url);
  if (hit) return Promise.resolve(hit);
  let p = pendingHits.get(url);
  if (!p) {
    p = decodeMask(url)
      .then((m) => (remember(url, m), m))
      .finally(() => pendingHits.delete(url));
    pendingHits.set(url, p);
  }
  return p;
}

/** Is photo point (x, y) of a W×H photo inside the mask? Undefined while the mask is not decoded yet. */
export function maskHit(url: string, x: number, y: number, W: number, H: number): boolean | undefined {
  const m = hits.get(url);
  if (!m) return undefined;
  const mx = Math.min(m.w - 1, Math.max(0, Math.floor((x * m.w) / W)));
  const my = Math.min(m.h - 1, Math.max(0, Math.floor((y * m.h) / H)));
  return !!m.mask[my * m.w + mx];
}
