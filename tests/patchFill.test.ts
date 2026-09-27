import { describe, expect, it } from "vitest";
import { patchFill } from "@/lib/patchFill";
import { furnitureAt, regionMap } from "@/lib/regions";

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
  it("blends a gradual window-light falloff smoothly, keeping the plank texture", () => {
    // A realistic room: light fades gradually left-to-right (a window on the left),
    // over the plank texture. Never a hard 1px step like a studio backdrop.
    const w = 160, h = 90;
    const rgba = new Uint8ClampedArray(w * h * 4);
    const light = (x: number) => 100 + 100 / (1 + Math.exp((x - 80) / 18));
    const stripe = (x: number) => (Math.floor(x / 7) % 2 ? 12 : -12);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = Math.round(light(x) + stripe(x));
        rgba.fill(v, (y * w + x) * 4, (y * w + x) * 4 + 3);
        rgba[(y * w + x) * 4 + 3] = 255;
      }
    }
    const mask = new Uint8Array(w * h);
    for (let y = 25; y < 65; y++) for (let x = 50; x < 110; x++) mask[y * w + x] = 1;
    patchFill(rgba, mask, w, h);
    const at = (x: number) => rgba[(45 * w + x) * 4];
    // No hard seam right at the hole's borders: close to the known neighbour outside it.
    expect(Math.abs(at(51) - at(49))).toBeLessThan(25);
    expect(Math.abs(at(108) - at(110))).toBeLessThan(25);
    // The window's falloff still shows across the hole (left brighter than right).
    expect(at(51)).toBeGreaterThan(at(108) + 15);
    // Plank texture (not just a flat gradient) is still visible inside the hole.
    const row = Array.from({ length: 60 }, (_, i) => at(50 + i));
    const diffs = row.slice(1).map((v, i) => Math.abs(v - row[i]));
    expect(Math.max(...diffs)).toBeGreaterThan(8);
  });
});

describe("furniture is never a source", () => {
  it("marks recognised furniture, not rugs or walls", () => {
    const w = 4, h = 1;
    const seg = {
      w, h,
      ids: Int32Array.from([1, 2, 3, 0]),
      segments: [
        { id: 1, kind: "furniture" as const, label: "Tafel", className: "table", area: 1, box: [0, 0, 0, 0] as [number, number, number, number] },
        { id: 2, kind: "furniture" as const, label: "Vloerkleed", className: "rug", area: 1, box: [1, 0, 1, 0] as [number, number, number, number] },
        { id: 3, kind: "wall" as const, label: "Muur", area: 1, box: [2, 0, 2, 0] as [number, number, number, number] },
      ],
    };
    const map = regionMap(seg);
    // The table (grown by 2 px) covers the rug next to it here, but not the far end.
    expect(map.furniture[0]).toBe(1);
    const at = furnitureAt(map, 400, 100);
    expect(at(10, 50)).toBe(true);
    expect(regionMap({ ...seg, ids: Int32Array.from([0, 2, 3, 0]) }).furniture.some(Boolean)).toBe(false);
  });
});
