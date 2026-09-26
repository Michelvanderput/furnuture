import type { Img, Task } from "./ai.worker";

/**
 * Cloud AI: your own free Hugging Face Space (see ai-server/) runs the models
 * instead of this device. The iPad then only sends a photo and gets a mask or
 * image back — nothing heavy runs in Safari, so nothing can crash it, and the
 * server can use stronger models (SegFormer-B5, SAM ViT-B, LaMa).
 *
 * The address comes from the Project menu (per device) or, for all devices at
 * once, from NEXT_PUBLIC_AI_SERVER in Vercel.
 */
const KEY = "furnuture:ai-server";

export function cloudUrl(): string | null {
  let url: string | null = null;
  try {
    url = localStorage.getItem(KEY);
  } catch {
    // storage blocked
  }
  if (url === "off") return null;
  url ||= process.env.NEXT_PUBLIC_AI_SERVER ?? null;
  return url ? url.replace(/\/+$/, "") : null;
}

/** Sets this device's server; "" = use the default (if any), null = never use cloud AI here. */
export function setCloudUrl(url: string | null) {
  try {
    if (url === null) localStorage.setItem(KEY, "off");
    else if (url.trim()) localStorage.setItem(KEY, normalize(url));
    else localStorage.removeItem(KEY);
  } catch {
    // storage blocked
  }
}

/** Accepts the Space page (huggingface.co/spaces/user/name) as well as its app address. */
export function normalize(url: string): string {
  const u = url.trim().replace(/\/+$/, "");
  const page = u.match(/huggingface\.co\/spaces\/([^/]+)\/([^/?#]+)/i);
  if (page) return `https://${`${page[1]}-${page[2]}`.toLowerCase().replace(/[_.]/g, "-")}.hf.space`;
  return /^https?:\/\//.test(u) ? u : `https://${u}`;
}

export class CloudError extends Error {}

async function call(path: string, init: RequestInit, timeoutMs = 120_000): Promise<Response> {
  const base = cloudUrl();
  if (!base) throw new CloudError("Geen AI-server ingesteld");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}${path}`, { ...init, signal: ctrl.signal });
    if (!res.ok) throw new CloudError(`AI-server: ${res.status} ${(await res.text().catch(() => "")).slice(0, 120)}`);
    return res;
  } catch (e) {
    throw e instanceof CloudError ? e : new CloudError(`AI-server niet bereikbaar (${e instanceof Error ? e.message : e})`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Is the server up? A free Space sleeps after two days without use and takes about
 * a minute to wake up: wait for it (with a message) instead of giving up.
 */
let awake = 0;
export async function wakeCloud(onProgress?: (m: string) => void, maxWaitMs = 150_000): Promise<void> {
  if (Date.now() - awake < 60_000) return;
  const start = Date.now();
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await call("/health", { method: "GET" }, attempt ? 10_000 : 6_000);
      const info = (await res.json()) as { ok?: boolean };
      if (info.ok) {
        awake = Date.now();
        return;
      }
    } catch (e) {
      if (Date.now() - start > maxWaitMs) throw e;
    }
    onProgress?.(`AI-server wordt wakker gemaakt… (${Math.round((Date.now() - start) / 1000)} s, kan een minuut duren)`);
    await new Promise((r) => setTimeout(r, 4000));
  }
}

/** Server info for the settings screen. */
export async function cloudHealth(): Promise<{ ok: boolean; models?: string[] }> {
  const res = await call("/health", { method: "GET" }, 10_000);
  return res.json();
}

function toBlob(img: Img, type = "image/png", quality?: number): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => ((canvas.width = canvas.height = 0), b ? resolve(b) : reject(new Error("Afbeelding maken mislukt"))), type, quality),
  );
}

/** Mask (1 byte per pixel, non-zero = set) as a black/white PNG. */
function maskBlob(mask: Uint8Array, w: number, h: number, set: (v: number) => boolean): Promise<Blob> {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const v = set(mask[i]) ? 255 : 0;
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  return toBlob({ data, width: w, height: h });
}

async function blobToImg(blob: Blob, w?: number, h?: number): Promise<Img> {
  const bitmap = await createImageBitmap(blob);
  const width = w ?? bitmap.width, height = h ?? bitmap.height;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const data = ctx.getImageData(0, 0, width, height).data;
  canvas.width = canvas.height = 0;
  return { data, width, height };
}

const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Cloud side of a session (tap-to-select): the server keeps the photo's analysis under `id`. */
export type CloudSession = { id: string | null };

/** Runs a job on the server; the result has the same shape as the on-device worker's. */
export async function cloudRun<T>(job: Task, onProgress?: (m: string) => void, session?: CloudSession): Promise<T> {
  await wakeCloud(onProgress);
  const form = new FormData();
  switch (job.task) {
    case "segment": {
      onProgress?.("Kamer herkennen (AI-server)…");
      form.append("image", await toBlob(job.image, "image/jpeg", 0.92), "photo.jpg");
      form.append("out_w", String(job.outW));
      form.append("out_h", String(job.outH));
      const r = (await (await call("/segment", { method: "POST", body: form })).json()) as {
        classMap: string;
        id2label: Record<number, string>;
        model: string;
      };
      return { classMap: fromBase64(r.classMap), id2label: r.id2label, model: r.model } as T;
    }
    case "classify": {
      onProgress?.("Foto's sorteren (AI-server)…");
      for (const [i, img] of job.images.entries()) form.append("images", await toBlob(img, "image/jpeg", 0.9), `${i}.jpg`);
      form.append("labels", JSON.stringify(job.labels));
      return ((await (await call("/classify", { method: "POST", body: form })).json()) as { labels: string[] }).labels as T;
    }
    case "removeBackground": {
      onProgress?.("Achtergrond weghalen (AI-server)…");
      form.append("image", await toBlob(job.image), "product.png");
      return (await blobToImg(await (await call("/remove-background", { method: "POST", body: form })).blob())) as T;
    }
    case "inpaint": {
      onProgress?.("Weggummen (AI-server)…");
      form.append("image", await toBlob(job.image), "crop.png");
      // Page masks: 255 = keep, 0 = remove. The server wants white = remove.
      form.append("mask", await maskBlob(job.mask, job.image.width, job.image.height, (v) => v === 0), "mask.png");
      const res = await call("/inpaint", { method: "POST", body: form });
      return (await blobToImg(await res.blob(), job.image.width, job.image.height)) as T;
    }
    case "samEmbed": {
      onProgress?.("Foto analyseren (AI-server)…");
      form.append("image", await toBlob(job.image, "image/jpeg", 0.92), "photo.jpg");
      const r = (await (await call("/sam/embed", { method: "POST", body: form })).json()) as { id: string };
      if (session) session.id = r.id;
      return undefined as T;
    }
    case "samMask": {
      if (!session?.id) throw new CloudError("Geen analyse op de AI-server");
      const res = await call("/sam/mask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: session.id, points: job.points, labels: job.labels, out_w: job.outW, out_h: job.outH, box: job.box ?? null }),
      }).catch((e) => {
        session.id = null; // analysis gone (server restarted): the caller analyses again
        throw e;
      });
      const r = (await res.json()) as { mask: string; score: number };
      return { mask: fromBase64(r.mask), score: r.score } as T;
    }
  }
}
