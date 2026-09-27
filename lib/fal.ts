import { fingerprint } from "./aiCache";

/**
 * fal.ai (paid per use, via app/api/fal): a fast vision-language model (Gemini
 * Flash through fal's OpenRouter endpoint) that reads Funda photos, floor plans,
 * product screenshots and your list, and answers in JSON. A question costs a
 * fraction of a cent to a few cents; answers are cached (see ai.ts), so the same
 * question is never paid for twice. Without FAL_KEY the app works fully, without
 * the ✨ buttons.
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

/** The one model the app uses (see app/api/fal), and its rough price per question (USD, on the high side). */
export const VISION = "openrouter/router/vision";
export const MODEL_COST: Record<string, number> = { [VISION]: 0.01 };
/** Searching the web costs extra. */
export const WEB_SEARCH_COST = 0.03;
/** Rough cost per AI feature (USD), shown next to the buttons. */
export const FAL_COST = {
  rooms: 0.02,
  advice: 0.01,
  screenshot: 0.005,
  alternatives: 0.03,
  style: 0.01,
} as const;
const EUR = 0.92;
export const euroCents = (usd: number) => (usd < 0.01 ? "< 1 cent" : `± ${Math.max(1, Math.round(usd * EUR * 100))} cent`);
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
    localStorage.setItem(SPEND_KEY, JSON.stringify({ day: today(), usd: Math.max(0, spentToday() + usd) }));
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
  const cost = (MODEL_COST[model] ?? 0.05) + (input.enable_web_search ? WEB_SEARCH_COST : 0);
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
  addSpend(cost); // counted when submitted (corrected with the real price when the answer comes)
  const start = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, Date.now() - start < 6000 ? 900 : 1800));
    const q = new URLSearchParams({ status: job.statusUrl, ...(job.responseUrl ? { response: job.responseUrl } : {}) });
    const s = await fetch(`/api/fal?${q}`, { headers: headers(), cache: "no-store" });
    const st = (await s.json().catch(() => ({}))) as { status?: string; position?: number; result?: T; error?: string };
    if (!s.ok || st.status === "ERROR") throw new FalError(st.error ?? `fal: ${s.status}`);
    if (st.status === "COMPLETED") {
      // The real price, when the model reports it: the estimate counted at submit is corrected.
      const real = (st.result as { usage?: { cost?: number } } | undefined)?.usage?.cost;
      if (typeof real === "number" && real >= 0) addSpend(real - cost);
      return st.result as T;
    }
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
