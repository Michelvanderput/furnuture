import { describe, expect, it } from "vitest";
import { cameraFromHomography, cameraOnPlan, focalFromHomography, project3 } from "@/lib/camera";
import { homography } from "@/lib/geometry";
import type { Pt, Quad } from "@/lib/types";

/**
 * Synthetic room: plan coordinates X right, Y down the drawing (cm), Z up.
 * The camera stands at (camX, camY), `height` cm up, looking in direction `yaw`
 * (0 = towards −Y, "up" the drawing), tilted down by `pitch`.
 */
function shoot(f: number, W: number, H: number, camX: number, camY: number, height: number, yawDeg: number, pitchDeg: number) {
  const yaw = (yawDeg * Math.PI) / 180, pitch = (pitchDeg * Math.PI) / 180;
  // Camera axes in world coordinates (world: X right, Y down the plan, Z up).
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

describe("camera from the floor", () => {
  const W = 1440, H = 960, f = 850;
  const cam = shoot(f, W, H, 250, 700, 140, 25, 18);
  // Four floor points on the plan (a 400 × 300 cm patch in front of the camera) and where they appear.
  const plan: Quad = [[100, 100], [500, 100], [500, 400], [100, 400]];
  const image = plan.map(([x, y]) => cam([x, y, 0])) as Quad;
  const Hm = homography(plan, image);

  it("recovers the focal length", () => {
    expect(Math.abs(focalFromHomography(Hm, W, H)! - f) / f).toBeLessThan(0.01);
  });

  it("projects points above the floor correctly (a sofa's top edge)", () => {
    const c = cameraFromHomography(Hm, W, H)!;
    for (const p of [[300, 250, 80], [150, 380, 200], [450, 120, 45]] as [number, number, number][]) {
      const got = project3(c, p[0], p[1], p[2])!;
      const want = cam(p);
      expect(Math.hypot(got[0] - want[0], got[1] - want[1])).toBeLessThan(1.5);
    }
  });

  it("puts the photographer on the plan", () => {
    const c = cameraFromHomography(Hm, W, H)!;
    const pos = cameraOnPlan(c);
    expect(pos.x).toBeCloseTo(250, -1);
    expect(pos.y).toBeCloseTo(700, -1);
    expect(pos.height).toBeCloseTo(140, -1);
    // Looking "up" the drawing and a bit to the right.
    expect(pos.dir[1]).toBeLessThan(0);
    expect(pos.dir[0]).toBeGreaterThan(0);
  });
});
