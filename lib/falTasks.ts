import { falRun, firstImage, loadResult, maskDataUrl, toDataUrl, type Progress } from "./fal";
import { loadImage, proxied } from "./images";
import { dilate } from "./masks";

/**
 * Erases the masked area (1 = remove) of the canvas with fal's object-removal model,
 * in place. The whole photo goes, so the model sees the room; only the erased area
 * (with a soft edge) is taken back, so the rest of the photo stays exactly as it was.
 * Falls back from fal's own model to Bria Eraser; throws when both fail.
 */
export async function falErase(canvas: HTMLCanvasElement, mask: Uint8Array, onProgress?: Progress): Promise<void> {
  const W = canvas.width, H = canvas.height;
  const image_url = toDataUrl(canvas, 2048, "image/jpeg", 0.92);
  const mask_url = maskDataUrl(mask, W, H);
  let url: string;
  try {
    url = firstImage(
      await falRun("fal-ai/object-removal/mask", { image_url, mask_url, model: "best_quality", mask_expansion: 10 }, onProgress, "AI-gum (fal)"),
    );
  } catch (e) {
    console.warn("fal object removal failed, trying Bria Eraser", e);
    url = firstImage(await falRun("fal-ai/bria/eraser", { image_url, mask_url }, onProgress, "AI-gum (Bria)"));
  }
  const result = await loadResult(url);
  blendMasked(canvas, result, mask);
}

/** Draws `img` (any size, stretched to the canvas) onto the canvas only where the mask is set, with a soft edge. */
export function blendMasked(canvas: HTMLCanvasElement, img: CanvasImageSource, mask: Uint8Array, feather = 3) {
  const W = canvas.width, H = canvas.height;
  const layer = document.createElement("canvas");
  layer.width = W;
  layer.height = H;
  const lctx = layer.getContext("2d", { willReadFrequently: true })!;
  lctx.drawImage(img, 0, 0, W, H);
  const px = lctx.getImageData(0, 0, W, H);
  const alpha = softMask(mask, W, H, feather);
  for (let i = 0; i < W * H; i++) px.data[i * 4 + 3] = alpha[i];
  lctx.putImageData(px, 0, 0);
  canvas.getContext("2d")!.drawImage(layer, 0, 0);
  layer.width = layer.height = 0;
}

/** Mask as 0..255 alpha with a feathered edge that only grows outward a little (box blur, two passes). */
export function softMask(mask: Uint8Array, w: number, h: number, r: number): Uint8ClampedArray {
  let a = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) a[i] = mask[i] ? 1 : 0;
  const tmp = new Float32Array(w * h);
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < h; y++) {
      let s = 0;
      for (let x = -r; x <= r; x++) s += a[y * w + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        tmp[y * w + x] = s / (2 * r + 1);
        s += a[y * w + Math.min(w - 1, x + r + 1)] - a[y * w + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let y = -r; y <= r; y++) s += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        a[y * w + x] = s / (2 * r + 1);
        s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
      }
    }
  }
  const out = new Uint8ClampedArray(w * h);
  // Fully inside the mask stays fully replaced; the blur only softens the outside edge.
  for (let i = 0; i < w * h; i++) out[i] = mask[i] ? 255 : Math.round(Math.min(1, a[i] * 2) * 255);
  a = new Float32Array(0);
  return out;
}

const photoData = new Map<string, Promise<{ url: string; w: number; h: number }>>();
/** The photo as a ~1024 px JPEG data URL (made once per photo). */
function photoForFal(photoUrl: string, side = 1024) {
  const key = `${side}:${photoUrl}`;
  if (!photoData.has(key)) {
    photoData.set(
      key,
      loadImage(proxied(photoUrl)).then((img) => {
        const f = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
        return { url: toDataUrl(img, side), w: Math.round(img.naturalWidth * f), h: Math.round(img.naturalHeight * f) };
      }),
    );
    photoData.get(key)!.catch(() => photoData.delete(key));
  }
  return photoData.get(key)!;
}

