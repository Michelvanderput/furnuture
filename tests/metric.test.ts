import { describe, expect, it } from "vitest";
import { calibrate, distanceCm, estimateFocal, footprint } from "@/lib/metric";
import type { Pt, Quad } from "@/lib/types";

/** A simple pinhole camera looking at a floor (y = 0), with pitch and yaw. */
function camera(f: number, W: number, H: number, heightCm: number, pitchDeg: number, yawDeg: number) {
  const p = (pitchDeg * Math.PI) / 180, y = (yawDeg * Math.PI) / 180;
  return ([X, Z]: [number, number]): Pt => {
    // world: X right, Z forward, Y up; camera at (0, height, 0)
    let x = X, yy = -heightCm, z = Z;
    // yaw around Y
    [x, z] = [x * Math.cos(y) - z * Math.sin(y), x * Math.sin(y) + z * Math.cos(y)];
    // pitch down around X
    [yy, z] = [yy * Math.cos(p) + z * Math.sin(p), -yy * Math.sin(p) + z * Math.cos(p)];
    return [W / 2 + (f * x) / z, H / 2 - (f * yy) / z];
  };
}

describe("measuring on a floor in perspective", () => {
  const W = 1440, H = 960;

  it("recovers real distances from one known line (frontal view, typical focal length)", () => {
    const f = W / 2 / Math.tan((75 / 2) * (Math.PI / 180));
    const cam = camera(f, W, H, 150, 25, 0);
    // A 400 × 500 cm rectangle of floor, 150 cm in front of the camera.
    const floor: Quad = [cam([-200, 650]), cam([200, 650]), cam([200, 150]), cam([-200, 150])];
    const metric = calibrate(floor, cam([-200, 300]), cam([200, 300]), 400, W, H)!; // along the width
    // Depth direction: 300 cm between Z=200 and Z=500.
    expect(distanceCm(floor, metric, cam([0, 200]), cam([0, 500]))).toBeCloseTo(300, -1);
    // A diagonal: 3-4-5 triangle of 150 × 200 cm -> 250 cm.
    expect(distanceCm(floor, metric, cam([-100, 250]), cam([50, 450]))).toBeCloseTo(250, -1);
  });

  it("estimates the focal length from two vanishing points when the camera is turned", () => {
    const f = 900;
    const cam = camera(f, W, H, 150, 20, 30);
    const floor: Quad = [cam([-100, 700]), cam([300, 700]), cam([300, 250]), cam([-100, 250])];
    const est = estimateFocal(floor, W, H);
    expect(Math.abs(est - f) / f).toBeLessThan(0.02);
    const metric = calibrate(floor, cam([-100, 300]), cam([300, 300]), 400, W, H)!;
    expect(distanceCm(floor, metric, cam([0, 300]), cam([0, 600]))).toBeCloseTo(300, -1);
  });

  it("draws a product footprint of the right real size", () => {
    const f = W / 2 / Math.tan((75 / 2) * (Math.PI / 180));
    const cam = camera(f, W, H, 150, 25, 0);
    const floor: Quad = [cam([-200, 650]), cam([200, 650]), cam([200, 150]), cam([-200, 150])];
    const metric = calibrate(floor, cam([-200, 300]), cam([200, 300]), 400, W, H)!;
    // Plane units: u 0..1000 across 400 cm, v 0 (far, Z=650) .. 1000 (near, Z=150).
    const fp = footprint(floor, metric, 500, 700, 220, 95, 0); // front edge at Z = 650 - 0.7*500 = 300
    expect(distanceCm(floor, metric, fp[3], fp[2])).toBeCloseTo(220, 0);
    expect(distanceCm(floor, metric, fp[2], fp[1])).toBeCloseTo(95, 0);
    // The back edge is further away, so it is shorter in the photo.
    expect(Math.hypot(fp[1][0] - fp[0][0], fp[1][1] - fp[0][1])).toBeLessThan(Math.hypot(fp[2][0] - fp[3][0], fp[2][1] - fp[3][1]));
  });
});
