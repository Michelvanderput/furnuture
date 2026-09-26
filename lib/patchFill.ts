/**
 * Content-aware fill without AI (PatchMatch, Barnes et al. 2009, with the
 * multi-scale voting of Wexler et al. 2007 — the idea behind Photoshop's
 * content-aware fill). Every pixel of the hole takes its colour from the best
 * matching piece of the photo, so floor planks, skirting boards and wall
 * texture continue instead of being smeared out.
 *
 * Pure function (no DOM): runs in a worker (fill.worker.ts) and in tests.
 */

const R = 3; // patch radius: 7×7 patches

/** `labels`: optional region per pixel (e.g. 1 = floor, 2 = wall/other); holes are filled only from the same region. */
type Level = { w: number; h: number; img: Float32Array; hole: Uint8Array; labels?: Uint8Array };

function downsample(l: Level): Level {
  const w = Math.max(1, l.w >> 1), h = Math.max(1, l.h >> 1);
  const img = new Float32Array(w * h * 3);
  const hole = new Uint8Array(w * h);
  const labels = l.labels ? new Uint8Array(w * h) : undefined;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let n = 0, anyHole = 0;
      const acc = [0, 0, 0];
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const sx = Math.min(l.w - 1, 2 * x + dx), sy = Math.min(l.h - 1, 2 * y + dy);
          const i = sy * l.w + sx;
          if (l.hole[i]) anyHole = 1;
          else {
            n++;
            for (let c = 0; c < 3; c++) acc[c] += l.img[i * 3 + c];
          }
        }
      }
      const j = y * w + x;
      hole[j] = anyHole;
      if (labels) labels[j] = l.labels![Math.min(l.h - 1, 2 * y + 1) * l.w + Math.min(l.w - 1, 2 * x)];
      if (n) for (let c = 0; c < 3; c++) img[j * 3 + c] = acc[c] / n;
    }
  }
  return { w, h, img, hole, labels };
}

/** Grows a mask by r pixels (square). */
function grow(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    let last = -1e9;
    for (let x = 0; x < w; x++) if (mask[y * w + x]) last = x; else if (x - last <= r) tmp[y * w + x] = 1;
    last = 1e9;
    for (let x = w - 1; x >= 0; x--) if (mask[y * w + x]) (last = x), (tmp[y * w + x] = 1); else if (last - x <= r) tmp[y * w + x] = 1;
  }
  for (let x = 0; x < w; x++) {
    let last = -1e9;
    for (let y = 0; y < h; y++) if (tmp[y * w + x]) (last = y), (out[y * w + x] = 1); else if (y - last <= r) out[y * w + x] = 1;
    last = 1e9;
    for (let y = h - 1; y >= 0; y--) if (tmp[y * w + x]) last = y; else if (last - y <= r) out[y * w + x] = 1;
  }
  return out;
}

/** Simple smooth fill for the coarsest level: average of known neighbours, repeated. */
function diffuse(l: Level) {
  const { w, h, img, hole, labels } = l;
  const known = Uint8Array.from(hole, (v) => (v ? 0 : 1));
  for (let pass = 0; pass < w + h; pass++) {
    let changed = false;
    for (let i = 0; i < w * h; i++) {
      if (known[i]) continue;
      const x = i % w, y = (i / w) | 0;
      let n = 0;
      const acc = [0, 0, 0];
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
        if (j < 0 || known[j] !== 1 || (labels && labels[j] !== labels[i])) continue;
        n++;
        for (let c = 0; c < 3; c++) acc[c] += img[j * 3 + c];
      }
      if (n) {
        for (let c = 0; c < 3; c++) img[i * 3 + c] = acc[c] / n;
        known[i] = 2; // filled this pass; becomes a source next pass
        changed = true;
      }
    }
    for (let i = 0; i < w * h; i++) if (known[i] === 2) known[i] = 1;
    if (!changed) break;
  }
  // A region without any known pixel of its own: fill it from anything around.
  if (labels && known.some((k) => !k)) diffuse({ ...l, hole: Uint8Array.from(known, (k) => (k ? 0 : 1)), labels: undefined });
}

/** Deterministic random numbers (same photo, same result). */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

