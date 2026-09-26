/// <reference lib="webworker" />
/** Content-aware fill (lib/patchFill.ts) off the main thread. */
import { patchFill } from "./patchFill";
import type { Img } from "./ai.worker";

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (e: MessageEvent<{ image: Img; hole: Uint8Array; labels?: Uint8Array }>) => {
  const { image, hole, labels } = e.data;
  patchFill(image.data, hole, image.width, image.height, labels);
  ctx.postMessage(image, [image.data.buffer]);
};
