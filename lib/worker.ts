import type { Img, Task } from "./ai.worker";
import { loadImage, proxied } from "./images";

export type { Img };
export type Progress = (message: string) => void;

/** iPad/iPhone Safari and small Android devices: pick the lighter models. */
export function isLowMemoryDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return ios || (memory !== undefined && memory <= 4);
}

/**
 * Runs one AI job in a fresh worker and terminates it afterwards, so the
 * model's memory is really released (important on iPad).
 */
export function runAi<T>(job: Task, onProgress?: Progress, transfer: Transferable[] = []): Promise<T> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./ai.worker.ts", import.meta.url), { type: "module" });
    const finish = () => {
      worker.terminate();
      onProgress?.("");
    };
    worker.onmessage = (e: MessageEvent<{ type: string; message?: string; result?: T }>) => {
      if (e.data.type === "progress") onProgress?.(e.data.message ?? "");
      else if (e.data.type === "done") (finish(), resolve(e.data.result as T));
      else (finish(), reject(new Error(e.data.message)));
    };
    worker.onerror = (e) => {
      finish();
      reject(new Error(e.message || "De AI is gestopt (te weinig geheugen?)"));
    };
    worker.postMessage(job, transfer);
  });
}

/** Pixels of an image, scaled down to at most `maxSide` (only what the model needs). */
export async function imagePixels(src: string, maxSide: number): Promise<Img> {
  const img = await loadImage(proxied(src));
  const f = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.max(1, Math.round(img.naturalWidth * f));
  const height = Math.max(1, Math.round(img.naturalHeight * f));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, width, height);
  const data = ctx.getImageData(0, 0, width, height).data;
  canvas.width = canvas.height = 0; // free the backing store right away (Safari keeps it otherwise)
  return { data, width, height };
}

export function pixelsToCanvas({ data, width, height }: Img): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0);
  return canvas;
}