function solveLevel(l: Level, nnf: Int32Array, em: number, rand: () => number, sharp = false, coarsest = false) {
  const { w, h, img, hole, labels } = l;
  const n = w * h;
  const notSource = grow(hole, w, h, R);
  // Region of each possible source patch: its label when the whole patch is one region, else 0.
  const region = new Uint8Array(n);
  if (labels) {
    for (let y = R; y < h - R; y++) {
      for (let x = R; x < w - R; x++) {
        const q = y * w + x;
        const lab = labels[q];
        let uniform = true;
        for (let dy = -R; dy <= R && uniform; dy++) for (let dx = -R; dx <= R; dx++) if (labels[q + dy * w + dx] !== lab) (uniform = false);
        region[q] = uniform ? lab : 0;
      }
    }
  }
  let want = 0; // region the current target needs (0 = any)
  const valid = (q: number) => {
    const x = q % w, y = (q / w) | 0;
    return x >= R && y >= R && x < w - R && y < h - R && !notSource[q] && (!want || region[q] === want);
  };
  const targets: number[] = [];
  const near = grow(hole, w, h, R);
  for (let i = 0; i < n; i++) if (near[i]) targets.push(i);
  // Some source must exist; otherwise keep the smooth fill.
  const byRegion = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const x = i % w, y = (i / w) | 0;
    if (x < R || y < R || x >= w - R || y >= h - R || notSource[i]) continue;
    for (const key of labels ? [0, region[i]] : [0]) {
      if (!byRegion.has(key)) byRegion.set(key, []);
      byRegion.get(key)!.push(i);
    }
  }
  if (!byRegion.get(0)?.length || !targets.length) return;
  // A target's region; falls back to "any" when its region has no source patches at all.
  const need = (p: number) => (labels && byRegion.get(labels[p])?.length ? labels[p] : 0);
  const randomSource = (key: number) => {
    const list = byRegion.get(key)!;
    return list[(rand() * list.length) | 0];
  };
  for (const p of targets) {
    want = need(p);
    if (nnf[p] < 0 || !valid(nnf[p])) nnf[p] = randomSource(want);
  }
  // Coarsest level: start the hole from real texture (random matches) instead of a smooth
  // blend; a smooth start makes smooth patches win, and the result stays blurry.
  if (coarsest) for (const p of targets) if (hole[p]) for (let c = 0; c < 3; c++) img[p * 3 + c] = img[nnf[p] * 3 + c];

  const dist = (p: number, q: number, best: number) => {
    const px = p % w, py = (p / w) | 0, qx = q % w, qy = (q / w) | 0;
    let d = 0;
    for (let dy = -R; dy <= R; dy++) {
      const sy = Math.min(h - 1, Math.max(0, py + dy)) * w;
      const ty = (qy + dy) * w;
      for (let dx = -R; dx <= R; dx++) {
        const a = (sy + Math.min(w - 1, Math.max(0, px + dx))) * 3;
        const b = (ty + qx + dx) * 3;
        const e0 = img[a] - img[b], e1 = img[a + 1] - img[b + 1], e2 = img[a + 2] - img[b + 2];
        d += e0 * e0 + e1 * e1 + e2 * e2;
      }
      if (d >= best) return d;
    }
    return d;
  };
  const cost = new Float32Array(n).fill(Infinity);
  const inT = new Uint8Array(n);
  for (const p of targets) inT[p] = 1;

  for (let iter = 0; iter < em; iter++) {
    for (const p of targets) cost[p] = dist(p, nnf[p], Infinity);
    for (let pm = 0; pm < 2; pm++) {
      const forward = (iter * 2 + pm) % 2 === 0;
      const step = forward ? 1 : -1;
      for (let k = 0; k < targets.length; k++) {
        const p = targets[forward ? k : targets.length - 1 - k];
        want = need(p);
        const x = p % w, y = (p / w) | 0;
        // Propagation: the neighbour's match, shifted by one.
        for (const [nb, shift] of [
          [x - step >= 0 && x - step < w ? p - step : -1, step],
          [y - step >= 0 && y - step < h ? p - step * w : -1, step * w],
        ] as const) {
          if (nb < 0 || !inT[nb]) continue;
          const q = nnf[nb] + shift;
          if (q >= 0 && q < n && valid(q)) {
            const d = dist(p, q, cost[p]);
            if (d < cost[p]) (cost[p] = d), (nnf[p] = q);
          }
        }
        // Random search around the current best, in shrinking windows.
        const bx = nnf[p] % w, by = (nnf[p] / w) | 0;
        for (let radius = Math.max(w, h); radius >= 1; radius >>= 1) {
          const qx = Math.round(bx + (rand() * 2 - 1) * radius), qy = Math.round(by + (rand() * 2 - 1) * radius);
          if (qx < 0 || qy < 0 || qx >= w || qy >= h) continue;
          const q = qy * w + qx;
          if (!valid(q)) continue;
          const d = dist(p, q, cost[p]);
          if (d < cost[p]) (cost[p] = d), (nnf[p] = q);
        }
      }
    }
    // Voting: every hole pixel becomes the weighted mean of what the overlapping patches say.
    const acc = new Float32Array(n * 3), wsum = new Float32Array(n);
    let sigma = 0;
    for (const p of targets) sigma += cost[p];
    sigma = Math.max(1, sigma / targets.length);
    for (const p of targets) {
      const weight = Math.exp(-cost[p] / (2 * sigma));
      const px = p % w, py = (p / w) | 0, q = nnf[p];
      for (let dy = -R; dy <= R; dy++) {
        const ty = py + dy;
        if (ty < 0 || ty >= h) continue;
        for (let dx = -R; dx <= R; dx++) {
          const tx = px + dx;
          if (tx < 0 || tx >= w) continue;
          const t = ty * w + tx;
          if (!hole[t]) continue;
          const s = q + dy * w + dx;
          wsum[t] += weight;
          acc[t * 3] += weight * img[s * 3];
          acc[t * 3 + 1] += weight * img[s * 3 + 1];
          acc[t * 3 + 2] += weight * img[s * 3 + 2];
        }
      }
    }
    for (let t = 0; t < n; t++) {
      if (!hole[t] || wsum[t] <= 0) continue;
      img[t * 3] = acc[t * 3] / wsum[t];
      img[t * 3 + 1] = acc[t * 3 + 1] / wsum[t];
      img[t * 3 + 2] = acc[t * 3 + 2] / wsum[t];
    }
  }
  if (!sharp) return;
  // Finest level: averaging overlapping patches blurs plank edges and grain. Take
  // each pixel from its own best match instead, blended lightly with the average.
  const avg = img.slice();
  for (const p of targets) {
    if (!hole[p]) continue;
    const q = nnf[p];
    for (let c = 0; c < 3; c++) img[p * 3 + c] = 0.75 * img[q * 3 + c] + 0.25 * avg[p * 3 + c];
  }
}

