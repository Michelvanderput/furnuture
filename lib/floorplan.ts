import { cameraFromHomography, cameraOnPlan, depthOf, project3, type Camera } from "./camera";
import { homography, project } from "./geometry";
import { components, dilate, erode, fillHoles } from "./masks";
import { estimateFocal, planeAspect } from "./metric";
import { PLANE, planeToImage } from "./plane";
import type { RoomSegmentation } from "./segment";
import type { FloorPlan, PhotoLink, PlanItem, ProductLayer, Pt, Quad } from "./types";

type M3 = number[];

// ---------------------------------------------------------------------------
// Rooms on the drawing

/**
 * The room around a tapped point: floor plans are clean line drawings, so a
 * flood fill over the light pixels stops at the walls (no AI needed).
 * Returns null when the fill leaks (a door opening to the outside) or hits a wall.
 */
export function floodRoom(img: { data: Uint8ClampedArray; width: number; height: number }, seed: Pt, maxShare = 0.45): Pt[] | null {
  const { data, width: w, height: h } = img;
  const light = (i: number) => 0.3 * data[i * 4] + 0.59 * data[i * 4 + 1] + 0.11 * data[i * 4 + 2] >= 190;
  const sx = Math.round(seed[0]), sy = Math.round(seed[1]);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h || !light(sy * w + sx)) return null;
  const seen = new Uint8Array(w * h);
  const stack = [sy * w + sx];
  seen[stack[0]] = 1;
  let area = 0;
  while (stack.length) {
    const i = stack.pop()!;
    area++;
    if (area > w * h * maxShare) return null;
    const x = i % w, y = (i / w) | 0;
    for (const n of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
      if (n >= 0 && !seen[n] && light(n)) (seen[n] = 1), stack.push(n);
    }
  }
  if (area < 50) return null;
  // Room names and furniture symbols are holes in the fill: part of the room.
  let region = fillHoles(seen, w, h);
  // Cut narrow passages (a door into the hall): open the shape, keep the part with the tap.
  const r = Math.max(2, Math.round(Math.max(w, h) * 0.02));
  const core = erode(region, w, h, r);
  const { labels, sizes } = components(core, w, h);
  let keep = labels[sy * w + sx];
  if (!keep) keep = sizes.reduce((best, size, i) => (i && size > (sizes[best] ?? 0) ? i : best), 0);
  if (keep) {
    const grown = dilate(labels.map((l) => (l === keep ? 1 : 0)) as unknown as Uint8Array, w, h, r + 1);
    const cut = region.map((v, i) => (v && grown[i] ? 1 : 0));
    if (cut.some(Boolean)) region = cut;
  }
  return simplifyPath(traceOutline(region, w, h), Math.max(1.5, Math.max(w, h) * 0.006));
}

/** Outline (pixel centres, clockwise) of the region that contains the first set pixel (Moore neighbour tracing). */
export function traceOutline(mask: Uint8Array, w: number, h: number): Pt[] {
  let start = -1;
  for (let i = 0; i < w * h; i++) if (mask[i]) ((start = i), (i = w * h));
  if (start < 0) return [];
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && !!mask[y * w + x];
  // Neighbours clockwise, starting west.
  const dirs: Pt[] = [[-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1]];
  const sx = start % w, sy = (start / w) | 0;
  const out: Pt[] = [[sx, sy]];
  let x = sx, y = sy, from = 0; // we "came from" the west (outside)
  for (let guard = 0; guard < 4 * w * h; guard++) {
    let found = false;
    for (let k = 0; k < 8; k++) {
      const d = (from + k) % 8;
      const nx = x + dirs[d][0], ny = y + dirs[d][1];
      if (inside(nx, ny)) {
        x = nx;
        y = ny;
        from = (d + 5) % 8; // back towards where we came from, one step on
        found = true;
        break;
      }
    }
    if (!found || (x === sx && y === sy)) break;
    out.push([x, y]);
  }
  return out;
}

