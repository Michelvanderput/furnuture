import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * fal.ai for the heavy AI (see lib/fal.ts): the key stays on the server (FAL_KEY in
 * Vercel), the browser only talks to this route. Jobs go through fal's queue, so no
 * request here has to wait for a model: submit, then ask for the status.
 *
 * GET                    -> { enabled, needsCode }
 * POST { model, input }  -> { statusUrl, responseUrl }
 * GET ?status=<url>&response=<url> -> { status, position?, result?, error? }
 */

/** Only these models, so the key cannot be used for anything else; with their rough price (USD). */
const MODELS = new Map([
  ["fal-ai/object-removal/mask", 0.024],
  ["fal-ai/bria/eraser", 0.04],
  ["fal-ai/sam2/image", 0.002],
  ["fal-ai/birefnet/v2", 0.01],
  ["fal-ai/nano-banana-2/edit", 0.12],
  ["openrouter/router/vision", 0.005],
]);

/**
 * Spending brakes on the server, on top of the app's own daily limit: at most
 * FAL_DAILY_LIMIT_USD (default $3) a day and 20 jobs a minute. Kept in memory, so per
 * server instance (a hobby app mostly has one); the hard limit is fal's prepaid
 * credit with automatic top-up off.
 */
const DAILY_USD = Number(process.env.FAL_DAILY_LIMIT_USD) > 0 ? Number(process.env.FAL_DAILY_LIMIT_USD) : 3;
const PER_MINUTE = 20;
let spend = { day: "", usd: 0 };
let recent: number[] = [];
function overBudget(cost: number): string | null {
  const day = new Date().toISOString().slice(0, 10);
  if (spend.day !== day) spend = { day, usd: 0 };
  const now = Date.now();
  recent = recent.filter((t) => now - t < 60_000);
  if (recent.length >= PER_MINUTE) return "Te veel AI-opdrachten in korte tijd (limit). Probeer het over een minuut opnieuw.";
  if (spend.usd + cost > DAILY_USD) return `Daglimiet van de server bereikt ($${DAILY_USD}, FAL_DAILY_LIMIT_USD in Vercel).`;
  return null;
}
/** fal's queue (FAL_QUEUE_URL only for tests with a stand-in server). */
const QUEUE = process.env.FAL_QUEUE_URL?.trim() || "https://queue.fal.run/";
const escaped = QUEUE.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const MAX_BODY = 4_000_000; // Vercel accepts 4.5 MB; photos are sent as ~0.5 MB JPEGs

const key = () => process.env.FAL_KEY?.trim();

/** Optional access code (AI_ACCESS_CODE in Vercel): without it, anyone who finds the site could spend your credit. */
function allowed(req: Request): boolean {
  const code = process.env.AI_ACCESS_CODE?.trim();
  return !code || req.headers.get("x-access-code") === code;
}

const fail = (error: string, status = 400) => NextResponse.json({ error }, { status });

export async function GET(req: Request) {
  const status = new URL(req.url).searchParams.get("status");
  if (!status) return NextResponse.json({ enabled: !!key(), needsCode: !!process.env.AI_ACCESS_CODE?.trim() });
  if (!key()) return fail("Geen fal-sleutel ingesteld", 503);
  if (!allowed(req)) return fail("Toegangscode klopt niet", 401);
  // Only fal's own queue URLs of one request: this route must never fetch anything else with the key.
  const response = new URL(req.url).searchParams.get("response") ?? status.replace(/\/status$/, "");
  const request = status.match(new RegExp(`^(${escaped}[\\w./-]+/requests/[\\w-]+)/status$`))?.[1];
  if (!request || !(response === request || response.startsWith(`${request}/`))) return fail("Ongeldige status-URL");
  const headers = { Authorization: `Key ${key()}` };
  const res = await fetch(status, { headers, cache: "no-store" });
  const body = (await res.json().catch(() => ({}))) as { status?: string; queue_position?: number; error?: string };
  if (!res.ok) return fail(body.error ?? `fal: ${res.status}`, 502);
  if (body.status !== "COMPLETED") return NextResponse.json({ status: body.status, position: body.queue_position });
  if (body.error) return NextResponse.json({ status: "ERROR", error: body.error });
  const out = await fetch(response, { headers, cache: "no-store" });
  const result = await out.json().catch(() => null);
  if (!out.ok) {
    const detail = (result as { detail?: unknown } | null)?.detail;
    return NextResponse.json({ status: "ERROR", error: typeof detail === "string" ? detail : JSON.stringify(detail ?? result).slice(0, 300) });
  }
  return NextResponse.json({ status: "COMPLETED", result });
}

export async function POST(req: Request) {
  if (!key()) return fail("Geen fal-sleutel ingesteld", 503);
  if (!allowed(req)) return fail("Toegangscode klopt niet", 401);
  const text = await req.text();
  if (text.length > MAX_BODY) return fail("Afbeelding te groot", 413);
  let job: { model?: string; input?: Record<string, unknown> };
  try {
    job = JSON.parse(text);
  } catch {
    return fail("Ongeldig verzoek");
  }
  if (!job.model || !MODELS.has(job.model) || !job.input || typeof job.input !== "object") return fail("Onbekend model");
  const cost = MODELS.get(job.model)!;
  const over = overBudget(cost);
  if (over) return fail(over, 429);
  const res = await fetch(`${QUEUE}${job.model}`, {
    method: "POST",
    headers: { Authorization: `Key ${key()}`, "Content-Type": "application/json" },
    body: JSON.stringify(job.input),
  });
  const body = (await res.json().catch(() => ({}))) as { status_url?: string; response_url?: string; detail?: unknown };
  if (!res.ok || !body.status_url) {
    const detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail ?? body).slice(0, 300);
    // 401/403: wrong key; 402/403 with "balance": no credit left.
    return fail(`fal ${res.status}: ${detail}`, 502);
  }
  spend.usd += cost;
  recent.push(Date.now());
  return NextResponse.json({ statusUrl: body.status_url, responseUrl: body.response_url });
}
