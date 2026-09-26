import { describe, expect, it } from "vitest";
import { intersect } from "@/lib/metric";
import { fitFloorQuad } from "@/lib/plane";
import type { Pt } from "@/lib/types";

/** Camera: plan X right, Y down the drawing, Z up (cm). yaw 0 = looking towards −Y. Image y down. */
function shoot(f: number, W: number, H: number, camX: number, camY: number, height: number, yawDeg: number, pitchDeg: number) {
  const yaw = (yawDeg * Math.PI) / 180, pitch = (pitchDeg * Math.PI) / 180;
  const fwd = [Math.sin(yaw) * Math.cos(pitch), -Math.cos(yaw) * Math.cos(pitch), -Math.sin(pitch)];
  const right = [Math.cos(yaw), Math.sin(yaw), 0];
  const down = [right[1] * fwd[2] - right[2] * fwd[1], right[2] * fwd[0] - right[0] * fwd[2], right[0] * fwd[1] - right[1] * fwd[0]];
  const cam = ([X, Y, Z]: number[]): Pt | null => {
    const d = [X - camX, Y - camY, Z - height];
    const z = d[0] * fwd[0] + d[1] * fwd[1] + d[2] * fwd[2];
    if (z <= 1) return null;
    return [W / 2 + (f * (d[0] * right[0] + d[1] * right[1] + d[2] * right[2])) / z, H / 2 + (f * (d[0] * down[0] + d[1] * down[1] + d[2] * down[2])) / z];
  };
  return cam;
}

/** Floor mask of a room (x0..x1, y0..y1 on the plan) as seen by the camera, with an optional sofa hiding part of it. */
function floorMask(cam: (p: number[]) => Pt | null, w: number, h: number, room: [number, number, number, number], sofa?: [number, number, number, number]) {
  const mask = new Uint8Array(w * h);
  const occ = new Uint8Array(w * h);
  const [x0, y0, x1, y1] = room;
  // Sample the floor densely and splat into the mask.
  for (let X = x0; X <= x1; X += 2) for (let Y = y0; Y <= y1; Y += 2) {
    const p = cam([X, Y, 0]);
    if (!p) continue;
    const px = Math.floor(p[0]), py = Math.floor(p[1]);
    if (px < 0 || py < 0 || px >= w || py >= h) continue;
    const inSofa = sofa && X >= sofa[0] && X <= sofa[2] && Y >= sofa[1] && Y <= sofa[3];
    if (!inSofa) for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) if (px + dx < w && py + dy < h) mask[(py + dy) * w + px + dx] = 1;
  }
  if (sofa) {
    // The sofa's front (80 cm high) hides the floor behind it: mark it as furniture.
    for (let X = sofa[0]; X <= sofa[2]; X += 2) for (let Z = 0; Z <= 80; Z += 2) {
      const p = cam([X, sofa[3], Z]);
      if (!p) continue;
      const px = Math.floor(p[0]), py = Math.floor(p[1]);
      for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) {
        const x = px + dx, y = py + dy;
        if (x >= 0 && y >= 0 && x < w && y < h) (occ[y * w + x] = 1), (mask[y * w + x] = 0);
      }
    }
  }
  return { mask, occ };
}

/** Where the quad's side lines meet: the depth vanishing point it implies. */
const quadV2 = (q: Pt[]) => intersect(q[0], q[3], q[1], q[2]);