/**
 * Fills the hole (mask: 1 = fill) of an RGBA image in place. `labels` (optional)
 * keeps regions apart, e.g. 1 = floor, 2 = wall; 255 = no part of the picture.
 *
 * PatchMatch works directly on the photo's real colours: a plank seam is a rare,
 * thin feature next to a lot of near-flat colour, and it is the photo's own broad
 * light gradient (a window is brighter on one side) that pulls matches towards
 * the right *position* in the room, which is what makes matches land on the same
 * plank pattern instead of any flat patch anywhere. Stripping that gradient out
 * first (to fix seams) removes exactly the signal that finds real texture, so
 * instead any residual light mismatch at the hole's edge is fixed afterwards,
 * as a smooth additive correction (`seamless`) that leaves the copied texture intact.
 */
export function patchFill(rgba: Uint8ClampedArray, mask: Uint8Array, w: number, h: number, labels?: Uint8Array, seed = 7): void {
  const n = w * h;
  const base: Level = { w, h, img: new Float32Array(n * 3), hole: mask.slice(), labels };
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) base.img[i * 3 + c] = rgba[i * 4 + c];
  const levels = [base];
  while (Math.min(levels.at(-1)!.w, levels.at(-1)!.h) > 40) levels.push(downsample(levels.at(-1)!));
  const rand = rng(seed);

  let prev: { nnf: Int32Array; w: number; h: number } | null = null;
  for (let li = levels.length - 1; li >= 0; li--) {
    const l = levels[li];
    const nnf = new Int32Array(l.w * l.h).fill(-1);
    if (!prev) diffuse(l);
    else {
      // Start from the coarser solution: its matches (doubled) and its colours.
      const c = levels[li + 1];
      for (let y = 0; y < l.h; y++) {
        for (let x = 0; x < l.w; x++) {
          const i = y * l.w + x;
          const cx = Math.min(prev.w - 1, x >> 1), cy = Math.min(prev.h - 1, y >> 1);
          const ci = cy * prev.w + cx;
          if (l.hole[i]) for (let k = 0; k < 3; k++) l.img[i * 3 + k] = c.img[ci * 3 + k];
          const q = prev.nnf[ci];
          if (q >= 0) {
            const qx = Math.min(l.w - 1, (q % prev.w) * 2 + (x & 1)), qy = Math.min(l.h - 1, ((q / prev.w) | 0) * 2 + (y & 1));
            nnf[i] = qy * l.w + qx;
          }
        }
      }
    }
    solveLevel(l, nnf, li === levels.length - 1 ? 6 : li === 0 ? 3 : 4, rand, li === 0, li === levels.length - 1);
    prev = { nnf, w: l.w, h: l.h };
  }
  seamless(base, mask, labels);
  for (let i = 0; i < n; i++) {
    if (!mask[i]) continue;
    for (let c = 0; c < 3; c++) rgba[i * 4 + c] = base.img[i * 3 + c];
  }
}

