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