/** Douglas–Peucker for a closed outline: keeps the corners of walls, drops the pixel steps. */
export function simplifyPath(poly: Pt[], tol: number): Pt[] {
  if (poly.length <= 4) return poly;
  const dist = (p: Pt, a: Pt, b: Pt) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    return len ? Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / len : Math.hypot(p[0] - a[0], p[1] - a[1]);
  };
  const dp = (pts: Pt[]): Pt[] => {
    let idx = 0, max = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const d = dist(pts[i], pts[0], pts[pts.length - 1]);
      if (d > max) (max = d), (idx = i);
    }
    if (max <= tol) return [pts[0], pts[pts.length - 1]];
    return [...dp(pts.slice(0, idx + 1)).slice(0, -1), ...dp(pts.slice(idx))];
  };
  // Split the loop at the point farthest from the start, simplify both halves.
  let far = 0;
  for (let i = 1; i < poly.length; i++) if (Math.hypot(poly[i][0] - poly[0][0], poly[i][1] - poly[0][1]) > Math.hypot(poly[far][0] - poly[0][0], poly[far][1] - poly[0][1])) far = i;
  const a = dp(poly.slice(0, far + 1));
  const b = dp([...poly.slice(far), poly[0]]);
  const out = [...a.slice(0, -1), ...b.slice(0, -1)];
  return out.length >= 3 ? out : poly;
}

