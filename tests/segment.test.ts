import { describe, expect, it } from "vitest";
import { labelsFromLogits } from "@/lib/labels";
import { buildSegments, mergeSeatParts, type Segment } from "@/lib/segment";

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

describe("cleaning up recognition", () => {
  const labels = { 0: "wall", 3: "floor", 23: "sofa", 39: "cushion" };
  const W = 60, H = 30;
  const room = () => {
    const map = new Uint8Array(W * H);
    for (let y = 20; y < H; y++) for (let x = 0; x < W; x++) map[y * W + x] = 3;
    for (let y = 10; y < 22; y++) for (let x = 10; x < 40; x++) map[y * W + x] = 23;
    return map;
  };

  it("joins a sofa split by a thin shadow", () => {
    const map = room();
    for (let y = 10; y < 22; y++) map[y * W + 25] = 0; // 1 px gap
    const seg = buildSegments(map, W, H, labels);
    expect(seg.segments.filter((s) => s.className === "sofa")).toHaveLength(1);
  });

  it("adds cushions to the sofa and fills holes", () => {
    const map = room();
    for (let y = 12; y < 15; y++) for (let x = 14; x < 20; x++) map[y * W + x] = 39; // cushion on the sofa
    for (let y = 16; y < 18; y++) for (let x = 30; x < 33; x++) map[y * W + x] = 0; // wall seen through
    const seg = buildSegments(map, W, H, labels);
    expect(seg.segments.map((s) => s.label).sort()).toEqual(["Bank", "Muur", "Vloer"]);
    const sofa = seg.segments.find((s) => s.label === "Bank")!;
    expect(seg.ids[13 * W + 16]).toBe(sofa.id);
    expect(seg.ids[16 * W + 31]).toBe(sofa.id);
  });
});

describe("tabletop objects merge into their table", () => {
  const labels = { 0: "wall", 3: "floor", 15: "coffee table", 45: "vase" };
  const W = 60, H = 30;

  it("takes a vase along when the coffee table it stands on is selected", () => {
    const map = new Uint8Array(W * H);
    for (let y = 20; y < H; y++) for (let x = 0; x < W; x++) map[y * W + x] = 3; // floor
    for (let y = 14; y < 22; y++) for (let x = 15; x < 40; x++) map[y * W + x] = 15; // coffee table
    for (let y = 10; y < 15; y++) for (let x = 24; x < 30; x++) map[y * W + x] = 45; // vase resting on it
    const seg = buildSegments(map, W, H, labels);
    expect(seg.segments.map((s) => s.label).sort()).toEqual(["Muur", "Salontafel", "Vloer"]);
    const table = seg.segments.find((s) => s.label === "Salontafel")!;
    expect(seg.ids[12 * W + 27]).toBe(table.id); // pixel inside the vase
  });

  it("leaves a vase on the floor on its own (nothing to merge it into)", () => {
    const map = new Uint8Array(W * H);
    for (let y = 20; y < H; y++) for (let x = 0; x < W; x++) map[y * W + x] = 3; // floor
    for (let y = 15; y < 20; y++) for (let x = 5; x < 10; x++) map[y * W + x] = 45; // vase standing on the floor
    const seg = buildSegments(map, W, H, labels);
    expect(seg.segments.map((s) => s.label).sort()).toEqual(["Muur", "Vaas", "Vloer"]);
  });
});

import { samMaskToPhoto } from "@/lib/labels";

describe("samMaskToPhoto", () => {
  it("maps SAM's padded low-res mask onto the photo", () => {
    // Photo 2:1 -> SAM input 1024×512 (padded to 1024²) -> low-res 256×128 used.
    const low = new Float32Array(256 * 256).fill(-5);
    for (let y = 0; y < 128; y++) for (let x = 128; x < 256; x++) low[y * 256 + x] = 5; // right half of the photo
    const m = samMaskToPhoto(low, 1024, 512, 200, 100);
    expect(m[50 * 200 + 20]).toBe(0);
    expect(m[50 * 200 + 180]).toBe(1);
    expect(m[99 * 200 + 180]).toBe(1); // bottom row still inside the photo part, not the padding
  });
});


describe("corner sofa", () => {
  it("joins an 'armchair' lying against the sofa, keeps a separate armchair apart", () => {
    const w = 60, h = 20;
    const ids = new Int32Array(w * h);
    const fill = (id: number, x0: number, x1: number, y0 = 5, y1 = 15) => {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) ids[y * w + x] = id;
    };
    fill(1, 20, 39); // sofa
    fill(2, 40, 47); // its chaise, recognised as an armchair
    fill(3, 2, 10); // a real armchair, well apart
    const seg = (id: number, className: string, x0: number, x1: number): Segment => ({
      id, kind: "furniture", label: className, className, area: (x1 - x0 + 1) * 11, box: [x0, 5, x1, 15],
    });
    const segments = [seg(1, "sofa", 20, 39), seg(2, "armchair", 40, 47), seg(3, "armchair", 2, 10)];
    mergeSeatParts(segments, ids, w, h);
    expect(segments.map((s) => s.id)).toEqual([1, 3]);
    expect(ids[10 * w + 45]).toBe(1);
    expect(segments[0].box).toEqual([20, 5, 47, 15]);
  });
});

describe("sofa in two pieces", () => {
  it("joins two sofa segments that lie against each other", () => {
    const w = 40, h = 10;
    const ids = new Int32Array(w * h);
    for (let y = 2; y <= 8; y++) for (let x = 5; x <= 34; x++) ids[y * w + x] = x < 20 ? 1 : 2;
    const segments: Segment[] = [
      { id: 1, kind: "furniture", label: "Bank", className: "sofa", area: 105, box: [5, 2, 19, 8] },
      { id: 2, kind: "furniture", label: "Bank", className: "sofa", area: 105, box: [20, 2, 34, 8] },
    ];
    mergeSeatParts(segments, ids, w, h);
    expect(segments).toHaveLength(1);
    expect(new Set(ids.filter(Boolean))).toEqual(new Set([segments[0].id]));
  });
});
