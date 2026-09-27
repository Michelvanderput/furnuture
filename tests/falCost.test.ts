import { beforeEach, describe, expect, it, vi } from "vitest";

// A tiny browser: localStorage and fetch (to the app's /api/fal).
const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
});
let submits = 0;
let reply: () => Response;
vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
  if (init?.method === "POST") {
    submits++;
    return reply();
  }
  return new Response(JSON.stringify({ status: "COMPLETED", result: { ok: true } }));
});
vi.stubGlobal("setTimeout", (fn: () => void) => (fn(), 0));

const ok = () => new Response(JSON.stringify({ statusUrl: "s", responseUrl: "r" }));

beforeEach(() => {
  store.clear();
  submits = 0;
  reply = ok;
  vi.resetModules();
});

describe("fal costs", () => {
  it("counts what is spent today", async () => {
    const fal = await import("@/lib/fal");
    await fal.falRun("fal-ai/object-removal/mask", { a: 1 });
    expect(fal.spentToday()).toBeCloseTo(0.024);
  });

  it("sends the same job at the same time only once", async () => {
    const fal = await import("@/lib/fal");
    await Promise.all([fal.falRun("fal-ai/sam-3/image", { p: 1 }), fal.falRun("fal-ai/sam-3/image", { p: 1 })]);
    expect(submits).toBe(1);
  });

  it("stops at the daily limit", async () => {
    const fal = await import("@/lib/fal");
    fal.setDailyLimitEur(0.2);
    await fal.falRun("fal-ai/nano-banana-2/edit", { n: 1 });
    await expect(fal.falRun("fal-ai/nano-banana-2/edit", { n: 2 })).rejects.toThrow(/Daglimiet/);
    expect(submits).toBe(1);
  });

  it("stops asking fal when the credit is gone", async () => {
    const fal = await import("@/lib/fal");
    reply = () => new Response(JSON.stringify({ error: "fal 403: User is locked. Reason: Exhausted balance." }), { status: 502 });
    await expect(fal.falRun("fal-ai/sam-3/image", { p: 1 })).rejects.toThrow(/tegoed op/);
    await expect(fal.falRun("fal-ai/sam-3/image", { p: 2 })).rejects.toThrow(/tegoed op/);
    expect(submits).toBe(1);
    expect(fal.falStopped()).toMatch(/tegoed/);
  });
});

describe("fal selection", () => {
  it("accepts a mask right next to the tap, not one far away", async () => {
    const { nearTap } = await import("@/lib/falTasks");
    const w = 200, h = 100;
    const mask = new Uint8Array(w * h);
    for (let y = 40; y < 60; y++) for (let x = 50; x < 90; x++) mask[y * w + x] = 1;
    expect(nearTap(mask, w, h, [0.35, 0.5])).toBe(true); // inside
    expect(nearTap(mask, w, h, [0.35, 0.62])).toBe(true); // 2 px below the edge
    expect(nearTap(mask, w, h, [0.8, 0.5])).toBe(false); // elsewhere
  });
});
