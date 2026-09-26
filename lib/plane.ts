import { homography, project } from "./geometry";
import type { FloorAnchor, Pt, Quad } from "./types";

/** Floors and walls are modelled as a PLANE×PLANE square seen in perspective. */
export const PLANE = 1000;
const SQUARE: Quad = [[0, 0], [PLANE, 0], [PLANE, PLANE], [0, PLANE]];

export const planeToImage = (plane: Quad) => homography(SQUARE, plane);
export const imageToPlane = (plane: Quad) => homography(plane, SQUARE);

/** Image pixels per plane unit (horizontally) at plane point q: things further away get smaller. */
export function localScale(plane: Quad, q: Pt): number {
  const h = planeToImage(plane);
  const a = project(h, [q[0] - 5, q[1]]);
  const b = project(h, [q[0] + 5, q[1]]);
  return Math.hypot(b[0] - a[0], b[1] - a[1]) / 10;
}

/**
 * Corners of a product standing on a floor: the bottom edge follows the floor's
 * perspective, the sides stay vertical (as in real photos), and the height
 * shrinks with distance just like the width does.
 */
export function anchoredCorners(plane: Quad, a: FloorAnchor, aspect: number): Quad {
  const h = planeToImage(plane);
  const rad = (a.angle * Math.PI) / 180;
  const dx = (Math.cos(rad) * a.width) / 2;
  const dy = (Math.sin(rad) * a.width) / 2;
  const bl = project(h, [a.u - dx, a.v - dy]);
  const br = project(h, [a.u + dx, a.v + dy]);
  const height = localScale(plane, [a.u, a.v]) * a.width * aspect;
  return [[bl[0], bl[1] - height], [br[0], br[1] - height], br, bl];
}

// ---------------------------------------------------------------------------
// Fitting a perspective plane to a segmentation mask

type Line = { a: number; b: number }; // value = a + b * t

/** Least squares, then refit without the worst 30% (furniture in front of a wall edge etc.). */
export function robustLine(ts: number[], vs: number[]): Line | null {
  const fit = (idx: number[]): Line | null => {
    const n = idx.length;
    if (n < 2) return null;
    let st = 0, sv = 0, stt = 0, stv = 0;
    for (const i of idx) {
      st += ts[i];
      sv += vs[i];
      stt += ts[i] * ts[i];
      stv += ts[i] * vs[i];
    }
    const den = n * stt - st * st;
    if (Math.abs(den) < 1e-9) return { a: sv / n, b: 0 };
    const b = (n * stv - st * sv) / den;
    return { a: (sv - b * st) / n, b };
  };
  const all = ts.map((_, i) => i);
  const first = fit(all);
  if (!first) return null;
  const kept = all
    .map((i) => [i, Math.abs(vs[i] - (first.a + first.b * ts[i]))] as const)
    .sort((x, y) => x[1] - y[1])
    .slice(0, Math.max(2, Math.ceil(all.length * 0.7)))
    .map(([i]) => i);
  return fit(kept);
}

const at = (l: Line, t: number) => l.a + l.b * t;

/**
 * Perspective quad for a floor mask: side lines from the left/right edge of the
 * floor, the far edge from its top boundary, and the near edge at the bottom of the photo.
 */
export function fitFloorQuad(mask: Uint8Array, w: number, h: number, occluder?: Uint8Array): Quad | null {
  // Edges next to furniture are not real floor edges: leave them out of the fit.
  const hidden = (x: number, y: number) => !!occluder && x >= 0 && x < w && y >= 0 && y < h && !!occluder[y * w + x];
  const rows: number[] = [], left: number[] = [], right: number[] = [];
  for (let y = 0; y < h; y++) {
    let x0 = -1, x1 = -1;
    for (let x = 0; x < w; x++) if (mask[y * w + x]) (x0 < 0 && (x0 = x), (x1 = x));
    if (x0 >= 0) rows.push(y), left.push(hidden(x0 - 1, y) ? -1 : x0), right.push(hidden(x1 + 1, y) ? w : x1);
  }
  if (rows.length < 10) return null;
  const yTop = rows[Math.floor(rows.length * 0.03)];
  const ti = rows.indexOf(yTop);
  const topL = Math.max(0, left[ti]);
  const topR = Math.min(w - 1, right[ti]);
  const inner = (xs: number[], edge: (x: number) => boolean) => {
    const t: number[] = [], v: number[] = [];
    xs.forEach((x, i) => edge(x) && rows[i] >= yTop && (t.push(rows[i]), v.push(x)));
    return t.length >= 10 ? robustLine(t, v) : null;
  };
  let l = inner(left, (x) => x > 2);
  let r = inner(right, (x) => x < w - 3);
  // A side running out of the photo: mirror the other side (rooms are roughly symmetric),
  // through the floor's top corner. Neither side visible: assume a moderate perspective.
  if (l && !r) r = { a: topR + l.b * yTop, b: -l.b };
  if (r && !l) l = { a: topL + r.b * yTop, b: -r.b };
  if (!l || !r) {
    l = { a: topL + 0.6 * yTop, b: -0.6 };
    r = { a: topR - 0.6 * yTop, b: 0.6 };
  }

  // Far edge: the floor's top boundary per column (may be tilted when the camera is turned).
  const cols: number[] = [], tops: number[] = [];
  for (let x = Math.max(0, Math.round(at(l, yTop))); x <= Math.min(w - 1, Math.round(at(r, yTop))); x += 2) {
    for (let y = 0; y < h; y++) {
      if (!mask[y * w + x]) continue;
      if (!hidden(x, y - 1) && !hidden(x, y - 2)) cols.push(x), tops.push(y);
      break;
    }
  }
  const far = (cols.length >= 10 && robustLine(cols, tops)) || { a: yTop, b: 0 };
  // Intersect far edge (y = far.a + far.b x) with the side lines (x = a + b y).
  const cross = (side: Line): Pt => {
    const y = (far.a + far.b * side.a) / (1 - far.b * side.b);
    return [at(side, y), y];
  };
  const tl = cross(l);
  const tr = cross(r);
  const quad: Quad = [tl, tr, [at(r, h), h], [at(l, h), h]];
  return quad.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)) && tr[0] > tl[0] ? quad : null;
}

/** Perspective quad for a wall mask: vertical sides, top and bottom lines fitted to the mask. */
export function fitWallQuad(mask: Uint8Array, w: number, h: number, occluder?: Uint8Array): Quad | null {
  const hidden = (x: number, y: number) => !!occluder && y >= 0 && y < h && !!occluder[y * w + x];
  const cols: number[] = [];
  const tc: number[] = [], tops: number[] = [], bc: number[] = [], bottoms: number[] = [];
  for (let x = 0; x < w; x++) {
    let y0 = -1, y1 = -1;
    for (let y = 0; y < h; y++) if (mask[y * w + x]) (y0 < 0 && (y0 = y), (y1 = y));
    if (y0 < 0) continue;
    cols.push(x);
    // A sofa in front of the wall hides the wall's real bottom edge; a lamp its top edge.
    if (!hidden(x, y0 - 1)) tc.push(x), tops.push(y0);
    if (!hidden(x, y1 + 1)) bc.push(x), bottoms.push(y1);
  }
  if (cols.length < 10 || tc.length < 2 || bc.length < 2) return null;
  const xL = cols[0];
  const xR = cols[cols.length - 1];
  const top = robustLine(tc, tops)!;
  const bottom = robustLine(bc, bottoms)!;
  return [[xL, at(top, xL)], [xR, at(top, xR)], [xR, at(bottom, xR)], [xL, at(bottom, xL)]];
}
