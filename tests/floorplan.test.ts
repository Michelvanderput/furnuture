import { describe, expect, it } from "vitest";
import { homography } from "@/lib/geometry";
import { floodRoom, itemToLayer, linkFromWall, linkedView } from "@/lib/floorplan";
import type { PlanItem, Pt, Quad } from "@/lib/types";

/** Camera from tests/camera.test.ts: plan X right, Y down, Z up (plan pixels = cm here). */
function shoot(f: number, W: number, H: number, camX: number, camY: number, height: number, yawDeg: number, pitchDeg: number) {
  const yaw = (yawDeg * Math.PI) / 180, pitch = (pitchDeg * Math.PI) / 180;
  const fwd = [Math.sin(yaw) * Math.cos(pitch), -Math.cos(yaw) * Math.cos(pitch), -Math.sin(pitch)];
  const right = [Math.cos(yaw), Math.sin(yaw), 0];
  const down = [right[1] * fwd[2] - right[2] * fwd[1], right[2] * fwd[0] - right[0] * fwd[2], right[0] * fwd[1] - right[1] * fwd[0]]; // right × forward: image y points down
  return ([X, Y, Z]: [number, number, number]): Pt => {
    const d = [X - camX, Y - camY, Z - height];
    const x = d[0] * right[0] + d[1] * right[1] + d[2] * right[2];
    const y = d[0] * down[0] + d[1] * down[1] + d[2] * down[2];
    const z = d[0] * fwd[0] + d[1] * fwd[1] + d[2] * fwd[2];
    return [W / 2 + (f * x) / z, H / 2 + (f * y) / z];
  };
}

describe("floor plan rooms", () => {
  it("fills a room up to its walls", () => {
    const w = 60, h = 40;
    const data = new Uint8ClampedArray(w * h * 4).fill(255);
    const wall = (x: number, y: number) => data.set([0, 0, 0, 255], (y * w + x) * 4);
    for (let x = 5; x <= 35; x++) wall(x, 5), wall(x, 30);
    for (let y = 5; y <= 30; y++) wall(5, y), wall(35, y);
    const poly = floodRoom({ data, width: w, height: h }, [20, 20])!;
    const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
    expect([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]).toEqual([6, 34, 6, 29]);
    // Tapping outside the house (everything around it) is refused.
    expect(floodRoom({ data, width: w, height: h }, [50, 35], 0.3)).toBeNull();
  });
});

describe("linking a photo and seeing plan furniture in it", () => {
  const W = 1440, H = 960, f = W / 2 / Math.tan((75 / 2) * (Math.PI / 180));
  // Room 500 × 400 cm (plan px = cm); camera at the bottom wall looking up at the top wall.
  const room: Pt[] = [[100, 100], [600, 100], [600, 500], [100, 500]];
  const cam = shoot(f, W, H, 350, 520, 150, 0, 15);
  // What the recognition would give: the floor in the photo, its far edge on the top wall.
  const floorQuad = [[100, 100], [600, 100], [600, 420], [100, 420]].map(([x, y]) => cam([x, y, 0])) as Quad;

  it("puts the photo's floor on the plan from one tapped wall", () => {
    const plan = linkFromWall(room, 0, floorQuad, W, H);
    expect(plan[0][0]).toBeCloseTo(100, 0);
    expect(plan[1][0]).toBeCloseTo(600, 0);
    // Depth recovered from perspective: 320 cm (the patch was 100..420).
    expect(plan[3][1]).toBeCloseTo(420, -1);
  });

  it("shows a 220 × 95 × 80 cm sofa at the right place and size", () => {
    const plan = linkFromWall(room, 0, floorQuad, W, H);
    const view = linkedView({ floorId: "f", plan, imageW: W, imageH: H }, floorQuad, W, H)!;
    const sofa: PlanItem = { id: "s", productId: "p", x: 350, y: 200, angle: 0, w: 220, d: 95, h: 80, flip: false, cutout: "simple", tolerance: 18 };
    const layer = itemToLayer(sofa, view, 1, 0.4)!;
    // Front face (towards the camera, +Y): bottom corners on the floor, top corners 80 cm up.
    const want = [[240, 247.5, 80], [460, 247.5, 80], [460, 247.5, 0], [240, 247.5, 0]].map((p) => cam(p as [number, number, number]));
    layer.corners.forEach((c, i) => expect(Math.hypot(c[0] - want[i][0], c[1] - want[i][1])).toBeLessThan(6));
    expect(layer.flip).toBe(false);
    // Turned around (facing the wall): the camera sees its back.
    expect(itemToLayer({ ...sofa, angle: 180 }, view, 1, 0.4)!.flip).toBe(true);
  });

  it("uses the plan homography consistently", () => {
    const plan = linkFromWall(room, 0, floorQuad, W, H);
    const h = homography(plan, floorQuad);
    expect(h).toHaveLength(9);
  });
});