describe("floor perspective from a mask", () => {
  const W = 480, H = 320, f = W / 2 / Math.tan((75 / 2) * (Math.PI / 180));

  it("level camera turned 25°, floor sides out of view: planks still point at the right vanishing point", () => {
    const cam = shoot(f, W, H, 300, 900, 150, 25, 0);
    const { mask } = floorMask(cam, W, H, [-400, 100, 1200, 880]);
    const q = fitFloorQuad(mask, W, H)!;
    // True vanishing point of the room's depth direction (−Y).
    const vp = cam([300 + 0, 900 - 1e7, 0]) ?? cam([300, 900 - 1e7, 150])!;
    const got = quadV2(q)!;
    expect(Math.abs(got[0] - vp[0]) / W).toBeLessThan(0.05);
    expect(Math.abs(got[1] - vp[1]) / H).toBeLessThan(0.05);
  });

  it("camera tilted down with both sides visible: uses the side edges", () => {
    const cam = shoot(f, W, H, 300, 700, 150, 0, 18);
    const { mask, occ } = floorMask(cam, W, H, [100, 100, 500, 690], [180, 110, 420, 210]);
    const q = fitFloorQuad(mask, W, H, occ)!;
    const vp = cam([300, 700 - 1e7, 150 - 1e7 * 0])!;
    const got = quadV2(q)!;
    expect(Math.abs(got[0] - vp[0]) / W).toBeLessThan(0.05);
    expect(Math.abs(got[1] - vp[1]) / H).toBeLessThan(0.08);
  });

  it("a wide sofa whose mask leaves a small gap to the floor does not pass for the far edge", () => {
    const cam = shoot(f, W, H, 350, 520, 150, 0, 15);
    const room: [number, number, number, number] = [100, 100, 600, 480];
    const { mask, occ } = floorMask(cam, W, H, room, [200, 105, 500, 200]);
    // Recognition masks seldom touch: shrink the sofa 3 px away from the floor.
    const gap = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (occ[y * W + x] && !occ[Math.min(H - 1, y + 3) * W + x]) gap[y * W + x] = 1;
    for (let i = 0; i < gap.length; i++) if (gap[i]) occ[i] = 0;
    const q = fitFloorQuad(mask, W, H, occ)!;
    const far = cam([350, 100, 0])!;
    expect(Math.abs((q[0][1] + q[1][1]) / 2 - far[1])).toBeLessThan(H * 0.02);
  });

  it("covers the whole floor", () => {
    const cam = shoot(f, W, H, 300, 900, 150, 25, 0);
    const { mask } = floorMask(cam, W, H, [-400, 100, 1200, 880]);
    const q = fitFloorQuad(mask, W, H)!;
    let outside = 0, total = 0;
    const inQuad = (x: number, y: number) =>
      q.every((a, i) => {
        const b = q[(i + 1) % 4];
        return (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]) >= -1;
      });
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (mask[y * W + x]) (total++, inQuad(x + 0.5, y + 0.5) || outside++);
    expect(outside / total).toBeLessThan(0.01);
  });
});

import { extendedPlane, fitWallQuads } from "@/lib/plane";

describe("walls in corners", () => {
  it("splits a wall mask that turns a corner into two walls", () => {
    const W = 480, H = 320;
    const mask = new Uint8Array(W * H);
    // Left wall: floor line rising to the corner at x=200; far wall: flat floor line.
    for (let x = 0; x < W; x++) {
      const bottom = x < 200 ? 300 - x * 0.5 : 200;
      const top = x < 200 ? 20 + x * 0.3 : 80;
      for (let y = Math.round(top); y <= Math.round(bottom); y++) mask[y * W + x] = 1;
    }
    const parts = fitWallQuads(mask, W, H);
    expect(parts).toHaveLength(2);
    expect(Math.abs(parts[0].x1 - 200)).toBeLessThan(12);
    expect(parts[1].quad[3][1]).toBeCloseTo(200, 0);
  });

  it("keeps a single flat wall in one piece", () => {
    const W = 480, H = 320;
    const mask = new Uint8Array(W * H);
    for (let x = 0; x < W; x++) for (let y = 60; y <= Math.round(220 + x * 0.05); y++) mask[y * W + x] = 1;
    expect(fitWallQuads(mask, W, H)).toHaveLength(1);
  });
});

describe("extended plane", () => {
  it("grows sideways, towards the camera and on towards the horizon (open-plan rooms)", () => {
    const plane: [number, number][] = [[200, 150], [280, 150], [400, 320], [80, 320]];
    const e = extendedPlane(plane as never, "floor")!;
    expect(e.quad[3][1]).toBeGreaterThan(320);
    expect(e.quad[0][1]).toBeLessThan(140);
    // The side lines meet at y = 150 − 170·80/240 ≈ 93 (the horizon): the plane stays below it.
    expect(e.quad[0][1]).toBeGreaterThan(93);
    expect(e.quad.every((p) => p.every(Number.isFinite))).toBe(true);
  });
});
