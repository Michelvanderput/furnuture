import { loadImage, proxied } from "./images";

/**
 * fal.ai (paid per use, via app/api/fal): the best available models for erasing,
 * selecting, cutting out and making a design photo-realistic. Nothing heavy runs on
 * the iPad. Everything here falls back to the free, built-in way when fal is not set
 * up (no FAL_KEY in Vercel) or a job fails.
 */
export type Progress = (message: string) => void;

const CODE_KEY = "furnuture:ai-code";
export const accessCode = () => {
  try {
    return localStorage.getItem(CODE_KEY) ?? "";
  } catch {
    return "";
  }
};
export const setAccessCode = (code: string) => {
  try {
    localStorage.setItem(CODE_KEY, code.trim());
  } catch {
    // storage blocked
  }
  checked = null;
};

let checked: Promise<{ enabled: boolean; needsCode: boolean }> | null = null;
/** Is fal set up on the server? (Asked once per page load.) */
export function falInfo(): Promise<{ enabled: boolean; needsCode: boolean }> {
  checked ??= fetch("/api/fal", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : { enabled: false, needsCode: false }))
    .catch(() => ({ enabled: false, needsCode: false }));
  return checked;
}
/** Synchronous answer once known (false until then). */
let known = false;
export const falReady = () => known;
export async function falEnabled(): Promise<boolean> {
  const info = await falInfo();
  known = info.enabled && (!info.needsCode || !!accessCode());
  return known;
}

export class FalError extends Error {}

const headers = () => ({ "Content-Type": "application/json", "x-access-code": accessCode() });

/** Runs a model on fal through the queue; resolves with the model's output. */
export async function falRun<T>(model: string, input: Record<string, unknown>, onProgress?: Progress, label = "AI", timeoutMs = 180_000): Promise<T> {
  try {
    return await runQueued<T>(model, input, onProgress, label, timeoutMs);
  } finally {
    onProgress?.(""); // the status line must not stay on "bezig…"
  }
}

async function runQueued<T>(model: string, input: Record<string, unknown>, onProgress: Progress | undefined, label: string, timeoutMs: number): Promise<T> {
  onProgress?.(`${label}: versturen…`);
  const res = await fetch("/api/fal", { method: "POST", headers: headers(), body: JSON.stringify({ model, input }) });
  const job = (await res.json().catch(() => ({}))) as { statusUrl?: string; responseUrl?: string; error?: string };
  if (!res.ok || !job.statusUrl) throw new FalError(job.error ?? `fal: ${res.status}`);
  const start = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, Date.now() - start < 6000 ? 900 : 1800));
    const q = new URLSearchParams({ status: job.statusUrl, ...(job.responseUrl ? { response: job.responseUrl } : {}) });
    const s = await fetch(`/api/fal?${q}`, { headers: headers(), cache: "no-store" });
    const st = (await s.json().catch(() => ({}))) as { status?: string; position?: number; result?: T; error?: string };
    if (!s.ok || st.status === "ERROR") throw new FalError(st.error ?? `fal: ${s.status}`);
    if (st.status === "COMPLETED") return st.result as T;
    const secs = Math.round((Date.now() - start) / 1000);
    onProgress?.(st.status === "IN_QUEUE" && st.position ? `${label}: in de wachtrij (${st.position})…` : `${label}: bezig… ${secs} s`);
    if (Date.now() - start > timeoutMs) throw new FalError("fal duurde te lang");
  }
}

// ---------------------------------------------------------------------------
// Images to and from fal

/** A canvas (or image) as a JPEG data URL of at most maxSide px: fal accepts data URIs. */
export function toDataUrl(src: CanvasImageSource & { width: number; height: number }, maxSide = 2048, type = "image/jpeg", quality = 0.9): string {
  const w = "naturalWidth" in src ? (src as HTMLImageElement).naturalWidth : src.width;
  const h = "naturalHeight" in src ? (src as HTMLImageElement).naturalHeight : src.height;
  const f = Math.min(1, maxSide / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.round(w * f);
  c.height = Math.round(h * f);
  const ctx = c.getContext("2d")!;
  if (type === "image/jpeg") (ctx.fillStyle = "#fff"), ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(src, 0, 0, c.width, c.height);
  const url = c.toDataURL(type, quality);
  c.width = c.height = 0;
  return url;
}

/** A binary mask (1 = set) of w×h as a black/white PNG data URL: white is "remove". */
export function maskDataUrl(mask: Uint8Array, w: number, h: number): string {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const v = mask[i] ? 255 : 0;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const url = c.toDataURL("image/png");
  c.width = c.height = 0;
  return url;
}

/** A result image from fal (on its CDN), readable as pixels (through our proxy). */
export const loadResult = (url: string) => loadImage(url.startsWith("data:") ? url : proxied(url));

/** fal answers with { image } or { images: [...] }: the first image's URL. */
export function firstImage(out: unknown): string {
  const o = out as { image?: { url?: string }; images?: { url?: string }[] };
  const url = o.image?.url ?? o.images?.[0]?.url;
  if (!url) throw new FalError("fal gaf geen afbeelding terug");
  return url;
}

/** Rough cost per job (USD), shown next to the buttons. */
export const FAL_COST = {
  erase: 0.024,
  select: 0,
  cutout: 0.01,
  suggest: 0.005,
  render: 0.12,
} as const;
export const euroCents = (usd: number) => (usd < 0.005 ? "gratis" : `± ${Math.max(1, Math.round(usd * 92))} cent`);