/**
 * Patches come from elsewhere in the room, often lit differently (brighter near the
 * window): the hole can show as a slightly mismatched patch. Seamless cloning,
 * simplified: measure the difference in broad light just inside and just outside the
 * hole's border (skipping pixel pairs that straddle a real edge, such as a plank seam,
 * so texture is not mistaken for a light step), spread that difference smoothly over
 * the hole on a coarse grid, and add it back. Detail (the copied texture) stays;
 * only the broad light shifts to match its surroundings.
 */
function seamless(l: Level, mask: Uint8Array, labels: Uint8Array | undefined, k = 6) {
  const { w, h, img } = l;
  const n = w * h;
  const gw = Math.ceil(w / k), gh = Math.ceil(h / k), gn = gw * gh;
  const inHole = new Uint8Array(gn), label = new Uint8Array(gn);
  const diffs = new Map<number, number[][]>();
  for (let i = 0; i < n; i++) {
    if (!mask[i]) continue;
    const x = i % w, y = (i / w) | 0;
    const g = ((y / k) | 0) * gw + ((x / k) | 0);
    inHole[g] = 1;
    if (labels) label[g] = labels[i];
    // Difference with the known pixels right across the border. Where the fill continues
    // the texture this is only the difference in light; texture itself cancels out.
    for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
      if (j < 0 || mask[j] || (labels && labels[j] !== labels[i])) continue;
      const d0 = img[j * 3] - img[i * 3], d1 = img[j * 3 + 1] - img[i * 3 + 1], d2 = img[j * 3 + 2] - img[i * 3 + 2];
      // A big jump is an edge in the texture (a plank seam right at the border), not light: skip it.
      if (Math.abs(d0 + d1 + d2) / 3 > 40) continue;
      if (!diffs.has(g)) diffs.set(g, [[], [], []]);
      const d = diffs.get(g)!;
      d[0].push(d0);
      d[1].push(d1);
      d[2].push(d2);
    }
  }
  const corr = new Float32Array(gn * 3);
  const fixed = new Uint8Array(gn);
  // Median per cell (robust to the rare seam that slips through), capped to a light
  // difference rather than a repaint.
  const median = (v: number[]) => (v.sort((a, b) => a - b), Math.max(-90, Math.min(90, v[v.length >> 1])));
  for (const [g, d] of diffs) {
    fixed[g] = 1;
    for (let c = 0; c < 3; c++) corr[g * 3 + c] = median(d[c]);
  }
  const free: number[] = [];
  for (let g = 0; g < gn; g++) if (inHole[g] && !fixed[g]) free.push(g);
  for (let it = 0; it < 400; it++) {
    for (const g of free) {
      const x = g % gw, y = (g / gw) | 0;
      let m = 0, r0 = 0, r1 = 0, r2 = 0;
      for (const j of [x > 0 ? g - 1 : -1, x < gw - 1 ? g + 1 : -1, y > 0 ? g - gw : -1, y < gh - 1 ? g + gw : -1]) {
        if (j < 0 || !inHole[j] || (labels && label[j] !== label[g])) continue;
        m++;
        r0 += corr[j * 3];
        r1 += corr[j * 3 + 1];
        r2 += corr[j * 3 + 2];
      }
      if (m) (corr[g * 3] = r0 / m), (corr[g * 3 + 1] = r1 / m), (corr[g * 3 + 2] = r2 / m);
    }
  }
  // Back to pixels (bilinear between cell centres), then add.
  for (let i = 0; i < n; i++) {
    if (!mask[i]) continue;
    const x = i % w, y = (i / w) | 0;
    const gx = Math.min(gw - 1, Math.max(0, (x + 0.5) / k - 0.5)), gy = Math.min(gh - 1, Math.max(0, (y + 0.5) / k - 0.5));
    const x0 = Math.floor(gx), y0 = Math.floor(gy), x1 = Math.min(gw - 1, x0 + 1), y1 = Math.min(gh - 1, y0 + 1);
    const fx = gx - x0, fy = gy - y0;
    const own = ((y / k) | 0) * gw + ((x / k) | 0);
    for (let c = 0; c < 3; c++) {
      let acc = 0, wsum = 0;
      for (const [g, wt] of [[y0 * gw + x0, (1 - fx) * (1 - fy)], [y0 * gw + x1, fx * (1 - fy)], [y1 * gw + x0, (1 - fx) * fy], [y1 * gw + x1, fx * fy]] as const) {
        if (!inHole[g] || (labels && label[g] !== label[own]) || wt <= 0) continue;
        acc += corr[g * 3 + c] * wt;
        wsum += wt;
      }
      img[i * 3 + c] += wsum > 0 ? acc / wsum : corr[own * 3 + c];
    }
  }
}
