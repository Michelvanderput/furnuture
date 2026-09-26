import { describe, expect, it } from "vitest";
import { homography, project } from "@/lib/geometry";
import { placeOnFloor, syncAnchors } from "@/lib/layers";
import { components, dilate } from "@/lib/masks";
import { anchoredCorners, fitFloorQuad, fitWallQuad, localScale, PLANE } from "@/lib/plane";
import type { Layer, ProductLayer, Quad, SurfaceLayer } from "@/lib/types";

/** Rasterises a convex quad into a mask. */
function quadMask(q: Quad, w: number, h: number): Uint8Array {
  const m = new Uint8Array(w * h);
  const inside = (x: number, y: number) =>
    q.every((a, i) => {
      const b = q[(i + 1) % 4];
      return (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]) >= 0;
    });
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[y * w + x] = inside(x + 0.5, y + 0.5) ? 1 : 0;
  return m;
}

// A floor seen in perspective: far edge 300..500 at y=120, running out of the photo at the bottom.
const W = 800, H = 400;
const FLOOR: Quad = [[300, 120], [500, 120], [800 + 60, 400], [-60, 400]];

describe("fitting planes to masks", () => {
  it("recovers a floor's perspective from its mask", () => {
    const q = fitFloorQuad(quadMask(FLOOR, W, H), W, H)!;
    expect(q).not.toBeNull();
    expect(q[0][0]).toBeCloseTo(300, -1);
    expect(q[1][0]).toBeCloseTo(500, -1);
    expect(q[0][1]).toBeCloseTo(120, -1);
    expect(q[2][1]).toBe(H);
    // Side lines continue beyond the photo like the real floor.
    expect(q[3][0]).toBeLessThan(0);
    expect(q[2][0]).toBeGreaterThan(W);
  });

  it("ignores a sofa cut out of the floor", () => {
    const mask = quadMask(FLOOR, W, H);
    for (let y = 200; y < 260; y++) for (let x = 340; x < 460; x++) mask[y * W + x] = 0;
    const q = fitFloorQuad(mask, W, H)!;
    expect(q[0][1]).toBeCloseTo(120, -1);
    expect(q[1][0]).toBeCloseTo(500, -1);
  });

  it("is not fooled by a big sofa standing on the far edge", () => {
    const mask = quadMask(FLOOR, W, H);
    const sofa = new Uint8Array(W * H);
    for (let y = 60; y < 200; y++) for (let x = 320; x < 450; x++) (sofa[y * W + x] = 1), (mask[y * W + x] = 0);
    const q = fitFloorQuad(mask, W, H, sofa)!;
    expect(q[0][1]).toBeCloseTo(120, -1);
    expect(q[1][1]).toBeCloseTo(120, -1);
  });

  it("fits a wall with vertical sides and sloping top and bottom", () => {
    const wall: Quad = [[100, 50], [300, 80], [300, 300], [100, 330]];
    const q = fitWallQuad(quadMask(wall, W, H), W, H)!;
    expect(q[0][0]).toBeCloseTo(100, -1);
    expect(q[1][0]).toBeCloseTo(300, -1);
    expect(q[0][1]).toBeLessThan(q[1][1]);
    expect(q[3][1]).toBeGreaterThan(q[2][1]);
  });

  it("finds a wall's bottom edge behind a sofa", () => {
    const wall: Quad = [[0, 0], [W, 0], [W, 250], [0, 250]];
    const mask = quadMask(wall, W, H);
    const sofa = new Uint8Array(W * H);
    for (let y = 150; y < 300; y++) for (let x = 100; x < 600; x++) (sofa[y * W + x] = 1), (mask[y * W + x] = 0);
    const q = fitWallQuad(mask, W, H, sofa)!;
    expect(q[2][1]).toBeCloseTo(249, 0);
    expect(q[3][1]).toBeCloseTo(249, 0);
  });
});

