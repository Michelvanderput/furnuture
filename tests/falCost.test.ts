import { beforeEach, describe, expect, it, vi } from "vitest";

// A tiny browser: localStorage and fetch (to the app's /api/fal).
const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
});
let submits = 0;
let result: unknown = { ok: true };
let reply: () => Response;
vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
  if (init?.method === "POST") {
    submits++;
    return reply();
  }
  return new Response(JSON.stringify({ status: "COMPLETED", result }));
});
vi.stubGlobal("setTimeout", (fn: () => void) => (fn(), 0));

const ok = () => new Response(JSON.stringify({ statusUrl: "s", responseUrl: "r" }));

beforeEach(() => {
  store.clear();
  submits = 0;
  reply = ok;
  result = { ok: true };
  vi.resetModules();
});

describe("fal costs", () => {
  it("counts what is spent today", async () => {
    const fal = await import("@/lib/fal");
    await fal.falRun("openrouter/router/vision", { a: 1 });
    expect(fal.spentToday()).toBeCloseTo(0.01);
  });

  it("sends the same job at the same time only once", async () => {
    const fal = await import("@/lib/fal");
    await Promise.all([fal.falRun("openrouter/router/vision", { p: 1 }), fal.falRun("openrouter/router/vision", { p: 1 })]);
    expect(submits).toBe(1);
  });

  it("stops at the daily limit", async () => {
    const fal = await import("@/lib/fal");
    fal.setDailyLimitEur(0.1);
    // Web searches: ± 4 cent each.
    await fal.falRun("openrouter/router/vision", { n: 1, enable_web_search: true });
    await fal.falRun("openrouter/router/vision", { n: 2, enable_web_search: true });
    await expect(fal.falRun("openrouter/router/vision", { n: 3, enable_web_search: true })).rejects.toThrow(/Daglimiet/);
    expect(submits).toBe(2);
  });

  it("books the real price when the model reports it", async () => {
    const fal = await import("@/lib/fal");
    result = { output: "{}", usage: { cost: 0.0008 } };
    await fal.falRun("openrouter/router/vision", { q: 1 });
    expect(fal.spentToday()).toBeCloseTo(0.0008);
  });

  it("stops asking fal when the credit is gone", async () => {
    const fal = await import("@/lib/fal");
    reply = () => new Response(JSON.stringify({ error: "fal 403: User is locked. Reason: Exhausted balance." }), { status: 502 });
    await expect(fal.falRun("openrouter/router/vision", { p: 1 })).rejects.toThrow(/tegoed op/);
    await expect(fal.falRun("openrouter/router/vision", { p: 2 })).rejects.toThrow(/tegoed op/);
    expect(submits).toBe(1);
    expect(fal.falStopped()).toMatch(/tegoed/);
  });
});
