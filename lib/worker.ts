import type { Img, Task } from "./ai.worker";
import { cloudRun, cloudUrl, type CloudSession } from "./cloud";
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
// still there on the next start, the job crashed the tab. First time: switch to
// the light models. Crashed again with the light models: that AI job is switched
// off on this device (the app uses its non-AI alternative) so it can never take
// the tab down in a loop. Cloud AI (see cloud.ts) is not affected by any of this.

const JOB_KEY = "furnuture:ai-job";
const LIGHT_KEY = "furnuture:light-ai";
const OFF_KEY = "furnuture:ai-off";

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

/**
 * Light AI mode: smaller models and images. On by default on iPad/iPhone and
 * small devices (unless switched off by hand), and turned on after a crash.
 */
export const isLightMode = () => {
  const v = read(LIGHT_KEY);
  return v === "1" || (v !== "0" && isLowMemoryDevice());
};
export const setLightMode = (on: boolean) => store(LIGHT_KEY, on ? "1" : "0");

/** Jobs of one kind share a crash record ("sam" covers analysing and tapping). */
const groupOf = (task: string) => (task === "samEmbed" || task === "samMask" ? "sam" : task);

function offTasks(): string[] {
  try {
    return JSON.parse(read(OFF_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}
/** AI jobs switched off on this device because they crashed it (with the light models). */
export const deviceAiOff = (task: string) => offTasks().includes(groupOf(task));
export const anyDeviceAiOff = () => offTasks().length > 0;
/** Try on-device AI again (from the Project menu). */
export const resetDeviceAi = () => store(OFF_KEY, null);

/** Heavy extras (AI cut-out, LaMa) only when they cannot take this device down. */
export const heavyAiAllowed = () => !!cloudUrl() || !isLowMemoryDevice();

export class AiOffError extends Error {}

// WebGPU: models run on the graphics card. Many times faster, and the weights do
// not live in WebAssembly memory (which is never returned and is what made tabs
// crash). Off in light mode and on low-memory devices (Safari's WebGPU on iPad
// shares the tab's small memory budget), and switched off for good once it failed.
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

/** What happened to the AI job that was running when the app last stopped unexpectedly (read once). */
export function takeCrashReport(): { label: string; switchedOff: boolean } | null {
  const raw = read(JOB_KEY);
  if (!raw) return null;
  store(JOB_KEY, null);
  try {
    const { task, at, light } = JSON.parse(raw) as { task: string; at: number; light?: boolean };
    if (Date.now() - at > 24 * 3600 * 1000) return null;
    const group = groupOf(task);
    const switchedOff = !!light;
    if (switchedOff) store(OFF_KEY, JSON.stringify([...new Set([...offTasks(), group])]));
    else setLightMode(true);
    return { label: TASK_LABELS[group] ?? "een AI-taak", switchedOff };
  } catch {
    return null;
  }
}

let running = 0;
const jobStarted = (task: string) => {
  running++;
  store(JOB_KEY, JSON.stringify({ task, at: Date.now(), light: isLightMode() }));
};
const jobEnded = () => {
  running = Math.max(0, running - 1);
  if (!running) store(JOB_KEY, null);
};

// ---------------------------------------------------------------------------
// One AI job at a time. Several models loading at once (three cut-outs, an
// erase and a tap-to-select) was the quickest way to run out of memory. Jobs
// wait for each other; the order is kept.

let lock: Promise<unknown> = Promise.resolve();
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const next = lock.then(fn, fn);
  lock = next.catch(() => undefined);
  return next;
}

type Reply<T> = { type: string; message?: string; result?: T; gpuFailed?: boolean };
const newWorker = () => new Worker(new URL("./ai.worker.ts", import.meta.url), { type: "module" });

/** Sends one job to a worker and waits for its answer. */
function ask<T>(worker: Worker, job: Task, onProgress: Progress | undefined, transfer: Transferable[]): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    jobStarted(job.task);
    const done = () => (jobEnded(), onProgress?.(""));
    worker.onmessage = (e: MessageEvent<Reply<T>>) => {
      if (e.data.gpuFailed) gpuFailed();
      if (e.data.type === "progress") onProgress?.(e.data.message ?? "");
      else if (e.data.type === "done") (done(), resolve(e.data.result as T));
      else (done(), reject(new Error(e.data.message)));
    };
    worker.onerror = (e) => {
      done();
      reject(Object.assign(new Error(e.message || "De AI is gestopt (te weinig geheugen?)"), { fatal: true }));
    };
    worker.postMessage({ gpu: gpuEnabled(), ...job }, transfer);
  });
}

