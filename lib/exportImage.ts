import { homography, project, rectQuad } from "./geometry";
import { loadImage } from "./images";
import { planeOf } from "./layers";
import { productFilter } from "./look";
import { extendedPlane, PLANE } from "./plane";
import type { Layer, MeasureLayer, ProductLayer, Pt, Quad, SurfaceLayer } from "./types";

/**
 * Renders the design to a JPEG, the same way the stage shows it (which uses CSS
 * 3D transforms, masks and blend modes that cannot simply be "screenshotted").
 * Perspective is drawn by splitting images into small triangles, each drawn
 * with an affine transform — the standard trick for projective mapping in 2D canvas.
 */

/** Affine transform [a, b, c, d, e, f] (canvas order) mapping triangle s onto triangle d. */
export function affineFromTriangles(s: [Pt, Pt, Pt], d: [Pt, Pt, Pt]): [number, number, number, number, number, number] | null {
  const [[sx0, sy0], [sx1, sy1], [sx2, sy2]] = s;
  const [[x0, y0], [x1, y1], [x2, y2]] = d;
  const den = sx0 * (sy2 - sy1) - sx1 * sy2 + sx2 * sy1 + (sx1 - sx2) * sy0;
  if (Math.abs(den) < 1e-12) return null;
  const a = -(sy0 * (x2 - x1) - sy1 * x2 + sy2 * x1 + (sy1 - sy2) * x0) / den;
  const b = (sy1 * y2 + sy0 * (y1 - y2) - sy2 * y1 + (sy2 - sy1) * y0) / den;
  const c = (sx0 * (x2 - x1) - sx1 * x2 + sx2 * x1 + (sx1 - sx2) * x0) / den;
  const dd = -(sx1 * y2 + sx0 * (y1 - y2) - sx2 * y1 + (sx2 - sx1) * y0) / den;
  const e = (sx0 * (sy2 * x1 - sy1 * x2) + sy0 * (sx1 * x2 - sx2 * x1) + (sx2 * sy1 - sx1 * sy2) * x0) / den;
  const f = (sx0 * (sy2 * y1 - sy1 * y2) + sy0 * (sx1 * y2 - sx2 * y1) + (sx2 * sy1 - sx1 * sy2) * y0) / den;
  return [a, b, c, dd, e, f];
}

type Source = CanvasImageSource & { width: number; height: number };

function drawTriangle(ctx: CanvasRenderingContext2D, img: Source, s: [Pt, Pt, Pt], d: [Pt, Pt, Pt]) {
  const m = affineFromTriangles(s, d);
  if (!m) return;
  // Grow the clip a little so neighbouring triangles overlap (no hairline seams).
  const cx = (d[0][0] + d[1][0] + d[2][0]) / 3;
  const cy = (d[0][1] + d[1][1] + d[2][1]) / 3;
  const grow = (p: Pt): Pt => {
    const dx = p[0] - cx, dy = p[1] - cy, len = Math.hypot(dx, dy) || 1;
    return [p[0] + (dx / len) * 0.8, p[1] + (dy / len) * 0.8];
  };
  ctx.save();
  ctx.beginPath();
  d.map(grow).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.clip();
  ctx.transform(...m);
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}

/** Draws `img` onto the quad [tl, tr, br, bl] in perspective. */
export function drawWarped(ctx: CanvasRenderingContext2D, img: Source, quad: Quad, cells = 16) {
  const h = homography(rectQuad(0, 0, img.width, img.height), quad);
  const grid: Pt[][] = [];
  for (let j = 0; j <= cells; j++) {
    grid.push([]);
    for (let i = 0; i <= cells; i++) grid[j].push(project(h, [(i / cells) * img.width, (j / cells) * img.height]));
  }
  const src = (i: number, j: number): Pt => [(i / cells) * img.width, (j / cells) * img.height];
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      drawTriangle(ctx, img, [src(i, j), src(i + 1, j), src(i + 1, j + 1)], [grid[j][i], grid[j][i + 1], grid[j + 1][i + 1]]);
      drawTriangle(ctx, img, [src(i, j), src(i + 1, j + 1), src(i, j + 1)], [grid[j][i], grid[j + 1][i + 1], grid[j + 1][i]]);
    }
  }
}

