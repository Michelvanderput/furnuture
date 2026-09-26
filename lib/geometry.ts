import type { Pt, Quad } from "./types";

export type { Pt, Quad };

type M3 = number[]; // 3x3, row-major

const adj = (m: M3): M3 => [
  m[4] * m[8] - m[5] * m[7], m[2] * m[7] - m[1] * m[8], m[1] * m[5] - m[2] * m[4],
  m[5] * m[6] - m[3] * m[8], m[0] * m[8] - m[2] * m[6], m[2] * m[3] - m[0] * m[5],
  m[3] * m[7] - m[4] * m[6], m[1] * m[6] - m[0] * m[7], m[0] * m[4] - m[1] * m[3],
];

const mul = (a: M3, b: M3): M3 => {
  const c = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) c[3 * i + j] += a[3 * i + k] * b[3 * k + j];
  return c;
};

const mulV = (m: M3, v: number[]) => [0, 1, 2].map((i) => m[3 * i] * v[0] + m[3 * i + 1] * v[1] + m[3 * i + 2] * v[2]);

/** Maps the unit basis to the four points (projective basis). */
function basisToPoints(q: Quad): M3 {
  const m = [q[0][0], q[1][0], q[2][0], q[0][1], q[1][1], q[2][1], 1, 1, 1];
  const v = mulV(adj(m), [q[3][0], q[3][1], 1]);
  return mul(m, [v[0], 0, 0, 0, v[1], 0, 0, 0, v[2]]);
}

/** Homography that maps quad `from` onto quad `to`. */
export function homography(from: Quad, to: Quad): M3 {
  return mul(basisToPoints(to), adj(basisToPoints(from)));
}

export function project(h: M3, p: Pt): Pt {
  const [x, y, w] = mulV(h, [p[0], p[1], 1]);
  return [x / w, y / w];
}

/**
 * CSS matrix3d() that maps an element of size w×h (transform-origin 0 0)
 * onto the quad [top-left, top-right, bottom-right, bottom-left].
 */
export function quadToMatrix3d(w: number, h: number, quad: Quad): string {
  const m = homography([[0, 0], [w, 0], [w, h], [0, h]], quad);
  const n = m.map((x) => x / m[8]);
  // matrix3d is column-major; z passes through unchanged.
  const cols = [n[0], n[3], 0, n[6], n[1], n[4], 0, n[7], 0, 0, 1, 0, n[2], n[5], 0, n[8]];
  return `matrix3d(${cols.map((x) => +x.toFixed(10)).join(",")})`;
}

export const centroid = (pts: Pt[]): Pt => [
  pts.reduce((s, p) => s + p[0], 0) / pts.length,
  pts.reduce((s, p) => s + p[1], 0) / pts.length,
];

export const rectQuad = (x: number, y: number, w: number, h: number): Quad => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
];

export const mapQuad = (q: Quad, fn: (p: Pt) => Pt): Quad => q.map(fn) as Quad;

export function rotateQuad(q: Quad, degrees: number): Quad {
  const [cx, cy] = centroid(q);
  const a = (degrees * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return mapQuad(q, ([x, y]) => [cx + (x - cx) * cos - (y - cy) * sin, cy + (x - cx) * sin + (y - cy) * cos]);
}

/**
 * Fakes turning the object away from the camera: the far side gets shorter and
 * moves inward, like a sofa pushed into a corner. side = "left" turns the left edge away.
 */
export function turnQuad(q: Quad, side: "left" | "right", amount = 0.08): Quad {
  const [tl, tr, br, bl] = q.map((p) => [...p] as Pt);
  const shrinkEdge = (top: Pt, bottom: Pt, other: [Pt, Pt]) => {
    const mid: Pt = [(top[0] + bottom[0]) / 2, (top[1] + bottom[1]) / 2];
    const inward: Pt = [((other[0][0] + other[1][0]) / 2 - mid[0]) * amount * 0.5, 0];
    for (const p of [top, bottom]) {
      p[0] += inward[0];
      p[1] = mid[1] + (p[1] - mid[1]) * (1 - amount);
    }
  };
  if (side === "left") shrinkEdge(tl, bl, [tr, br]);
  else shrinkEdge(tr, br, [tl, bl]);
  return [tl, tr, br, bl];
}

export function pointInPolygon([x, y]: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
