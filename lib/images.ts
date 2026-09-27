/** Same-origin URL for an image, so a canvas can read its pixels (thumbnails). */
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
