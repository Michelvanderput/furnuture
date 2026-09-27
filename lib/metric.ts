import { cameraFromHomography, cameraOnPlan } from "./camera";
import { homography, project } from "./geometry";
import { PLANE } from "./plane";
import type { Pt, Quad } from "./types";

/**
 * Real-world size on a floor seen in perspective (single-view metrology).
 *
 * A floor plane is a PLANE×PLANE square mapped onto a quad in the photo. That
 * square is a real rectangle of unknown size and unknown aspect ratio. With an
 * estimate of the camera's focal length we recover the aspect ratio from the
 * homography (for a camera K, K⁻¹H = λ[sx·r1, sy·r2, t] with r1, r2 unit vectors,
 * so sy/sx = |K⁻¹h2| / |K⁻¹h1|). One line of known length then fixes the scale.
 */

export interface FloorMetric {
  /** Centimetres per plane unit along u (plane x). */
  sx: number;
  /** sy / sx: centimetres per plane unit along v, relative to u. */
  rho: number;
  /** Not measured but estimated from the perspective and a usual camera height (see estimateMetric). */
  estimated?: boolean;
}

const SQUARE: Quad = [[0, 0], [PLANE, 0], [PLANE, PLANE], [0, PLANE]];

/** Intersection of line (a1,a2) with line (b1,b2); null when (nearly) parallel. */
export function intersect(a1: Pt, a2: Pt, b1: Pt, b2: Pt): Pt | null {
  const d = (a1[0] - a2[0]) * (b1[1] - b2[1]) - (a1[1] - a2[1]) * (b1[0] - b2[0]);
  const la = Math.hypot(a2[0] - a1[0], a2[1] - a1[1]);
  const lb = Math.hypot(b2[0] - b1[0], b2[1] - b1[1]);
  if (Math.abs(d) < 1e-3 * la * lb) return null;
  const t = ((a1[0] - b1[0]) * (b1[1] - b2[1]) - (a1[1] - b1[1]) * (b1[0] - b2[0])) / d;
  return [a1[0] + t * (a2[0] - a1[0]), a1[1] + t * (a2[1] - a1[1])];
}

/**
 * Focal length in pixels. From the two vanishing points of the floor's
 * perpendicular edges when both are visible; otherwise a typical real-estate
 * wide angle (≈ 75° horizontal field of view).
 */
export function estimateFocal(plane: Quad, imageW: number, imageH: number): number {
  const fallback = imageW / 2 / Math.tan((75 / 2) * (Math.PI / 180));
  const [tl, tr, br, bl] = plane;
  const vu = intersect(tl, tr, bl, br);
  const vv = intersect(tl, bl, tr, br);
  if (!vu || !vv) return fallback;
  const cx = imageW / 2, cy = imageH / 2;
  const f2 = -((vu[0] - cx) * (vv[0] - cx) + (vu[1] - cy) * (vv[1] - cy));
  if (!(f2 > 0)) return fallback;
  const f = Math.sqrt(f2);
  // Implausible (both points far away, nearly frontal): keep the fallback.
  return f > imageW * 0.35 && f < imageW * 2.5 ? f : fallback;
}

/** sy/sx of the plane square, for a camera with focal length f and the principal point in the middle. */
export function planeAspect(plane: Quad, f: number, imageW: number, imageH: number): number {
  const m = homography(SQUARE, plane);
  const cx = imageW / 2, cy = imageH / 2;
  const kinv = (x: number, y: number, z: number) => [(x - cx * z) / f, (y - cy * z) / f, z];
  const a1 = kinv(m[0], m[3], m[6]);
  const a2 = kinv(m[1], m[4], m[7]);
  return Math.hypot(...a2) / Math.hypot(...a1);
}

/** Plane-unit vector between two photo points on the floor. */
function planeDelta(plane: Quad, p: Pt, q: Pt): Pt {
  const toPlane = homography(plane, SQUARE);
  const a = project(toPlane, p);
  const b = project(toPlane, q);
  return [b[0] - a[0], b[1] - a[1]];
}

/** Scale of a floor from one line of known length (photo points a, b; `cm` long in reality). */
export function calibrate(plane: Quad, a: Pt, b: Pt, cm: number, imageW: number, imageH: number, focal?: number): FloorMetric | null {
  const rho = planeAspect(plane, focal ?? estimateFocal(plane, imageW, imageH), imageW, imageH);
  const [du, dv] = planeDelta(plane, a, b);
  const units = Math.hypot(du, rho * dv);
  if (!(units > 1e-6) || !(cm > 0) || !Number.isFinite(rho)) return null;
  return { sx: cm / units, rho };
}

/** Real distance in cm between two photo points on a measured floor. */
export function distanceCm(plane: Quad, metric: FloorMetric, a: Pt, b: Pt): number {
  const [du, dv] = planeDelta(plane, a, b);
  return metric.sx * Math.hypot(du, metric.rho * dv);
}

/** Plane-unit vector for `cm` centimetres in real direction `angle` (0° = along the floor's u axis). */
export function cmToPlane(metric: FloorMetric, cm: number, angleDeg: number): Pt {
  const r = (angleDeg * Math.PI) / 180;
  return [(cm * Math.cos(r)) / metric.sx, (cm * Math.sin(r)) / (metric.sx * metric.rho)];
}

/**
 * Footprint of a product standing on the floor, in photo pixels: front edge
 * centred on (u, v), `widthCm` wide, `depthCm` deep (away from the camera).
 */
export function footprint(plane: Quad, metric: FloorMetric, u: number, v: number, widthCm: number, depthCm: number, angleDeg: number): Quad {
  const h = homography(SQUARE, plane);
  const half = cmToPlane(metric, widthCm / 2, angleDeg);
  const back = cmToPlane(metric, depthCm, angleDeg - 90); // perpendicular, towards the far edge (v decreasing)
  const at = (du: number, dv: number) => project(h, [u + du, v + dv]);
  return [
    at(-half[0] + back[0], -half[1] + back[1]),
    at(half[0] + back[0], half[1] + back[1]),
    at(half[0], half[1]),
    at(-half[0], -half[1]),
  ];
}

export const formatCm = (cm: number) =>
  cm >= 100 ? `${(cm / 100).toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m` : `${Math.round(cm)} cm`;

/** Height at which estate agents' photos are usually taken (tripod at chest height). */
export const CAMERA_HEIGHT_CM = 150;

/**
 * The floor's scale without measuring: from the perspective, the camera's position
 * above the floor follows (in plane units); a photo taken at the usual height of
 * about 1.5 m then gives centimetres. Good to within roughly 10–20 %; a measured
 * line (calibrate) replaces it.
 */
export function estimateMetric(plane: Quad, imageW: number, imageH: number, cameraHeightCm = CAMERA_HEIGHT_CM): FloorMetric | null {
  const f = estimateFocal(plane, imageW, imageH);
  const rho = planeAspect(plane, f, imageW, imageH);
  if (!Number.isFinite(rho) || rho <= 0) return null;
  // Plane coordinates made square (v stretched by rho), so one unit is the same length both ways.
  const m = homography([[0, 0], [PLANE, 0], [PLANE, PLANE * rho], [0, PLANE * rho]], plane);
  const cam = cameraFromHomography(m, imageW, imageH, f);
  if (!cam) return null;
  const height = cameraOnPlan(cam).height;
  if (!(height > 1e-6) || !Number.isFinite(height)) return null;
  const sx = cameraHeightCm / height;
  // A floor of less than 50 cm or more than 50 m across: the fit is off, do not guess.
  return sx * PLANE > 50 && sx * PLANE < 5000 ? { sx, rho, estimated: true } : null;
}
