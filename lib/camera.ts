import type { Pt } from "./types";

/**
 * A full pinhole camera recovered from how the floor looks in a photo.
 *
 * Input: the homography H that maps floor-plan coordinates (X, Y on the plan)
 * to photo pixels. For a camera K[R|t] looking at the plane Z = 0:
 *   H ~ K [r1 r2 t]
 * With the principal point in the middle and square pixels, only the focal
 * length f is unknown; r1 ⟂ r2 and |r1| = |r2| give it (Zhang's constraints).
 * Then R and t follow, and any 3D point — a sofa's top edge, 80 cm above the
 * floor — can be projected into the photo.
 */
export interface Camera {
  f: number;
  cx: number;
  cy: number;
  r1: number[];
  r2: number[];
  r3: number[];
  t: number[];
  /** Which way along r3 is "up" (the camera always stands above the floor). */
  up: 1 | -1;
}

type M3 = number[]; // row-major 3×3

const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: number[]) => Math.hypot(a[0], a[1], a[2]);
const scale = (a: number[], s: number) => a.map((v) => v * s);
const sub = (a: number[], b: number[]) => a.map((v, i) => v - b[i]);
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

export const defaultFocal = (imageW: number) => imageW / 2 / Math.tan((75 / 2) * (Math.PI / 180));

/** Focal length from a plane homography (plan → photo), or null when it cannot be determined. */
export function focalFromHomography(m: M3, imageW: number, imageH: number): number | null {
  const cx = imageW / 2, cy = imageH / 2;
  const col = (i: number) => [m[i] - cx * m[6 + i], m[3 + i] - cy * m[6 + i], m[6 + i]];
  const h1 = col(0), h2 = col(1);
  const lo = (imageW * 0.35) ** 2, hi = (imageW * 2.5) ** 2;
  const candidates: number[] = [];
  // r1 ⟂ r2
  const d1 = h1[2] * h2[2];
  if (Math.abs(d1) > 1e-12) candidates.push(-(h1[0] * h2[0] + h1[1] * h2[1]) / d1);
  // |r1| = |r2|
  const d2 = h1[2] ** 2 - h2[2] ** 2;
  if (Math.abs(d2) > 1e-12) candidates.push(-(h1[0] ** 2 + h1[1] ** 2 - h2[0] ** 2 - h2[1] ** 2) / d2);
  const ok = candidates.filter((f2) => f2 > lo && f2 < hi);
  if (!ok.length) return null;
  return Math.sqrt(ok.reduce((s, v) => s + v, 0) / ok.length);
}

export function cameraFromHomography(m: M3, imageW: number, imageH: number, focal?: number): Camera | null {
  const f = focal ?? focalFromHomography(m, imageW, imageH) ?? defaultFocal(imageW);
  const cx = imageW / 2, cy = imageH / 2;
  const kinv = (i: number) => [(m[i] - cx * m[6 + i]) / f, (m[3 + i] - cy * m[6 + i]) / f, m[6 + i]];
  let a1 = kinv(0), a2 = kinv(1), a3 = kinv(2);
  const l = (norm(a1) + norm(a2)) / 2;
  if (!(l > 0)) return null;
  // H is only known up to sign: the floor must be in front of the camera.
  if (a3[2] < 0) (a1 = scale(a1, -1)), (a2 = scale(a2, -1)), (a3 = scale(a3, -1));
  const r1 = scale(a1, 1 / norm(a1));
  let r2 = sub(a2, scale(r1, dot(a2, r1)));
  r2 = scale(r2, 1 / norm(r2));
  const r3 = cross(r1, r2);
  const t = scale(a3, 1 / l);
  // Camera centre Z = −up·(r3·t) must be positive (above the floor).
  const up: 1 | -1 = -dot(r3, t) > 0 ? 1 : -1;
  return { f, cx, cy, r1, r2, r3, t, up };
}

/** Camera coordinates of a plan point (X, Y) at height Z (same units as the plan; Z up). */
function toCamera(cam: Camera, X: number, Y: number, Z: number): number[] {
  return [0, 1, 2].map((i) => X * cam.r1[i] + Y * cam.r2[i] + Z * cam.up * cam.r3[i] + cam.t[i]);
}

/** Photo pixel of a 3D point, or null if it is behind the camera. */
export function project3(cam: Camera, X: number, Y: number, Z = 0): Pt | null {
  const p = toCamera(cam, X, Y, Z);
  if (p[2] <= 1e-6) return null;
  return [cam.f * (p[0] / p[2]) + cam.cx, cam.f * (p[1] / p[2]) + cam.cy];
}

/** Distance from the camera along its viewing direction (for drawing near things last). */
export const depthOf = (cam: Camera, X: number, Y: number, Z = 0) => toCamera(cam, X, Y, Z)[2];

/** Where the photographer stood on the plan, and the height of the lens (plan units). */
export function cameraOnPlan(cam: Camera): { x: number; y: number; height: number; dir: Pt } {
  // C = −Rᵀt with R = [r1 r2 up·r3], see toCamera.
  const c = [-dot(cam.r1, cam.t), -dot(cam.r2, cam.t), -cam.up * dot(cam.r3, cam.t)];
  // Viewing direction (camera z axis) in plan coordinates: third row of R, i.e. component i of each r.
  const dir: Pt = [cam.r1[2], cam.r2[2]];
  const len = Math.hypot(dir[0], dir[1]) || 1;
  return { x: c[0], y: c[1], height: c[2], dir: [dir[0] / len, dir[1] / len] };
}
