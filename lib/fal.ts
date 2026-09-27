import { fingerprint } from "./aiCache";
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
  known = !stopped && info.enabled && (!info.needsCode || !!accessCode());
  return known;
}

export class FalError extends Error {}

// ---------------------------------------------------------------------------
// Costs: strict. Every paid job is counted, a daily limit stops it, expensive jobs
// are asked first, and a wrong key or empty credit stops fal for the session
// (instead of every click trying again). Results are cached by the callers.

/** Rough price per job (USD), a little on the high side. */
export const MODEL_COST: Record<string, number> = {
  "fal-ai/object-removal/mask": 0.024,
  "fal-ai/bria/eraser": 0.04,
  "fal-ai/sam2/image": 0.002,
  "fal-ai/birefnet/v2": 0.01,
  "openrouter/router/vision": 0.005,
  "fal-ai/nano-banana-2/edit": 0.12,
};
/** Rough cost per job (USD), shown next to the buttons. */
export const FAL_COST = {
  erase: MODEL_COST["fal-ai/object-removal/mask"],
  select: MODEL_COST["fal-ai/sam2/image"],
  cutout: MODEL_COST["fal-ai/birefnet/v2"],
  suggest: MODEL_COST["openrouter/router/vision"],
  render: MODEL_COST["fal-ai/nano-banana-2/edit"],
  surfaces: MODEL_COST["fal-ai/nano-banana-2/edit"],
} as const;
const EUR = 0.92;
export const euroCents = (usd: number) => (usd < 0.005 ? "< 1 cent" : `± ${Math.max(1, Math.round(usd * EUR * 100))} cent`);
export const euros = (usd: number) => `€ ${(usd * EUR).toFixed(2).replace(".", ",")}`;

const SPEND_KEY = "furnuture:fal-spend";
const LIMIT_KEY = "furnuture:fal-limit";
/** Default daily limit in euros. */
export const DEFAULT_LIMIT_EUR = 2;
const today = () => new Date().toISOString().slice(0, 10);

/** Spent today (USD, estimated), on this device. */
export function spentToday(): number {
  try {
    const s = JSON.parse(localStorage.getItem(SPEND_KEY) ?? "{}") as { day?: string; usd?: number };
    return s.day === today() ? (s.usd ?? 0) : 0;
  } catch {
    return 0;
  }
}
function addSpend(usd: number) {
  try {
    localStorage.setItem(SPEND_KEY, JSON.stringify({ day: today(), usd: spentToday() + usd }));
  } catch {
    // storage blocked: the server's own limit still applies
  }
}
/** Daily limit in euros (set in the project menu). */
export function dailyLimitEur(): number {
  try {
    const v = Number(localStorage.getItem(LIMIT_KEY));
    return v > 0 ? v : DEFAULT_LIMIT_EUR;
  } catch {
    return DEFAULT_LIMIT_EUR;
  }
}
export function setDailyLimitEur(eur: number) {
  try {
    localStorage.setItem(LIMIT_KEY, String(Math.max(0.1, eur)));
  } catch {
    // storage blocked
  }
}

/** Why fal was stopped for this session (wrong key, no credit…), or null. */
let stopped: string | null = null;
export const falStopped = () => stopped;
function stop(reason: string) {
  stopped = reason;
  known = false;
}

/**
 * Asks before a job that costs more than a few cents ("Fotorealistisch": ± 11 cent).
 * Cheap jobs (erasing, selecting) just run: they are counted and capped by the daily limit.
 */
export function confirmCost(what: string, usd: number): boolean {
  if (usd < 0.05) return true;
  const spent = spentToday();
  return confirm(`${what} kost ${euroCents(usd)} (fal.ai).${spent > 0 ? ` Vandaag al: ${euros(spent)}.` : ""} Doorgaan?`);
}

/** The same job twice at once (a double tap, a re-render while one runs) is sent once. */
const inFlight = new Map<string, Promise<unknown>>();

const headers = () => ({ "Content-Type": "application/json", "x-access-code": accessCode() });

/** Runs a model on fal through the queue; resolves with the model's output. */
export async function falRun<T>(model: string, input: Record<string, unknown>, onProgress?: Progress, label = "AI", timeoutMs = 180_000): Promise<T> {
  if (stopped) throw new FalError(stopped);
  const body = JSON.stringify({ model, input });
  const id = `${model}:${fingerprint(body)}`;
  const running = inFlight.get(id);
  if (running) return running as Promise<T>;
  const cost = MODEL_COST[model] ?? 0.05;
  if ((spentToday() + cost) * EUR > dailyLimitEur()) {
    throw new FalError(`Daglimiet van € ${dailyLimitEur().toFixed(2).replace(".", ",")} bereikt (instelbaar via ⋯ Project). De gratis manier wordt gebruikt.`);
  }
  const job = runQueued<T>(body, cost, onProgress, label, timeoutMs).finally(() => {
    inFlight.delete(id);
    onProgress?.(""); // the status line must not stay on "bezig…"
  });
  inFlight.set(id, job);
  return job;
}

async function runQueued<T>(body: string, cost: number, onProgress: Progress | undefined, label: string, timeoutMs: number): Promise<T> {
  onProgress?.(`${label}: versturen…`);
  const res = await fetch("/api/fal", { method: "POST", headers: headers(), body });
  const job = (await res.json().catch(() => ({}))) as { statusUrl?: string; responseUrl?: string; error?: string };
  if (!res.ok || !job.statusUrl) {
    const msg = job.error ?? `fal: ${res.status}`;
    // Wrong key or code, or no credit left: stop asking fal for the rest of this session.
    if (res.status === 401 || res.status === 503 || /\b(401|402|403)\b|balance|credit|exhausted|locked|limit/i.test(msg)) stop(friendlyStop(msg));
    throw new FalError(stopped ?? msg);
  }
  addSpend(cost); // submitted = billed (roughly); counted before the result is in
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

function friendlyStop(msg: string): string {
  if (/balance|credit|exhausted|402/i.test(msg)) return "fal.ai: tegoed op. Waardeer op via fal.ai; tot dan wordt de gratis manier gebruikt.";
  if (/Toegangscode/i.test(msg)) return "fal.ai: toegangscode klopt niet (⋯ Project).";
  if (/limit/i.test(msg)) return `fal.ai: limiet bereikt (${msg.slice(0, 80)}).`;
  return `fal.ai: sleutel geweigerd (${msg.slice(0, 80)}). Controleer FAL_KEY in Vercel.`;
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
