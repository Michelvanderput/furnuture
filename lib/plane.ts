import { homography, project } from "./geometry";
import { dilate } from "./masks";
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
export function anchoredCorners(plane: Quad, a: FloorAnchor, aspect: number, metric?: { sx: number; rho: number } | null): Quad {
  const h = planeToImage(plane);
  const rad = (a.angle * Math.PI) / 180;
  let dx: number, dy: number, height: number;
  if (a.widthCm && metric) {
    // True size: half the real width along the (real) direction, converted to plane units.
    dx = (Math.cos(rad) * a.widthCm) / 2 / metric.sx;
    dy = (Math.sin(rad) * a.widthCm) / 2 / (metric.sx * metric.rho);
    // Image pixels per cm at this spot; the photo's aspect gives the height.
    height = (localScale(plane, [a.u, a.v]) / metric.sx) * a.widthCm * aspect;
  } else {
    dx = (Math.cos(rad) * a.width) / 2;
    dy = (Math.sin(rad) * a.width) / 2;
    height = localScale(plane, [a.u, a.v]) * a.width * aspect;
  }
  const bl = project(h, [a.u - dx, a.v - dy]);
  const br = project(h, [a.u + dx, a.v + dy]);
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

/** The line most points agree on (all pairs of a sample), refitted on its inliers. Deterministic. */
export function ransacLine(ts: number[], vs: number[], tol: number, maxSlope = Infinity): Line | null {
  const n = ts.length;
  if (n < 2) return null;
  const step = Math.max(1, Math.floor(n / 60));
  const sample = ts.map((_, i) => i).filter((i) => i % step === 0);
  let best: number[] = [];
  for (let i = 0; i < sample.length; i++) {
    for (let j = i + 1; j < sample.length; j++) {
      const a = sample[i], b = sample[j];
      if (ts[a] === ts[b]) continue;
      const slope = (vs[b] - vs[a]) / (ts[b] - ts[a]);
      if (Math.abs(slope) > maxSlope) continue;
      const icpt = vs[a] - slope * ts[a];
      const inl: number[] = [];
      for (let k = 0; k < n; k++) if (Math.abs(vs[k] - (icpt + slope * ts[k])) <= tol) inl.push(k);
      if (inl.length > best.length) best = inl;
    }
  }
  if (best.length < 2) return robustLine(ts, vs);
  return robustLine(best.map((k) => ts[k]), best.map((k) => vs[k]));
}

/**
 * Perspective quad for a floor mask, built from vanishing points so the planks
 * and tiles run the right way even when the floor's sides are hidden or out of view:
 *
 * - the far edge (floor meets the back wall) is fitted to the top of the mask;
 * - the depth direction's vanishing point V2 comes from the two side edges when
 *   both are visible; otherwise from one side edge and the horizon, or — nothing
 *   visible — from the far edge's own vanishing point and a typical focal length,
 *   assuming a level camera (horizon through the middle, as in most property photos);
 * - the quad is then spanned from V2 so that it covers the whole floor.
 */
/**
 * "Furniture is here" test for edge pixels. The masks of furniture and floor seldom
 * touch exactly (a few pixels of neither in between), so the furniture is grown a
 * little: the bottom of a sofa must never pass for the floor's far edge.
 */
function hiddenBy(occluder: Uint8Array | undefined, w: number, h: number) {
  if (!occluder) return () => false;
  const grown = dilate(occluder, w, h, Math.max(2, Math.round(Math.min(w, h) * 0.015)));
  return (x: number, y: number) => x >= 0 && x < w && y >= 0 && y < h && !!grown[y * w + x];
}

export function fitFloorQuad(mask: Uint8Array, w: number, h: number, occluder?: Uint8Array): Quad | null {
  // Edges next to furniture are not real floor edges: leave them out of the fit.
  const hidden = hiddenBy(occluder, w, h);
  const rows: number[] = [], left: number[] = [], right: number[] = [];
  for (let y = 0; y < h; y++) {
    let x0 = -1, x1 = -1;
    for (let x = 0; x < w; x++) if (mask[y * w + x]) (x0 < 0 && (x0 = x), (x1 = x));
    if (x0 >= 0) rows.push(y), left.push(hidden(x0 - 1, y) ? -1 : x0), right.push(hidden(x1 + 1, y) ? w : x1);
  }
  if (rows.length < 10) return null;
  const yTop = rows[Math.floor(rows.length * 0.03)];
  const floorH = rows[rows.length - 1] - yTop;
  const sideLine = (xs: number[], edge: (x: number) => boolean) => {
    const t: number[] = [], v: number[] = [];
    xs.forEach((x, i) => edge(x) && rows[i] >= yTop && (t.push(rows[i]), v.push(x)));
    // A real side edge runs over a good part of the floor's height.
    return t.length >= Math.max(10, floorH * 0.25) ? robustLine(t, v) : null;
  };
  const l = sideLine(left, (x) => x > 2);
  const r = sideLine(right, (x) => x < w - 3);

  // Far edge: the floor's top boundary per column (tilted when the camera is turned).
  const cols: number[] = [], tops: number[] = [];
  for (let x = 0; x < w; x += 2) {
    for (let y = 0; y < h; y++) {
      if (!mask[y * w + x]) continue;
      // Skip columns where furniture hides the edge, or where the floor reaches the top (no back wall).
      if (!hidden(x, y - 1) && !hidden(x, y - 2) && y > 0 && y < yTop + floorH * 0.4) cols.push(x), tops.push(y);
      break;
    }
  }
  // Columns left and right of the back wall show the floor's side edges instead: find the
  // straight line most top points agree on (RANSAC), then refit on those points.
  const tol = Math.max(2, h * 0.012);
  // Points on a side edge are not on the back edge.
  const onSide = (x: number, y: number) => [l, r].some((sl) => sl && Math.abs(at(sl, y) - x) <= tol * 1.5);
  const keep = cols.map((x, i) => !onSide(x, tops[i]));
  const far: Line =
    ransacLine(cols.filter((_, i) => keep[i]), tops.filter((_, i) => keep[i]), tol, 0.6) ?? { a: yTop, b: 0 };
  const farY = (x: number) => far.a + far.b * x;

  // Vanishing point of the depth direction, and the horizon.
  const cx = w / 2, cy = h / 2;
  const f = w / 2 / Math.tan((75 / 2) * (Math.PI / 180));
  const farTop = Math.min(farY(0), farY(w)); // highest point of the far edge in the photo
  let v2: Pt | null = null;
  if (l && r && Math.abs(l.b - r.b) > 1e-3) {
    const y = (r.a - l.a) / (l.b - r.b);
    if (y < farTop - 2) v2 = [at(l, y), y];
  }
  if (!v2) {
    let horizon = cy;
    if (horizon >= farTop - 2) horizon = farTop - h * 0.15; // camera looking down a lot: horizon must be above the floor
    const side = l ?? r;
    if (side) v2 = [at(side, horizon), horizon];
    else {
      // From the far edge's vanishing point V1 (on the horizon) and V1 ⟂ V2 for a camera with focal f.
      const dy = horizon - cy;
      if (Math.abs(far.b) > 1e-4) {
        const v1x = (horizon - far.a) / far.b;
        v2 = [cx - (f * f + dy * dy) / (v1x - cx), horizon];
      } else v2 = [cx, horizon];
    }
  }

  // Rays from V2 that just enclose all floor pixels; the quad spans between them.
  let minA = Infinity, maxA = -Infinity;
  rows.forEach((y, i) => {
    for (const x of [Math.max(0, left[i]), Math.min(w - 1, right[i])]) {
      const a = Math.atan2(x - v2![0], y - v2![1]); // measured from straight down
      if (a < minA) minA = a;
      if (a > maxA) maxA = a;
    }
  });
  if (!Number.isFinite(minA) || maxA - minA < 1e-3) return null;
  const onFar = (a: number): Pt => {
    // Ray: x = v2x + t sin a, y = v2y + t cos a; far edge: y = far.a + far.b x.
    const t = (far.a + far.b * v2![0] - v2![1]) / (Math.cos(a) - far.b * Math.sin(a));
    return [v2![0] + t * Math.sin(a), v2![1] + t * Math.cos(a)];
  };
  const atBottom = (a: number): Pt => {
    const t = (h - v2![1]) / Math.cos(a);
    return [v2![0] + t * Math.sin(a), h];
  };
  // Angles are measured from straight down: the smallest points left, the largest right.
  const tl = onFar(minA), tr = onFar(maxA);
  const br = atBottom(maxA), bl = atBottom(minA);
  const quad: Quad = [tl, tr, br, bl];
  const ok = quad.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)) && tr[0] > tl[0] && br[0] > bl[0] && bl[1] > tl[1];
  return ok ? quad : null;
}

