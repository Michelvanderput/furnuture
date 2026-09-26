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

/**
 * Removes a plain (near-white) product-photo background without AI:
 * flood fill from the image border over pixels close to the corner colour,
 * then feather the edge. Works well for webshop packshots on white.
 */
export async function removeBackground(src: string, tolerance = 28): Promise<string> {
  const img = await loadImage(proxied(src));
  const maxSide = 1200;
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h);
  const px = data.data;

  // Reference colour: average of the four corners.
  const corners = [0, w - 1, (h - 1) * w, h * w - 1];
  const ref = [0, 1, 2].map((c) => corners.reduce((s, i) => s + px[i * 4 + c], 0) / 4);
  const dist = (i: number) =>
    Math.max(Math.abs(px[i * 4] - ref[0]), Math.abs(px[i * 4 + 1] - ref[1]), Math.abs(px[i * 4 + 2] - ref[2]));

  const background = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
  while (stack.length) {
    const i = stack.pop()!;
    if (background[i] || dist(i) > tolerance) continue;
    background[i] = 1;
    const x = i % w;
    if (x > 0) stack.push(i - 1);
    if (x < w - 1) stack.push(i + 1);
    if (i >= w) stack.push(i - w);
    if (i < w * (h - 1)) stack.push(i + w);
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
    if (edge) px[i * 4 + 3] = 140;
  }
  ctx.putImageData(data, 0, 0);
  return canvas.toDataURL("image/png");
}