/**
 * Tap-to-select with SAM 2 on fal: points (fractions of the photo; positive = the
 * object) and an optional box. Returns a mask of outW×outH, or throws when the answer
 * does not look like a selection of the tapped object (the caller then selects here).
 */
export async function falSelect(
  photoUrl: string,
  points: { at: [number, number]; positive: boolean }[],
  outW: number,
  outH: number,
  onProgress?: Progress,
  box?: [number, number, number, number],
): Promise<Uint8Array> {
  const photo = await photoForFal(photoUrl);
  const out = await falRun(
    "fal-ai/sam2/image",
    {
      image_url: photo.url,
      prompts: points.map((p) => ({ x: Math.round(p.at[0] * photo.w), y: Math.round(p.at[1] * photo.h), label: p.positive ? 1 : 0 })),
      ...(box ? { box_prompts: [{ x_min: box[0] * photo.w, y_min: box[1] * photo.h, x_max: box[2] * photo.w, y_max: box[3] * photo.h }] } : {}),
      apply_mask: false,
      output_format: "png",
    },
    onProgress,
    "Selecteren (fal)",
  );
  const img = await loadResult(firstImage(out));
  const c = document.createElement("canvas");
  c.width = outW;
  c.height = outH;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, outW, outH);
  const d = ctx.getImageData(0, 0, outW, outH).data;
  c.width = c.height = 0;
  // A mask comes as white-on-black, or as transparency: take whichever varies.
  let alphaVaries = false;
  for (let i = 3; i < d.length && !alphaVaries; i += 4 * 97) if (d[i] < 128) alphaVaries = true;
  const mask = new Uint8Array(outW * outH);
  let on = 0;
  for (let i = 0; i < outW * outH; i++) {
    const v = alphaVaries ? d[i * 4 + 3] : (d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2]) / 3;
    if (v > 127) (mask[i] = 1), on++;
  }
  const first = points.find((p) => p.positive) ?? points[0];
  if (!nearTap(mask, outW, outH, first.at) || on < outW * outH * 0.001 || on > outW * outH * 0.9) throw new Error("fal-selectie klopt niet");
  return mask;
}

/**
 * Does the mask lie at the tap (a fraction of the photo)? A finger is not a pixel: a tap
 * just below a cushion's edge rightly gives the cushion, so a little distance is allowed.
 */
export function nearTap(mask: Uint8Array, w: number, h: number, at: [number, number]): boolean {
  const cx = Math.min(w - 1, Math.floor(at[0] * w)), cy = Math.min(h - 1, Math.floor(at[1] * h));
  const r = Math.max(3, Math.round(w * 0.02));
  for (let y = Math.max(0, cy - r); y <= Math.min(h - 1, cy + r); y++)
    for (let x = Math.max(0, cx - r); x <= Math.min(w - 1, cx + r); x++)
      if (mask[y * w + x] && (x - cx) ** 2 + (y - cy) ** 2 <= r * r) return true;
  return false;
}

/** Product photo without background (BiRefNet v2 on fal): a transparent PNG as an object URL. */
export async function falCutout(productUrl: string, onProgress?: Progress): Promise<string> {
  // A shop's photo fal can fetch itself; an uploaded one (data URL) goes as a JPEG (PNG could be too big to send).
  const image_url = /^https?:/.test(productUrl) ? productUrl : toDataUrl(await loadImage(productUrl), 1600);
  const out = await falRun(
    "fal-ai/birefnet/v2",
    { image_url, model: "General Use (Heavy)", operating_resolution: "2048x2048", output_format: "png", refine_foreground: true },
    onProgress,
    "Uitknippen (fal)",
  );
  const res = await fetch(proxied(firstImage(out)));
  if (!res.ok) throw new Error("Uitgeknipte foto ophalen mislukt");
  return URL.createObjectURL(await res.blob());
}

export interface Spot {
  /** Where the middle of the product's front edge touches the floor (photo pixels). */
  at: [number, number];
  /** Why here, in Dutch (from the model). */
  why: string;
}

