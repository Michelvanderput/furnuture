/** Same-origin URL for an image, so canvas and in-browser AI can read its pixels. */
export function proxied(url: string): string {
  if (!url || url.startsWith("data:") || url.startsWith("blob:") || url.startsWith("/")) return url;
  return `/api/image?url=${encodeURIComponent(url)}`;
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

  for (let i = 0; i < w * h; i++) {
    if (background[i]) {
      px[i * 4 + 3] = 0;
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
  return canvas.toDataURL("image/png");
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
  return canvas.toDataURL("image/jpeg", 0.9);
}
