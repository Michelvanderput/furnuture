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

// ---------------------------------------------------------------------------
// Crash guard. When iPad Safari runs out of memory it reloads the tab without
// any error we could catch. We note which AI job is running; if that note is
// still there on the next start, the job crashed the tab: say so, and switch to
// the light models from then on.

const JOB_KEY = "furnuture:ai-job";
const LIGHT_KEY = "furnuture:light-ai";

function store(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // storage blocked: no crash guard, everything else still works
  }
}
function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Light AI mode: smaller models and images. Turned on automatically after a crash. */
export const isLightMode = () => read(LIGHT_KEY) === "1";
export const setLightMode = (on: boolean) => store(LIGHT_KEY, on ? "1" : null);

// WebGPU: models run on the graphics card. Many times faster, and the weights do
// not live in WebAssembly memory (which is never returned and is what made tabs
// crash). Off in light mode and on low-memory devices, and switched off for good
// once it failed on this device.
const NO_GPU_KEY = "furnuture:no-gpu";
export function gpuEnabled(): boolean {
  if (typeof navigator === "undefined" || !("gpu" in navigator)) return false;
  return !isLightMode() && !isLowMemoryDevice() && read(NO_GPU_KEY) !== "1";
}
const gpuFailed = () => store(NO_GPU_KEY, "1");

const TASK_LABELS: Record<string, string> = {
  segment: "het herkennen van de kamer",
  sam: "het selecteren van een meubel",
  inpaint: "het weggummen",
  classify: "het sorteren van foto's",
  removeBackground: "het uitknippen van een productfoto",
};

/** The AI job that was running when the app last stopped unexpectedly, if any (read once). */
export function takeCrashReport(): string | null {
  const raw = read(JOB_KEY);
  if (!raw) return null;
  store(JOB_KEY, null);
  try {
    const { task, at } = JSON.parse(raw) as { task: string; at: number };
    if (Date.now() - at > 24 * 3600 * 1000) return null;
    setLightMode(true);
    return TASK_LABELS[task] ?? "een AI-taak";
  } catch {
    return null;
  }
}

let running = 0;
const jobStarted = (task: string) => {
  running++;
  store(JOB_KEY, JSON.stringify({ task, at: Date.now() }));
};
const jobEnded = () => {
  running = Math.max(0, running - 1);
  if (!running) store(JOB_KEY, null);
};

/**
 * Runs one AI job in a fresh worker and terminates it afterwards, so the
 * model's memory is really released (important on iPad).
 */
export function runAi<T>(job: Task, onProgress?: Progress, transfer: Transferable[] = []): Promise<T> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./ai.worker.ts", import.meta.url), { type: "module" });
    jobStarted(job.task);
    const finish = () => {
      worker.terminate();
      jobEnded();
      onProgress?.("");
    };
    worker.onmessage = (e: MessageEvent<{ type: string; message?: string; result?: T; gpuFailed?: boolean }>) => {
      if (e.data.gpuFailed) gpuFailed();
      if (e.data.type === "progress") onProgress?.(e.data.message ?? "");
      else if (e.data.type === "done") (finish(), resolve(e.data.result as T));
      else (finish(), reject(new Error(e.data.message)));
    };
    worker.onerror = (e) => {
      finish();
      reject(new Error(e.message || "De AI is gestopt (te weinig geheugen?)"));
    };
    worker.postMessage({ gpu: gpuEnabled(), ...job }, transfer);
  });
}

/**
 * A worker that stays alive for a series of jobs sharing state — used for
 * tap-to-select, where the photo is analysed once and every tap is then quick.
 * It shuts itself down after a minute without use (and frees its memory).
 */
export class AiSession {
  private worker: Worker | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private idle: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly idleMs = 60_000) {}

  get active() {
    return !!this.worker;
  }

  run<T>(job: Task, onProgress?: Progress, transfer: Transferable[] = []): Promise<T> {
    const next = this.queue.then(
      () =>
        new Promise<T>((resolve, reject) => {
          clearTimeout(this.idle);
          if (!this.worker) this.worker = new Worker(new URL("./ai.worker.ts", import.meta.url), { type: "module" });
          const w = this.worker;
          jobStarted(job.task);
          const done = () => {
            jobEnded();
            onProgress?.("");
            this.idle = setTimeout(() => this.close(), this.idleMs);
          };
          w.onmessage = (e: MessageEvent<{ type: string; message?: string; result?: T; gpuFailed?: boolean }>) => {
            if (e.data.gpuFailed) gpuFailed();
            if (e.data.type === "progress") onProgress?.(e.data.message ?? "");
            else if (e.data.type === "done") (done(), resolve(e.data.result as T));
            else (done(), reject(new Error(e.data.message)));
          };
          w.onerror = (e) => {
            done();
            this.close();
            reject(new Error(e.message || "De AI is gestopt (te weinig geheugen?)"));
          };
          w.postMessage({ gpu: gpuEnabled(), ...job }, transfer);
        }),
    );
    this.queue = next.catch(() => undefined);
    return next;
  }

  close() {
    clearTimeout(this.idle);
    this.worker?.terminate();
    this.worker = null;
  }
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