/**
 * Asks a vision model (Gemini via fal) where a product would go well in this room:
 * up to three floor points, each with a short reason. The caller checks that each
 * point is on the floor and puts the product there in perspective.
 */
export async function falSuggestSpots(
  photo: Blob,
  size: { w: number; h: number },
  product: { title: string; category: string; dims?: { w?: number; d?: number; h?: number } },
  onProgress?: Progress,
): Promise<Spot[]> {
  const img = await createImageBitmap(photo);
  const url = toDataUrl(img as unknown as HTMLCanvasElement, 1024);
  img.close();
  const dims = product.dims?.w ? ` It is about ${product.dims.w} cm wide${product.dims.d ? `, ${product.dims.d} cm deep` : ""}${product.dims.h ? `, ${product.dims.h} cm high` : ""}.` : "";
  const out = await falRun<{ output: string }>(
    "openrouter/router/vision",
    {
      model: "google/gemini-2.5-flash",
      system_prompt: "You are an interior designer. You answer with JSON only.",
      prompt:
        `This is a photo of a room. I want to place this new item in it: "${product.title}" (category: ${product.category}).${dims}\n` +
        "Suggest up to 3 good places for it, like an interior designer would: on free, visible floor, not on top of existing furniture, " +
        "leaving walkways and doors free, a sofa usually against a wall or facing the window or TV.\n" +
        "For each place give the point on the floor where the middle of the item's FRONT bottom edge would touch the floor, " +
        "as x and y fractions of the image width and height (0 = left/top, 1 = right/bottom), and a short reason in Dutch (max 8 words).\n" +
        'Answer only: {"spots":[{"x":0.5,"y":0.8,"why":"tegen de muur, zicht op het raam"}]}',
      image_urls: [url],
      temperature: 0.2,
      max_tokens: 400,
    },
    onProgress,
    "AI zoekt plekken",
  );
  const text = out.output ?? "";
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  let spots: { x?: unknown; y?: unknown; why?: unknown }[] = [];
  try {
    spots = (JSON.parse(json) as { spots?: typeof spots }).spots ?? [];
  } catch {
    throw new Error("De AI gaf geen bruikbare plekken terug");
  }
  return spots
    .map((s) => ({ x: Number(s.x), y: Number(s.y), why: String(s.why ?? "").slice(0, 60) }))
    .filter((s) => s.x >= 0 && s.x <= 1 && s.y >= 0 && s.y <= 1)
    .slice(0, 3)
    .map((s) => ({ at: [s.x * size.w, s.y * size.h] as [number, number], why: s.why }));
}

/**
 * The design as one photo-realistic picture (Nano Banana 2 on fal): the pasted-in
 * furniture gets real contact shadows, the room's light and no cut-out edges, and
 * keeps the look of the product photos, which go along as references.
 * Returns the picture as a Blob.
 */
export async function falRender(design: Blob, productPhotos: string[], onProgress?: Progress): Promise<Blob> {
  const img = await createImageBitmap(design);
  const room = toDataUrl(img as unknown as HTMLCanvasElement, 2048, "image/jpeg", 0.92);
  img.close();
  const refs = productPhotos.slice(0, 4).map((u) => u);
  const prompt =
    "Image 1 is a real photo of a room in which new furniture, flooring and paint were placed digitally (pasted in)." +
    (refs.length ? ` Images 2 to ${refs.length + 1} are the product photos of that furniture.` : "") +
    " Turn image 1 into one photorealistic interior photograph, as if the room had really been furnished like this and photographed with the same camera." +
    " Keep the camera angle, the room, the walls, windows, doors, the floor and its pattern, the wall colours and every object exactly where they are, with the same size and shape." +
    " Make the placed furniture sit naturally in the room: real contact shadows on the floor, the same light direction and colour temperature as the room, soft reflections, no cut-out edges or halos." +
    (refs.length ? " The furniture must look exactly like its product photo: same colour, fabric, shape, legs and details." : "") +
    " Do not add, remove, move or resize anything, and do not change the composition or crop.";
  const out = await falRun(
    "fal-ai/nano-banana-2/edit",
    { prompt, image_urls: [room, ...refs], resolution: "2K", aspect_ratio: "auto", output_format: "jpeg", num_images: 1 },
    onProgress,
    "Fotorealistisch maken",
    240_000,
  );
  const res = await fetch(proxied(firstImage(out)));
  if (!res.ok) throw new Error("Resultaat ophalen mislukt");
  return res.blob();
}

