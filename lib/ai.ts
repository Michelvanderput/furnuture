import { ROOMS } from "./categories";
import type { RoomType } from "./types";
import { imagePixels, pixelsToCanvas, runAi, type Img, type Progress } from "./worker";

/**
 * Free, in-browser AI (transformers.js / onnxruntime-web). Every job runs in its
 * own worker (see ai.worker.ts); models are downloaded once and cached by the browser.
 */
export type { Progress };

const LABELED = ROOMS.filter((r) => r.clip);

/** Guesses the room type of each photo with CLIP. Calls onResult per photo. */
export async function classifyRooms(
  photos: { id: string; url: string }[],
  onResult: (id: string, room: RoomType) => void,
  onProgress?: Progress,
): Promise<void> {
  onProgress?.("Foto's voorbereiden…");
  // CLIP looks at 224×224 pixels; sending more only costs memory.
  const images: Img[] = [];
  for (const p of photos) images.push(await imagePixels(p.url, 256));
  const best = await runAi<string[]>(
    { task: "classify", images, labels: LABELED.map((r) => r.clip) },
    onProgress,
    images.map((i) => i.data.buffer),
  );
  best.forEach((label, i) => onResult(photos[i].id, LABELED.find((r) => r.clip === label)?.id ?? "overig"));
}

/**
 * AI background removal (BRIA RMBG-1.4, ~45 MB, free for non-commercial use).
 * Much better than the colour-based cut-out for light furniture or sfeerfoto's.
 */
export async function removeBackgroundAI(src: string, onProgress?: Progress): Promise<string> {
  const image = await imagePixels(src, 1024);
  const out = await runAi<Img>({ task: "removeBackground", image }, onProgress, [image.data.buffer]);
  const canvas = pixelsToCanvas(out);
  const url = canvas.toDataURL("image/png");
  canvas.width = canvas.height = 0;
  return url;
}