describe("standing on the floor", () => {
  const floorLayer: SurfaceLayer = {
    kind: "surface", id: "f", points: [], plane: FLOOR, role: "floor",
    fill: { type: "preset", preset: "eiken-naturel" }, opacity: 1, blend: "normal", scale: 350, perspective: true, crop: 1,
  };
  const sofa: ProductLayer = {
    kind: "product", id: "s", productId: "p", corners: [[300, 200], [500, 200], [500, 300], [300, 300]],
    aspect: 0.5, flip: false, cutout: "simple", tolerance: 18, distort: false,
  };

  it("gets smaller further away", () => {
    expect(localScale(FLOOR, [PLANE / 2, 100])).toBeLessThan(localScale(FLOOR, [PLANE / 2, 900]));
    const near = anchoredCorners(FLOOR, { planeId: "f", u: 500, v: 900, width: 300, angle: 0 }, 0.5);
    const far = anchoredCorners(FLOOR, { planeId: "f", u: 500, v: 200, width: 300, angle: 0 }, 0.5);
    expect(far[1][0] - far[0][0]).toBeLessThan(near[1][0] - near[0][0]);
    // Bottom corners lie on the floor, sides are vertical.
    const toImage = homography([[0, 0], [PLANE, 0], [PLANE, PLANE], [0, PLANE]], FLOOR);
    const bl = project(toImage, [350, 900]);
    expect(near[3][0]).toBeCloseTo(bl[0], 3);
    expect(near[0][0]).toBeCloseTo(near[3][0], 6);
  });

  it("keeps its size when placed, and follows the floor when that changes", () => {
    const placed = placeOnFloor(sofa, floorLayer);
    expect(placed.floor).toBeDefined();
    expect(placed.corners[2][0] - placed.corners[3][0]).toBeCloseTo(200, 0);
    const layers: Layer[] = [{ ...floorLayer, plane: [[280, 100], [520, 100], [860, 400], [-60, 400]] }, placed];
    const synced = syncAnchors(layers)[1] as ProductLayer;
    expect(synced.corners).not.toEqual(placed.corners);
    // Floor removed: the product keeps its corners and is no longer anchored.
    const orphan = syncAnchors([placed])[0] as ProductLayer;
    expect(orphan.floor).toBeUndefined();
  });
});

describe("masks", () => {
  it("dilates and splits into components", () => {
    const w = 10, h = 5;
    const m = new Uint8Array(w * h);
    m[2 * w + 2] = 1;
    m[2 * w + 7] = 1;
    expect(components(m, w, h).sizes).toEqual([0, 1, 1]);
    const d = dilate(m, w, h, 1);
    expect(d.reduce((s, v) => s + v, 0)).toBe(18);
    expect(components(d, w, h).sizes.length).toBe(3);
  });
});

import { dropSpecks, extendDown, fillHoles, interiorPoints, paintCircle } from "@/lib/masks";

describe("mask clean-up", () => {
  const w = 40, h = 30;
  const box = () => {
    const m = new Uint8Array(w * h);
    for (let y = 5; y < 25; y++) for (let x = 5; x < 35; x++) m[y * w + x] = 1;
    return m;
  };

  it("fills holes, drops specks, extends shadows down", () => {
    const m = box();
    m[15 * w + 20] = 0; // hole
    m[1 * w + 1] = 1; // speck
    const clean = dropSpecks(fillHoles(m, w, h), w, h);
    expect(clean[15 * w + 20]).toBe(1);
    expect(clean[1 * w + 1]).toBe(0);
    const down = extendDown(clean, w, h, 3);
    expect(down[27 * w + 10]).toBe(1);
    expect(down[28 * w + 10]).toBe(0);
  });

  it("spreads prompt points over the object", () => {
    const pts = interiorPoints(box(), w, h, 3, [6, 6]);
    expect(pts).toHaveLength(3);
    // The first extra point is far from the tap (the other end of the sofa).
    expect(pts[0][0] + pts[0][1]).toBeGreaterThan(40);
  });

  it("paints with a brush", () => {
    const m = new Uint8Array(w * h);
    paintCircle(m, w, h, 10, 10, 2, 1);
    expect(m[10 * w + 10]).toBe(1);
    expect(m[10 * w + 13]).toBe(0);
  });
});