/** Perspective quad for a wall mask: vertical sides, top and bottom lines fitted to the mask. */
export function fitWallQuad(mask: Uint8Array, w: number, h: number, occluder?: Uint8Array): Quad | null {
  const hidden = hiddenBy(occluder, w, h);
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

// ---------------------------------------------------------------------------
// Walls that meet in a corner

export interface WallPart {
  quad: Quad;
  /** Column range of the mask this part covers. */
  x0: number;
  x1: number;
}

const meanResidual = (ts: number[], vs: number[], l: Line) => ts.reduce((s, t, i) => s + Math.abs(vs[i] - (l.a + l.b * t)), 0) / (ts.length || 1);

/**
 * One recognised "wall" often spans two or three walls meeting in corners. Split
 * it where the floor line (and ceiling line) bends, so every wall gets its own
 * perspective. Each part has vertical sides, as walls do in a level photo.
 */
export function fitWallQuads(mask: Uint8Array, w: number, h: number, occluder?: Uint8Array): WallPart[] {
  const hidden = hiddenBy(occluder, w, h);
  const cols: number[] = [], tops: (number | null)[] = [], bottoms: (number | null)[] = [];
  for (let x = 0; x < w; x++) {
    let y0 = -1, y1 = -1;
    for (let y = 0; y < h; y++) if (mask[y * w + x]) (y0 < 0 && (y0 = y), (y1 = y));
    if (y0 < 0) continue;
    cols.push(x);
    // Edges hidden by furniture, or cut off by the photo, say nothing about the wall's lines.
    tops.push(!hidden(x, y0 - 1) && y0 > 1 ? y0 : null);
    bottoms.push(!hidden(x, y1 + 1) && y1 < h - 2 ? y1 : null);
  }
  if (cols.length < 10) return [];
  const pts = (i0: number, i1: number, vals: (number | null)[]) => {
    const t: number[] = [], v: number[] = [];
    for (let i = i0; i <= i1; i++) if (vals[i] !== null) t.push(cols[i]), v.push(vals[i]!);
    return { t, v };
  };
  const cost = (i0: number, i1: number) => {
    let total = 0, n = 0;
    for (const vals of [bottoms, tops]) {
      const { t, v } = pts(i0, i1, vals);
      if (t.length < 5) continue;
      const l = robustLine(t, v)!;
      total += meanResidual(t, v, l) * t.length;
      n += t.length;
    }
    return n ? total / n : 0;
  };
  const split = (i0: number, i1: number, depth: number): [number, number][] => {
    const whole = cost(i0, i1);
    if (depth >= 2 || whole < 1.5 || i1 - i0 < 30) return [[i0, i1]];
    let best: { k: number; c: number } | null = null;
    const span = i1 - i0;
    for (let k = i0 + Math.floor(span * 0.15); k <= i1 - Math.floor(span * 0.15); k += 3) {
      const c = (cost(i0, k) * (k - i0) + cost(k, i1) * (i1 - k)) / span;
      if (!best || c < best.c) best = { k, c };
    }
    if (!best || best.c > whole * 0.45) return [[i0, i1]];
    return [...split(i0, best.k, depth + 1), ...split(best.k, i1, depth + 1)];
  };
  return split(0, cols.length - 1, 0).map(([i0, i1]) => {
    const xL = cols[i0], xR = cols[i1];
    const b = pts(i0, i1, bottoms), t = pts(i0, i1, tops);
    const bottom = b.t.length >= 3 ? robustLine(b.t, b.v)! : { a: h - 1, b: 0 };
    // No ceiling line visible: a level wall's top runs to the same vanishing point, at the photo's top.
    const top = t.t.length >= 3 ? robustLine(t.t, t.v)! : { a: 0, b: 0 };
    return { quad: [[xL, at(top, xL)], [xR, at(top, xR)], [xR, at(bottom, xR)], [xL, at(bottom, xL)]] as Quad, x0: xL, x1: xR };
  });
}

// ---------------------------------------------------------------------------
// Drawing textures beyond the fitted plane

/**
 * The fitted plane rarely covers every visible bit of floor or wall. The
 * texture is therefore drawn on a larger piece of the same plane (it continues
 * seamlessly), and the recognised area (mask) decides what is visible.
 * Towards the horizon the plane is hardly extended, since it runs off to infinity there.
 */
export function extendedPlane(plane: Quad, role: "floor" | "wall" | undefined): { quad: Quad; u0: number; v0: number; w: number; h: number } | null {
  const h = planeToImage(plane);
  let ext = role === "wall" ? { l: 0.6, r: 0.6, t: 0.5, b: 0.3 } : { l: 1.5, r: 1.5, t: 0.03, b: 1.5 };
  for (let tries = 0; tries < 6; tries++) {
    const u0 = -ext.l * PLANE, v0 = -ext.t * PLANE, u1 = (1 + ext.r) * PLANE, v1 = (1 + ext.b) * PLANE;
    const corners: Pt[] = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
    // Every corner must be in front of the camera (positive homogeneous w).
    // (relative to the plane's own corner, which is visible; the overall sign of H is arbitrary)
    const ok = corners.every(([u, v]) => (h[6] * u + h[7] * v + h[8]) / h[8] > 0.05);
    if (ok) return { quad: corners.map((c) => project(h, c)) as Quad, u0, v0, w: u1 - u0, h: v1 - v0 };
    ext = { l: ext.l / 2, r: ext.r / 2, t: ext.t / 2, b: ext.b / 2 };
  }
  return null;
}

/** The plane with its texture turned a quarter (planks running the other way). */
export const rotatedPlane = (q: Quad): Quad => [q[3], q[0], q[1], q[2]];
