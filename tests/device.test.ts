import { afterEach, describe, expect, it, vi } from "vitest";
import { isLowMemoryDevice } from "@/lib/worker";

const nav = (userAgent: string, maxTouchPoints = 0, deviceMemory?: number) =>
  vi.stubGlobal("navigator", { userAgent, maxTouchPoints, deviceMemory });

describe("isLowMemoryDevice", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("recognises iPad Safari, also when it pretends to be a Mac", () => {
    nav("Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1", 5);
    expect(isLowMemoryDevice()).toBe(true);
    nav("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15", 5);
    expect(isLowMemoryDevice()).toBe(true);
  });

  it("keeps the better models on computers", () => {
    nav("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15", 0);
    expect(isLowMemoryDevice()).toBe(false);
    nav("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128.0 Safari/537.36", 0, 8);
    expect(isLowMemoryDevice()).toBe(false);
    nav("Mozilla/5.0 (Linux; Android 14) Chrome/128.0 Mobile Safari/537.36", 5, 4);
    expect(isLowMemoryDevice()).toBe(true);
  });
});