const canvasOf = (w: number, h: number) => {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
};
const free = (...cs: HTMLCanvasElement[]) => cs.forEach((c) => (c.width = c.height = 0));

function tiled(tile: HTMLImageElement, tileWidth: number, w: number, h: number, ox = 0, oy = 0): HTMLCanvasElement {
  const t = canvasOf(tileWidth, (tileWidth * tile.naturalHeight) / tile.naturalWidth);
  t.getContext("2d")!.drawImage(tile, 0, 0, t.width, t.height);
  const out = canvasOf(w, h);
  const ctx = out.getContext("2d")!;
  ctx.fillStyle = ctx.createPattern(t, "repeat")!;
  // Tiles start at (ox, oy), like CSS background-position: the plane's own origin.
  ctx.translate(ox, oy);
  ctx.fillRect(-ox, -oy, w, h);
  free(t);
  return out;
}

function pathOf(ctx: CanvasRenderingContext2D, pts: Pt[]) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
}

function shadowGradient(ctx: CanvasRenderingContext2D, strength: number, contact = false) {
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  // Same stops as components/visualizer/Shadow.tsx (soft shadow, and the darker contact core).
  g.addColorStop(0, `rgba(0,0,0,${(contact ? 0.45 : 0.55) * strength})`);
  g.addColorStop(contact ? 0.6 : 0.55, `rgba(0,0,0,${(contact ? 0.2 : 0.3) * strength})`);
  g.addColorStop(1, "rgba(0,0,0,0)");
  return g;
}

export interface DesignInput {
  width: number;
  height: number;
  /** Photo with erased furniture (same-origin or data URL). */
  background: string;
  layers: Layer[];
  /** Same-origin sources, as shown on the stage. */
  productSrc: (l: ProductLayer) => string | null;
  textureSrc: (l: SurfaceLayer) => string | null;
  eraseMasks: string[];
  /** Room light maps for textured surfaces (lib/shading.ts), drawn like on the stage. */
  shading?: (l: SurfaceLayer) => { multiply: string; screen: string } | undefined;
  /** Light direction of the photo (lib/look.ts), for the side shade on products. */
  lightSide?: number;
  /** Label for a measuring line ("3,42 m"). */
  measureText?: (l: MeasureLayer) => string;
}

