import { ROOMS } from "./categories";
import { falEnabled } from "./fal";
import { falCutout } from "./falTasks";
import { canvasToUrl } from "./images";
import type { RoomType } from "./types";
import { imagePixels, isLightMode, pixelsToCanvas, runAi, type Img, type Progress } from "./worker";

/**
 * Free, in-browser AI (transformers.js / onnxruntime-web). Every job runs in its
 * own worker (see ai.worker.ts); models are downloaded once and cached by the browser.
 */
export type { Progress };

/** Every description with the room it stands for. */
const PROMPTS = ROOMS.flatMap((r) => r.clip.map((text) => ({ text, room: r.id })));

/**
 * Floor plans are drawings: mostly pure white paper and hard lines, with none of
 * the soft gradients of a photo. Recognised from the pixels (no AI), which is
 * both faster and more reliable than CLIP (that confused a bright dining room
 * with a floor plan).
 */
export function looksLikeFloorPlan({ data, width, height }: Img): boolean {
  let white = 0, soft = 0;
  const n = width * height;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (Math.min(data[i], data[i + 1], data[i + 2]) > 242) white++;
      if (x + 1 < width) {
        const d = Math.abs((data[i] + data[i + 1] + data[i + 2] - data[i + 4] - data[i + 5] - data[i + 6]) / 3);
        if (d > 1.5 && d < 12) soft++;
      }
    }
  }
  return white / n > 0.3 && soft / n < 0.12;
}

/** Guesses the room type of each photo (floor plans from the pixels, the rest with CLIP). Calls onResult per photo. */
export async function classifyRooms(
  photos: { id: string; url: string }[],
  onResult: (id: string, room: RoomType) => void,
  onProgress?: Progress,
): Promise<void> {
  onProgress?.("Foto's voorbereiden…");
  // CLIP looks at 224×224 pixels; sending more only costs memory.
  const images: Img[] = [];
  const rest: string[] = [];
  for (const [i, p] of photos.entries()) {
    onProgress?.(`Foto's voorbereiden… ${i + 1}/${photos.length}`);
    const img = await imagePixels(p.url, 256);
    if (looksLikeFloorPlan(img)) onResult(p.id, "plattegrond");
    else images.push(img), rest.push(p.id);
  }
  if (!images.length) return;
  const photoPrompts = PROMPTS.filter((p) => p.room !== "plattegrond");
  const best = await runAi<string[]>(
    // Light mode (iPad): B/32 only, which needs a quarter of the memory while running.
    {
      task: "classify",
      images,
      labels: photoPrompts.map((p) => p.text),
      models: isLightMode() ? ["Xenova/clip-vit-base-patch32"] : ["Xenova/clip-vit-base-patch16", "Xenova/clip-vit-base-patch32"],
    },
    onProgress,
    images.map((i) => i.data.buffer),
  );
  best.forEach((label, i) => onResult(rest[i], photoPrompts.find((p) => p.text === label)?.room ?? "overig"));
}

/**
 * AI background removal (BRIA RMBG-1.4, ~45 MB, free for non-commercial use).
 * Much better than the colour-based cut-out for light furniture or sfeerfoto's.
 */
export async function removeBackgroundAI(src: string, onProgress?: Progress): Promise<string> {
  if (await falEnabled()) {
    try {
      return await falCutout(src, onProgress);
    } catch (e) {
      console.warn("fal cut-out failed, cutting out here", e);
      onProgress?.(`fal: ${e instanceof Error ? e.message : e} — nu de gratis manier…`);
    }
  }
  const image = await imagePixels(src, 1024);
  const out = await runAi<Img>({ task: "removeBackground", image, models: ["briaai/RMBG-1.4"] }, onProgress, [image.data.buffer]);
  return canvasToUrl(pixelsToCanvas(out));
}