export function convexHull(points: Pt[]): Pt[] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Pt[] = [], upper: Pt[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  for (const q of [...p].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

export const centroidOf = (poly: Pt[]): Pt => [poly.reduce((s, p) => s + p[0], 0) / poly.length, poly.reduce((s, p) => s + p[1], 0) / poly.length];

// ---------------------------------------------------------------------------
// Linking a photo to the plan

/**
 * The floor quad of a photo, placed on the plan: its far edge lies on the wall
 * the photo looks at; its depth follows from the floor's true proportions
 * (estimated from the perspective).
 */
export function linkFromWall(room: Pt[], wallIndex: number, floorQuad: Quad, imageW: number, imageH: number): Quad {
  const A = room[wallIndex], B = room[(wallIndex + 1) % room.length];
  const c = centroidOf(room);
  const len = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1;
  let n: Pt = [-(B[1] - A[1]) / len, (B[0] - A[0]) / len];
  if ((c[0] - A[0]) * n[0] + (c[1] - A[1]) * n[1] < 0) n = [-n[0], -n[1]]; // inward, into the room
  // Standing in the room facing the wall (direction −n), your right hand points along r.
  const r: Pt = [n[1], -n[0]];
  const [L, R] = A[0] * r[0] + A[1] * r[1] < B[0] * r[0] + B[1] * r[1] ? [A, B] : [B, A];
  return linkFromPoints(L, R, floorQuad, imageW, imageH);
}

/**
 * Same, from the two far floor points tapped on the plan: L is the one on the
 * left in the photo, R on the right. The room lies on the side you face.
 * `ua`, `ub`: where L and R lie along the floor's far edge (0 = its left corner,
 * 1 = its right corner), for when a corner is out of the photo (see farEdgeMarkers).
 */
export function linkFromPoints(L: Pt, R: Pt, floorQuad: Quad, imageW: number, imageH: number, ua = 0, ub = 1): Quad {
  const len = Math.hypot(R[0] - L[0], R[1] - L[1]) || 1;
  const r: Pt = [(R[0] - L[0]) / len, (R[1] - L[1]) / len];
  const n: Pt = [-r[1], r[0]]; // towards the camera, into the room
  const width = len / Math.max(0.05, ub - ua); // the whole far edge on the plan
  const L0: Pt = [L[0] - r[0] * ua * width, L[1] - r[1] * ua * width];
  const R0: Pt = [L0[0] + r[0] * width, L0[1] + r[1] * width];
  const rho = planeAspect(floorQuad, estimateFocal(floorQuad, imageW, imageH), imageW, imageH);
  const depth = width * rho;
  return [L0, R0, [R0[0] + n[0] * depth, R0[1] + n[1] * depth], [L0[0] + n[0] * depth, L0[1] + n[1] * depth]];
}

/**
 * The two points to find on the plan: the floor's far corners, or, when a corner is
 * out of the photo (often: the camera stands in the room), the last point of the far
 * edge that is still well inside the photo. `ua`/`ub` say where they are on the edge.
 */
export function farEdgeMarkers(floorQuad: Quad, imageW: number, imageH: number): { L: Pt; R: Pt; ua: number; ub: number } {
  const toImage = planeToImage(floorQuad);
  const mx = imageW * 0.05, my = imageH * 0.05;
  const at = (u: number): Pt => project(toImage, [u * PLANE, 0]);
  const inside = (u: number) => {
    const [x, y] = at(u);
    return x >= mx && x <= imageW - mx && y >= my && y <= imageH - my;
  };
  let ua = -1, ub = -1;
  for (let i = 0; i <= 200; i++) {
    const u = i / 200;
    if (!inside(u)) continue;
    if (ua < 0) ua = u;
    ub = u;
  }
  if (ua < 0 || ub - ua < 0.15) (ua = 0), (ub = 1);
  return { L: at(ua), R: at(ub), ua, ub };
}

export interface LinkedView {
  /** Plan pixels -> photo pixels (floor). */
  toImage: M3;
  /** Photo pixels (on the floor) -> plan pixels. */
  toPlan: M3;
  camera: Camera;
}

export function linkedView(link: PhotoLink, floorQuad: Quad, imageW: number, imageH: number): LinkedView | null {
  const toImage = homography(link.plan, floorQuad);
  const camera = cameraFromHomography(toImage, imageW, imageH);
  return camera ? { toImage, toPlan: homography(floorQuad, link.plan), camera } : null;
}

export const photoToPlan = (view: LinkedView, p: Pt): Pt => project(view.toPlan, p);

/** Where the photographer stood (plan pixels) and which way they looked. */
export const cameraMarker = (view: LinkedView) => cameraOnPlan(view.camera);

// ---------------------------------------------------------------------------
// Furniture on the plan, seen from a photo

/**
 * A plan item as a product layer in a linked photo: its front face (a vertical
 * rectangle w × h at the front of its footprint) projected with the photo's
 * camera, plus its footprint as the floor shadow. Null when out of view.
 */
export function itemToLayer(item: PlanItem, view: LinkedView, cmPerPx: number, aspect: number): (ProductLayer & { depth: number }) | null {
  const cam = view.camera;
  const px = (cm: number) => cm / cmPerPx;
  const w = px(item.w), d = px(item.d), h = px(item.h ?? item.w * aspect);
  const a = (item.angle * Math.PI) / 180;
  const facing: Pt = [Math.sin(a), Math.cos(a)];
  const right: Pt = [Math.cos(a), -Math.sin(a)]; // the product's right, seen from the front
  // Seen from behind? Then show the back face (a mirrored front is the best we have).
  const camPos = cameraOnPlan(cam);
  const back = (camPos.x - item.x) * facing[0] + (camPos.y - item.y) * facing[1] < 0;
  const side = back ? -1 : 1;
  const fc: Pt = [item.x + facing[0] * side * (d / 2), item.y + facing[1] * side * (d / 2)];
  const rv: Pt = [right[0] * side, right[1] * side];
  const L: Pt = [fc[0] - rv[0] * (w / 2), fc[1] - rv[1] * (w / 2)];
  const R: Pt = [fc[0] + rv[0] * (w / 2), fc[1] + rv[1] * (w / 2)];
  const tl = project3(cam, L[0], L[1], h), tr = project3(cam, R[0], R[1], h);
  const br = project3(cam, R[0], R[1], 0), bl = project3(cam, L[0], L[1], 0);
  if (!tl || !tr || !br || !bl) return null;
  // Footprint (a little larger) as the contact shadow.
  const fw = w * 0.55, fd = d * 0.55;
  const foot = [[-fw, -fd], [fw, -fd], [fw, fd], [-fw, fd]].map(([u, v]) =>
    project3(cam, item.x + right[0] * u + facing[0] * v, item.y + right[1] * u + facing[1] * v, 0),
  );
  return {
    kind: "product",
    id: `plan:${item.id}`,
    planItem: item.id,
    productId: item.productId,
    corners: [tl, tr, br, bl],
    aspect: h / w,
    flip: item.flip !== back,
    cutout: item.cutout,
    tolerance: item.tolerance,
    distort: false,
    shadow: item.shadow ?? 0.5,
    light: item.light,
    warmth: item.warmth,
    shadowQuad: foot.every(Boolean) ? (foot as Quad) : undefined,
    depth: depthOf(cam, item.x, item.y, h / 2),
  };
}

/** All plan items visible in a linked photo, far ones first (so near ones are drawn on top). */
export function planLayersFor(
  plan: FloorPlan,
  view: LinkedView,
  aspectOf: (productId: string) => number,
): ProductLayer[] {
  if (!plan.cmPerPx) return [];
  return plan.items
    .map((it) => itemToLayer(it, view, plan.cmPerPx!, aspectOf(it.productId)))
    .filter((l): l is ProductLayer & { depth: number } => !!l && l.depth > 0)
    .sort((a, b) => b.depth - a.depth);
}

// ---------------------------------------------------------------------------
// What is in the room now: recognised furniture projected onto the plan

const FLOOR_STANDING = new Set([
  "sofa", "armchair", "swivel chair", "chair", "stool", "bench", "ottoman", "bed", "table", "coffee table", "desk",
  "cabinet", "wardrobe", "chest of drawers", "bookcase", "shelf", "buffet", "kitchen island", "rug", "refrigerator", "washer",
]);

/**
 * For each piece of floor-standing furniture: where it touches the floor (the
 * lowest pixels of its outline), projected onto the plan, extended a little
 * away from the camera because the back side is hidden.
 */
export function scanFurniture(
  seg: RoomSegmentation,
  view: LinkedView,
  imageW: number,
  imageH: number,
  /** The far wall (L, R): nothing can stand behind it. */
  farWall?: [Pt, Pt],
): { label: string; polygon: Pt[] }[] {
  const wallN: Pt | null = farWall
    ? (() => {
        const [L, R] = farWall;
        const len = Math.hypot(R[0] - L[0], R[1] - L[1]) || 1;
        return [-(R[1] - L[1]) / len, (R[0] - L[0]) / len];
      })()
    : null;
  const inside = (p: Pt): Pt => {
    if (!farWall || !wallN) return p;
    const s = (p[0] - farWall[0][0]) * wallN[0] + (p[1] - farWall[0][1]) * wallN[1];
    return s >= 0 ? p : [p[0] - wallN[0] * s, p[1] - wallN[1] * s];
  };
  const out: { label: string; polygon: Pt[] }[] = [];
  const cam = cameraOnPlan(view.camera);
  for (const s of seg.segments) {
    if (s.kind !== "furniture" || !FLOOR_STANDING.has(s.className ?? "")) continue;
    const [x0, , x1, y1] = s.box;
    const contact: Pt[] = [];
    for (let x = x0; x <= x1; x += 2) {
      for (let y = y1; y >= s.box[1]; y--) {
        if (seg.ids[y * seg.w + x] !== s.id) continue;
        contact.push(photoToPlan(view, [((x + 0.5) * imageW) / seg.w, ((y + 1) * imageH) / seg.h]));
        break;
      }
    }
    if (contact.length < 3) continue;
    const c = centroidOf(contact);
    const dir: Pt = [c[0] - cam.x, c[1] - cam.y];
    const dl = Math.hypot(dir[0], dir[1]) || 1;
    const xs = contact.map((p) => p[0]), ys = contact.map((p) => p[1]);
    const extent = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    const depth = s.className === "rug" ? 0 : extent * 0.4;
    const behind = contact.map((p): Pt => inside([p[0] + (dir[0] / dl) * depth, p[1] + (dir[1] / dl) * depth]));
    out.push({ label: s.label, polygon: convexHull([...contact.map(inside), ...behind]) });
  }
  return out;
}