/**
 * New floors and walls made real (Nano Banana 2 on fal). The app draws them flat, like a
 * sticker in perspective; the model turns that into real material with the room's light:
 * brighter by the windows, darker in corners, contact shadows of furniture, reflections.
 * Only the new surfaces are taken from the result (`area`, 1 = new surface), so the rest
 * of the photo stays exactly as it was. Returns the room photo as a JPEG Blob.
 */
export async function falSurfaces(
  plain: Blob,
  drawn: Blob,
  area: Uint8Array,
  materials: { refs: string[]; colours: string[]; floor: boolean; wall: boolean },
  onProgress?: Progress,
): Promise<Blob> {
  const img = await createImageBitmap(drawn);
  const room = toDataUrl(img as unknown as HTMLCanvasElement, 2048, "image/jpeg", 0.92);
  img.close();
  const what = materials.floor && materials.wall ? "floor and walls" : materials.floor ? "floor" : "walls";
  const refs = materials.refs.slice(0, 4);
  const prompt =
    `Image 1 is a real photo of a room whose ${what} were digitally covered with a new material, drawn flat on top: ` +
    "it may look like a sticker, without depth or light variation." +
    (refs.length ? ` Images 2 to ${refs.length + 1} show the new materials (product photos).` : "") +
    (materials.colours.length ? ` The new wall paint colour is ${materials.colours.join(" and ")}.` : "") +
    ` Make the new ${what} look completely real, as if really installed and then photographed with the same camera:` +
    " real material structure (wood grain and plank seams, tile joints, matte paint), exactly the same colour, pattern, plank direction and plank or tile size as drawn, in the same perspective;" +
    " the room's own light: brighter near the windows, darker in corners and under furniture, soft contact shadows of the furniture, subtle window reflections on a smooth floor;" +
    " clean straight edges along skirting boards, door frames and wall corners." +
    " Keep everything else exactly the same: furniture, windows, doors, ceiling, lamps, plants, decoration, camera angle and framing. Do not add, remove or move anything.";
  const out = await falRun(
    "fal-ai/nano-banana-2/edit",
    { prompt, image_urls: [room, ...refs], resolution: "2K", aspect_ratio: "auto", output_format: "jpeg", num_images: 1 },
    onProgress,
    "Vloer en muren echt maken",
    240_000,
  );
  const result = await loadResult(firstImage(out));
  const base = await createImageBitmap(plain);
  const canvas = document.createElement("canvas");
  canvas.width = base.width;
  canvas.height = base.height;
  canvas.getContext("2d")!.drawImage(base, 0, 0);
  base.close();
  blendMasked(canvas, result, area, 3);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Opslaan mislukt"))), "image/jpeg", 0.93));
  canvas.width = canvas.height = 0;
  return blob;
}

/** Where two pictures of the same size differ (1 = changed), grown a little: the area a new floor or wall covers. */
export async function changedArea(a: Blob, b: Blob, w: number, h: number): Promise<Uint8Array> {
  const px = async (blob: Blob) => {
    const bm = await createImageBitmap(blob);
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(bm, 0, 0, w, h);
    bm.close();
    const d = ctx.getImageData(0, 0, w, h).data;
    c.width = c.height = 0;
    return d;
  };
  const [da, db] = await Promise.all([px(a), px(b)]);
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const j = i * 4;
    if (Math.abs(da[j] - db[j]) + Math.abs(da[j + 1] - db[j + 1]) + Math.abs(da[j + 2] - db[j + 2]) > 18) mask[i] = 1;
  }
  return dilate(mask, w, h, 2);
}
