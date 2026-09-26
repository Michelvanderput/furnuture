import { describe, expect, it } from "vitest";
import { patchFill } from "@/lib/patchFill";

describe("patchFill", () => {
  it("continues a striped pattern into the hole instead of smearing it", () => {
    const w = 160, h = 100;
    const rgba = new Uint8ClampedArray(w * h * 4);
    const stripe = (x: number) => (Math.floor(x / 6) % 2 ? 200 : 60);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rgba.fill(stripe(x), (y * w + x) * 4, (y * w + x) * 4 + 3), (rgba[(y * w + x) * 4 + 3] = 255);
    const mask = new Uint8Array(w * h);
    // Hole borders do not line up with the stripes (as with a real object).
    for (let y = 35; y < 65; y++) for (let x = 62; x < 92; x++) mask[y * w + x] = 1;
    for (let i = 0; i < w * h; i++) if (mask[i]) rgba.fill(128, i * 4, i * 4 + 3);
    patchFill(rgba, mask, w, h);
    // Filled pixels are near the two stripe colours (not a grey average), and mostly in phase.
    let near = 0, inPhase = 0, total = 0;
    for (let y = 35; y < 65; y++) {
      for (let x = 62; x < 92; x++) {
        const v = rgba[(y * w + x) * 4];
        total++;
        if (Math.min(Math.abs(v - 60), Math.abs(v - 200)) < 40) near++;
        if (Math.abs(v - stripe(x)) < 40) inPhase++;
      }
    }
    expect(near / total).toBeGreaterThan(0.85);
    expect(inPhase / total).toBeGreaterThan(0.6);
  });
});

describe("patchFill light", () => {
  it("blends a shadow edge smoothly instead of cutting it", () => {
    const w = 120, h = 70;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = (Math.floor(x / 7) % 2 ? 190 : 170) - (x >= 80 ? 70 : 0);
        rgba.fill(v, (y * w + x) * 4, (y * w + x) * 4 + 3);
        rgba[(y * w + x) * 4 + 3] = 255;
      }
    }
    const mask = new Uint8Array(w * h);
    for (let y = 20; y < 50; y++) for (let x = 40; x < 80; x++) mask[y * w + x] = 1;
    patchFill(rgba, mask, w, h);
    const at = (x: number) => rgba[(35 * w + x) * 4];
    // Next to the dark side the fill is dark, next to the light side light: no hard cut at the border.
    expect(Math.abs(at(79) - at(81))).toBeLessThan(40);
    expect(at(41)).toBeGreaterThan(at(78) + 20);
  });
});
