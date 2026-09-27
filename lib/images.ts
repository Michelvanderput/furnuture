/** Same-origin URL for an image, so canvas and in-browser AI can read its pixels. */
export function proxied(url: string): string {
  if (!url || url.startsWith("data:") || url.startsWith("blob:") || url.startsWith("/")) return url;
  return `/api/image?url=${encodeURIComponent(url)}`;
}

/**
 * Canvas to an object URL (and frees the canvas). Blob URLs keep the image as
 * compact bytes outside the JS heap; multi-MB data-URL strings in React state
 * were a main cause of tabs running out of memory. Revoke with `releaseUrl`.
 */
export function canvasToUrl(canvas: HTMLCanvasElement, type = "image/png", quality?: number): Promise<string> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => {
        canvas.width = canvas.height = 0; // free the backing store right away (Safari keeps it otherwise)
        if (blob) resolve(URL.createObjectURL(blob));
        else reject(new Error("Afbeelding maken mislukt"));
      },
      type,
      quality,
    ),
  );
}

/** Frees an object URL made by `canvasToUrl` (other URLs are ignored). */
export function releaseUrl(url: string | undefined | null): void {
  if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Kon afbeelding niet laden: ${src}`));
    img.src = src;
  });
}

/** Reads an uploaded file into a downscaled JPEG data URL (keeps storage small). */
export async function fileToDataUrl(file: File, maxSide = 1600): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export class NoPlainBackground extends Error {}

/**
 * Removes a plain (near-white) product-photo background without AI.
 * Flood fill from the image border over pixels close to the corner colour, but
 * never across a visible edge: a light cushion next to a white background has a
 * (subtle) outline, so the fill stops there instead of eating into the furniture.
 */
export async function removeBackground(src: string, tolerance = 18): Promise<string> {
  const img = await loadImage(proxied(src));
  const maxSide = 1200;
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h);
  const px = data.data;

  // Reference colour: average of the four corners. If the corners differ a lot
  // this is a sfeerfoto, not a packshot, and there is no plain background.
  const corners = [0, w - 1, (h - 1) * w, h * w - 1];
  const ref = [0, 1, 2].map((c) => corners.reduce((s, i) => s + px[i * 4 + c], 0) / 4);
  const diff = (i: number, j: number) =>
    Math.max(Math.abs(px[i * 4] - px[j * 4]), Math.abs(px[i * 4 + 1] - px[j * 4 + 1]), Math.abs(px[i * 4 + 2] - px[j * 4 + 2]));
  const dist = (i: number) =>
    Math.max(Math.abs(px[i * 4] - ref[0]), Math.abs(px[i * 4 + 1] - ref[1]), Math.abs(px[i * 4 + 2] - ref[2]));
  if (corners.some((i) => dist(i) > 40)) throw new NoPlainBackground("Geen effen achtergrond");

  const edgeTolerance = Math.max(3, tolerance * 0.35);
  const background = new Uint8Array(w * h);
  const stack: number[] = [];
  const seed = (i: number) => {
    if (!background[i] && dist(i) <= tolerance) {
      background[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < w; x++) seed(x), seed((h - 1) * w + x);
  for (let y = 0; y < h; y++) seed(y * w), seed(y * w + w - 1);
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    for (const n of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
      if (n < 0 || n >= w * h || background[n]) continue;
      if (dist(n) <= tolerance && diff(i, n) <= edgeTolerance) {
        background[n] = 1;
        stack.push(n);
      }
    }
  }

  // Packshots usually have a soft grey floor shadow under the product. Left as it
  // is, it becomes a grey slab on the room's floor. Neutral pixels darker than the
  // background, reached smoothly from it, are that shadow: they become black with
  // matching transparency, so the product casts the same soft shadow in the room.
  const refLum = 0.299 * ref[0] + 0.587 * ref[1] + 0.114 * ref[2];
  const lum = (i: number) => 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
  const neutral = (i: number) =>
    Math.max(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]) - Math.min(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]) <= 14;
  const shadow = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) if (background[i]) stack.push(i);
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    for (const n of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
      if (n < 0 || n >= w * h || background[n] || shadow[n]) continue;
      const l = lum(n);
      if (neutral(n) && l < refLum && l > refLum * 0.3 && diff(i, n) <= edgeTolerance * 1.5) {
        shadow[n] = 1;
        stack.push(n);
      }
    }
  }

  for (let i = 0; i < w * h; i++) {
    if (background[i]) {
      px[i * 4 + 3] = 0;
      continue;
    }
    if (shadow[i]) {
      const dark = Math.min(1, ((refLum - lum(i)) / refLum) * 1.3);
      px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = 0;
      px[i * 4 + 3] = Math.round(dark * 255);
      continue;
    }
    // Soften pixels that touch the background.
    const x = i % w;
    const edge =
      (x > 0 && background[i - 1]) ||
      (x < w - 1 && background[i + 1]) ||
      (i >= w && background[i - w]) ||
      (i < w * (h - 1) && background[i + w]);
    if (edge) px[i * 4 + 3] = 170;
  }
  ctx.putImageData(data, 0, 0);
  return canvasToUrl(canvas);
}

/** The centre part of an image (fraction 0..1 of each side), e.g. to use a floor photo as texture. */
export async function cropCenter(src: string, fraction: number, maxSide = 800): Promise<string> {
  const img = await loadImage(proxied(src));
  const f = Math.min(1, Math.max(0.05, fraction));
  const sw = img.naturalWidth * f;
  const sh = img.naturalHeight * f;
  const scale = Math.min(1, maxSide / Math.max(sw, sh));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(sw * scale);
  canvas.height = Math.round(sh * scale);
  canvas
    .getContext("2d")!
    .drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvasToUrl(canvas, "image/jpeg", 0.9);
}

const rotations = new Map<string, Promise<string>>();

/** A texture turned 90°, e.g. floor planks running the other way (cached). */
export function rotatedTexture(src: string): Promise<string> {
  let hit = rotations.get(src);
  if (!hit) {
    hit = loadImage(proxied(src)).then((img) => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalHeight;
      canvas.height = img.naturalWidth;
      const ctx = canvas.getContext("2d")!;
      ctx.translate(canvas.width, 0);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(img, 0, 0);
      return canvasToUrl(canvas, "image/jpeg", 0.92);
    });
    rotations.set(src, hit);
    hit.catch(() => rotations.delete(src));
    while (rotations.size > 20) {
      const [k, old] = rotations.entries().next().value!;
      rotations.delete(k);
      old.then(releaseUrl).catch(() => undefined);
    }
  }
  return hit;
}

/**
 * Product-list thumbnail: the photo with its plain (white) margins trimmed so the
 * product fills the card, on white, at most `maxSide` px, as a small JPEG.
 */
export async function productThumb(src: string, maxSide = 360): Promise<string> {
  const img = await loadImage(proxied(src));
  const W = img.naturalWidth, H = img.naturalHeight;
  if (!W || !H) throw new Error("Lege afbeelding");
  // Find the margins on a small copy.
  const s = Math.min(1, 240 / Math.max(W, H));
  const sw = Math.max(1, Math.round(W * s)), sh = Math.max(1, Math.round(H * s));
  const probe = document.createElement("canvas");
  probe.width = sw;
  probe.height = sh;
  const pctx = probe.getContext("2d", { willReadFrequently: true })!;
  pctx.fillStyle = "#fff";
  pctx.fillRect(0, 0, sw, sh);
  pctx.drawImage(img, 0, 0, sw, sh);
  const d = pctx.getImageData(0, 0, sw, sh).data;
  const bg = [d[0], d[1], d[2]];
  const differs = (i: number) => Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]) > 30;
  let x0 = sw, y0 = sh, x1 = -1, y1 = -1;
  for (let y = 0; y < sh; y++)
    for (let x = 0; x < sw; x++)
      if (differs((y * sw + x) * 4)) (x0 = Math.min(x0, x)), (x1 = Math.max(x1, x)), (y0 = Math.min(y0, y)), (y1 = Math.max(y1, y));
  // Only trim a plain margin; a photo in a room has none.
  let cx = 0, cy = 0, cw = W, ch = H;
  if (x1 >= x0 && y1 >= y0) {
    const pad = 0.04 * Math.max(x1 - x0, y1 - y0);
    cx = Math.max(0, (x0 - pad) / s);
    cy = Math.max(0, (y0 - pad) / s);
    cw = Math.min(W, (x1 + 1 + pad) / s) - cx;
    ch = Math.min(H, (y1 + 1 + pad) / s) - cy;
  }
  const k = Math.min(1, maxSide / Math.max(cw, ch));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(cw * k));
  canvas.height = Math.max(1, Math.round(ch * k));
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, cx, cy, cw, ch, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85);
}

/** First image of the list that actually loads, with its thumbnail (one at a time, gentle on an iPad). */
let thumbQueue: Promise<unknown> = Promise.resolve();
export function firstWorkingThumb(urls: string[]): Promise<{ image: string; thumb: string } | null> {
  const job = thumbQueue.then(async () => {
    for (const image of urls.slice(0, 6)) {
      try {
        return { image, thumb: await productThumb(image) };
      } catch {
        // try the next one
      }
    }
    return null;
  });
  thumbQueue = job.catch(() => null);
  return job;
}

/**
 * A cut-out trimmed to the object itself (plus a hair of margin): the empty,
 * transparent border of a product photo made furniture stand above the floor
 * line, with its feet in the air. Returns the new image and its height/width.
 */
export async function trimToContent(url: string): Promise<{ url: string; aspect: number }> {
  const img = await loadImage(url);
  const W = img.naturalWidth, H = img.naturalHeight;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, W, H).data;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (d[(y * W + x) * 4 + 3] < 40) continue; // faint packshot shadow and noise do not count
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  const pad = Math.round(Math.max(x1 - x0, y1 - y0) * 0.01);
  x0 = Math.max(0, x0 - pad), y0 = Math.max(0, y0 - pad), x1 = Math.min(W - 1, x1 + pad), y1 = Math.min(H - 1, y1 + pad);
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  if (x1 < 0 || (w >= W * 0.98 && h >= H * 0.98)) {
    c.width = c.height = 0;
    return { url, aspect: H / W };
  }
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  out.getContext("2d")!.drawImage(c, x0, y0, w, h, 0, 0, w, h);
  c.width = c.height = 0;
  const trimmed = await canvasToUrl(out);
  releaseUrl(url);
  return { url: trimmed, aspect: h / w };
}
