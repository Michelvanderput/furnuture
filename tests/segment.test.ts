import { describe, expect, it } from "vitest";
import { labelsFromLogits } from "@/lib/labels";
import { buildSegments } from "@/lib/segment";

describe("labelsFromLogits", () => {
  it("picks the best class per pixel and scales up to the photo size", () => {
    // 3 classes on a 2x2 grid: left column class 1, right column class 2.
    const C = 3, h = 2, w = 2;
    const logits = new Float32Array(C * h * w);
    const set = (k: number, y: number, x: number, v: number) => (logits[k * h * w + y * w + x] = v);
    set(1, 0, 0, 5); set(1, 1, 0, 5);
    set(2, 0, 1, 5); set(2, 1, 1, 5);
    const out = labelsFromLogits(logits, C, h, w, 40, 20);
    expect(out.length).toBe(800);
    expect(out[5 * 40 + 2]).toBe(1);
    expect(out[5 * 40 + 37]).toBe(2);
  });

  it("stays small for a Funda-sized photo", () => {
    const C = 150, h = 128, w = 128;
    const logits = new Float32Array(C * h * w);
    const out = labelsFromLogits(logits, C, h, w, 1440, 960);
    expect(out.length).toBe(1440 * 960); // 1.4 MB, instead of 150 × 1440 × 960 floats (~830 MB)
  });
});

describe("buildSegments", () => {
  it("splits furniture into objects and keeps the floor whole", () => {
    const w = 20, h = 10;
    const map = new Uint8Array(w * h); // 0 = wall
    for (let y = 6; y < h; y++) for (let x = 0; x < w; x++) map[y * w + x] = 3; // floor
    for (let y = 3; y < 7; y++) for (let x = 2; x < 6; x++) map[y * w + x] = 19; // chair 1
    for (let y = 3; y < 7; y++) for (let x = 12; x < 16; x++) map[y * w + x] = 19; // chair 2
    const seg = buildSegments(map, w, h, { 0: "wall", 3: "floor", 19: "chair" });
    const labels = seg.segments.map((s) => s.label).sort();
    expect(labels).toEqual(["Muur", "Stoel 1", "Stoel 2", "Vloer"]);
    const chair = seg.segments.find((s) => s.label === "Stoel 1")!;
    expect(chair.box).toEqual([2, 3, 5, 6]);
    expect(seg.ids[4 * w + 3]).toBe(chair.id);
  });
});