export async function renderDesign(input: DesignInput): Promise<Blob> {
  const { width: W, height: H, layers } = input;
  const out = canvasOf(W, H);
  const ctx = out.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(await loadImage(input.background), 0, 0, W, H);
  const eraseImgs = await Promise.all(input.eraseMasks.map((m) => loadImage(m)));

  for (const l of layers) {
    if (l.kind === "erase" || l.kind === "measure") continue;
    if (l.kind === "surface" && l.fill.type === "none") continue;

    if (l.kind === "surface") {
      const layer = canvasOf(W, H);
      const lctx = layer.getContext("2d")!;
      const plane = planeOf(l);
      const ext = l.mask && plane ? extendedPlane(plane, l.role) : null;
      lctx.save();
      pathOf(lctx, l.mask ? (ext?.quad ?? plane ?? rectQuad(0, 0, W, H)) : l.points);
      lctx.clip();
      const tex = l.fill.type === "color" ? null : input.textureSrc(l);
      if (l.fill.type === "color" || !tex) {
        lctx.fillStyle = l.fill.type === "color" ? l.fill.color : "#999";
        lctx.fillRect(0, 0, W, H);
      } else {
        const tile = await loadImage(tex);
        if (l.perspective && plane && ext) {
          const flat = tiled(tile, l.scale, ext.w, ext.h, -ext.u0, -ext.v0);
          drawWarped(lctx, flat, ext.quad, 32);
          free(flat);
        } else if (l.perspective && plane) {
          const flat = tiled(tile, l.scale, PLANE, PLANE);
          drawWarped(lctx, flat, plane, 24);
          free(flat);
        } else {
          const flat = tiled(tile, l.scale, W, H);
          lctx.drawImage(flat, 0, 0);
          free(flat);
        }
        const maps = input.shading?.(l);
        if (maps) {
          lctx.globalCompositeOperation = "multiply";
          lctx.drawImage(await loadImage(maps.multiply), 0, 0, W, H);
          lctx.globalCompositeOperation = "screen";
          lctx.drawImage(await loadImage(maps.screen), 0, 0, W, H);
          lctx.globalCompositeOperation = "source-over";
        }
      }
      lctx.restore();
      if (l.mask) {
        // Own area plus spots where furniture was erased (same as the stage).
        const m = canvasOf(W, H);
        const mctx = m.getContext("2d")!;
        for (const img of [await loadImage(l.mask), ...eraseImgs]) mctx.drawImage(img, 0, 0, W, H);
        lctx.globalCompositeOperation = "destination-in";
        lctx.drawImage(m, 0, 0);
        free(m);
      }
      ctx.save();
      ctx.globalAlpha = l.opacity;
      ctx.globalCompositeOperation = l.blend === "multiply" ? "multiply" : "source-over";
      ctx.drawImage(layer, 0, 0);
      ctx.restore();
      free(layer);
      continue;
    }

    // Product: shadow first, then the (filtered, maybe mirrored) image in perspective.
    const strength = l.shadow ?? 0.5;
    const floor = l.floor && layers.find((f) => f.id === l.floor!.planeId);
    const floorPlane = floor?.kind === "surface" ? planeOf(floor) : null;
    if (strength > 0) {
      ctx.save();
      ctx.globalCompositeOperation = "multiply";
      if (l.shadowQuad) {
        const p = canvasOf(PLANE, PLANE);
        const pctx = p.getContext("2d")!;
        pctx.translate(PLANE / 2, PLANE / 2);
        pctx.scale(PLANE / 2, PLANE / 2);
        pctx.fillStyle = shadowGradient(pctx, strength);
        pctx.fillRect(-1, -1, 2, 2);
        const flat = canvasOf(W, H);
        drawWarped(flat.getContext("2d")!, p, l.shadowQuad, 12);
        ctx.drawImage(flat, 0, 0);
        free(p, flat);
      } else if (l.floor && floorPlane) {
        const p = canvasOf(PLANE, PLANE);
        const pctx = p.getContext("2d")!;
        const { u, v, width, angle } = l.floor;
        const depth = width * 0.45;
        pctx.translate(u, v);
        pctx.rotate((angle * Math.PI) / 180);
        pctx.save();
        pctx.translate(0, -0.45 * depth);
        pctx.scale(width * 0.6, depth * 0.65);
        pctx.fillStyle = shadowGradient(pctx, strength);
        pctx.fillRect(-1, -1, 2, 2);
        pctx.restore();
        pctx.translate(0, -0.45 * depth);
        pctx.scale(width * 0.52, depth * 0.5);
        pctx.fillStyle = shadowGradient(pctx, strength, true);
        pctx.fillRect(-1, -1, 2, 2);
        // Warp into a separate layer first: overlapping triangle edges would darken twice under multiply.
        const flat = canvasOf(W, H);
        drawWarped(flat.getContext("2d")!, p, floorPlane, 12);
        ctx.drawImage(flat, 0, 0);
        free(p, flat);
      } else {
        const [, , br, bl] = l.corners;
        const w = Math.hypot(br[0] - bl[0], br[1] - bl[1]) * 1.15;
        const h = w * 0.14;
        ctx.translate((br[0] + bl[0]) / 2, (br[1] + bl[1]) / 2);
        ctx.rotate(Math.atan2(br[1] - bl[1], br[0] - bl[0]));
        ctx.translate(0, -h * 0.1);
        ctx.save();
        ctx.scale(w / 2, h / 2);
        ctx.fillStyle = shadowGradient(ctx, strength);
        ctx.fillRect(-1, -1, 2, 2);
        ctx.restore();
        ctx.translate(0, h * 0.1 - h * 0.05);
        ctx.scale(w * 0.44, h * 0.25);
        ctx.fillStyle = shadowGradient(ctx, strength, true);
        ctx.fillRect(-1, -1, 2, 2);
      }
      ctx.restore();
    }

    const src = input.productSrc(l);
    if (!src) continue;
    const img = await loadImage(src);
    const prepared = canvasOf(Math.min(img.naturalWidth, 1200), Math.min(img.naturalWidth, 1200) * (img.naturalHeight / img.naturalWidth));
    const pctx = prepared.getContext("2d")!;
    pctx.filter = productFilter(l.light, l.warmth); // ignored by browsers without canvas filters
    if (l.flip) {
      pctx.translate(prepared.width, 0);
      pctx.scale(-1, 1);
    }
    pctx.drawImage(img, 0, 0, prepared.width, prepared.height);
    // Side light, as on the stage: a gradient over the product only (source-atop keeps its shape).
    const a = Math.abs(input.lightSide ?? 0) * (l.sideLight ?? 0.8) * 0.42;
    if (a >= 0.02) {
      pctx.setTransform(1, 0, 0, 1, 0, 0);
      pctx.filter = "none";
      pctx.globalCompositeOperation = "source-atop";
      // The stage gradient is in the (possibly mirrored) image's orientation; here we draw on the result.
      const darkRight = (input.lightSide ?? 0) < 0;
      const g = pctx.createLinearGradient(darkRight ? 0 : prepared.width, 0, darkRight ? prepared.width : 0, 0);
      g.addColorStop(0, `rgba(255,250,240,${a * 0.25})`);
      g.addColorStop(0.45, "rgba(0,0,0,0)");
      g.addColorStop(1, `rgba(0,0,0,${a})`);
      pctx.fillStyle = g;
      pctx.fillRect(0, 0, prepared.width, prepared.height);
    }
    drawWarped(ctx, prepared, l.corners, 12);
    free(prepared);
  }

  // Measuring lines on top, so a shared photo shows the sizes too.
  for (const l of layers) {
    if (l.kind !== "measure" || !input.measureText) continue;
    const [a, b] = l.points;
    const fs = W / 55;
    ctx.save();
    ctx.strokeStyle = "#e9601f";
    ctx.fillStyle = "#e9601f";
    ctx.lineWidth = Math.max(2, W / 450);
    ctx.setLineDash(l.cm ? [] : [W / 120, W / 200]);
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
    for (const p of l.points) {
      ctx.beginPath();
      ctx.arc(p[0], p[1], W / 260, 0, Math.PI * 2);
      ctx.fill();
    }
    const text = input.measureText(l);
    ctx.font = `600 ${fs}px system-ui, sans-serif`;
    const tw = ctx.measureText(text).width + fs;
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.beginPath();
    ctx.roundRect?.(mx - tw / 2, my - fs * 0.85, tw, fs * 1.6, fs * 0.4);
    ctx.fill();
    ctx.fillStyle = "#1f1d1a";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, mx, my - fs * 0.05);
    ctx.restore();
  }

  const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, "image/jpeg", 0.92));
  free(out);
  if (!blob) throw new Error("Afbeelding maken mislukt");
  return blob;
}

/** iPad/iPhone: the share sheet (save to Photos, AirDrop, WhatsApp…); elsewhere a download. */
export async function shareOrDownload(blob: Blob, filename: string): Promise<void> {
  const file = new File([blob], filename, { type: blob.type });
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: filename });
      return;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