/**
 * The worker for one-off jobs. It stays alive for a run of jobs of the same kind
 * (the model is loaded once), and is closed as soon as another kind of job
 * comes, or shortly after the last one: closing a worker is the only way to
 * really free WebAssembly memory.
 */
let shared: { worker: Worker; task: string; idle?: ReturnType<typeof setTimeout> } | null = null;
const closeShared = () => {
  if (!shared) return;
  clearTimeout(shared.idle);
  shared.worker.terminate();
  shared = null;
};

/** Sessions (tap-to-select) keep a worker with a model; on small devices they are closed before other jobs. */
const sessions = new Set<AiSession>();

/** Runs one AI job; see `exclusive` and `shared`. */
export async function runAi<T>(job: Task, onProgress?: Progress, transfer: Transferable[] = []): Promise<T> {
  if (cloudUrl()) {
    try {
      return await cloudRun<T>(job, onProgress);
    } catch (e) {
      console.warn("Cloud AI failed", e);
      if (deviceAiOff(job.task)) throw e;
      onProgress?.("AI-server niet bereikbaar, op dit apparaat…");
    }
  }
  return runOnDevice<T>(job, onProgress, transfer);
}

const offMessage = (task: string) =>
  new AiOffError(
    `AI voor ${TASK_LABELS[groupOf(task)] ?? "deze taak"} staat uit op dit apparaat, omdat het de app liet vastlopen. ` +
      "Zet in het Project-menu een AI-server aan (gratis), of probeer het daar opnieuw.",
  );

function runOnDevice<T>(job: Task, onProgress: Progress | undefined, transfer: Transferable[]): Promise<T> {
  if (deviceAiOff(job.task)) return Promise.reject(offMessage(job.task));
  return exclusive(async () => {
    const low = isLowMemoryDevice() || isLightMode();
    if (low) for (const s of sessions) s.close();
    if (shared && shared.task !== job.task) closeShared();
    shared ??= { worker: newWorker(), task: job.task };
    clearTimeout(shared.idle);
    const mine = shared;
    try {
      return await ask<T>(mine.worker, job, onProgress, transfer);
    } catch (e) {
      if ((e as { fatal?: boolean }).fatal && shared === mine) closeShared();
      throw e;
    } finally {
      // Keep the model for a follow-up job of the same kind (they arrive within milliseconds).
      if (shared === mine) mine.idle = setTimeout(closeShared, low ? 800 : 3000);
    }
  });
}

/**
 * A worker that stays alive for a series of jobs sharing state — used for
 * tap-to-select, where the photo is analysed once and every tap is then quick.
 * It shuts itself down after a while without use (and frees its memory).
 */
export class AiSession {
  private worker: Worker | null = null;
  private idle: ReturnType<typeof setTimeout> | undefined;
  private busy = false;
  /** The server's analysis, when this session runs on the AI server. */
  private cloud: CloudSession = { id: null };

  constructor(private readonly idleMs = 60_000) {}

  get active() {
    return !!this.worker || !!this.cloud.id;
  }

  async run<T>(job: Task, onProgress?: Progress, transfer: Transferable[] = []): Promise<T> {
    // A fresh analysis goes to the server when there is one; follow-up jobs go where the analysis is.
    const fresh = job.task === "samEmbed";
    if (cloudUrl() && (fresh ? true : !!this.cloud.id)) {
      try {
        if (fresh) this.close();
        return await cloudRun<T>(job, onProgress, this.cloud);
      } catch (e) {
        console.warn("Cloud AI failed", e);
        this.cloud.id = null;
        if (!fresh || deviceAiOff(job.task)) throw e; // the caller analyses again
        onProgress?.("AI-server niet bereikbaar, op dit apparaat…");
      }
    }
    if (deviceAiOff(job.task)) throw offMessage(job.task);
    return exclusive(async () => {
      clearTimeout(this.idle);
      // On small devices only one model at a time: close the one-off worker first.
      if (isLowMemoryDevice() || isLightMode()) closeShared();
      if (!this.worker) {
        this.worker = newWorker();
        sessions.add(this);
      }
      this.busy = true;
      try {
        return await ask<T>(this.worker, job, onProgress, transfer);
      } catch (e) {
        if ((e as { fatal?: boolean }).fatal) this.close(true);
        throw e;
      } finally {
        this.busy = false;
        if (this.worker) this.idle = setTimeout(() => this.close(), this.idleMs);
      }
    });
  }

  /** Frees the worker (not while a job runs, unless forced). */
  close(force = false) {
    if (this.busy && !force) return;
    clearTimeout(this.idle);
    this.worker?.terminate();
    this.worker = null;
    this.cloud.id = null;
    sessions.delete(this);
    this.onClose?.();
  }

  /** Called when the worker (and the state it held) is gone. */
  onClose?: () => void;
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
