import { project } from "./geometry";
import { calibrate, type FloorMetric } from "./metric";
import { anchoredCorners, imageToPlane, localScale, PLANE } from "./plane";
import { presetCm } from "./textures";
import type { Layer, MeasureLayer, Product, ProductLayer, Pt, Quad, SurfaceFill, SurfaceLayer } from "./types";

/** Categories that are laid on a floor or wall instead of placed as an object. */
export const SURFACE_CATEGORIES = new Set(["vloeren", "behang", "tegels", "verf"]);

export function fillFor(product: Product): SurfaceFill {
  // Paint without a known colour starts neutral; the colour can be picked on the product card.
  return product.category === "verf"
    ? { type: "color", color: product.color ?? "#d8cfc4" }
    : { type: "texture", productId: product.id };
}

export function surfaceDefaults(fill: SurfaceFill): Pick<SurfaceLayer, "blend" | "opacity"> {
  if (fill.type === "none") return { blend: "normal", opacity: 1 };
  return fill.type === "color" ? { blend: "multiply", opacity: 0.75 } : { blend: "normal", opacity: 0.95 };
}

// ---------------------------------------------------------------------------
// Floors and products standing on them


/** The perspective plane of a surface: explicit (AI-detected) or its 4 drawn corners. */
export const planeOf = (l: SurfaceLayer): Quad | null => l.plane ?? (l.points.length === 4 ? (l.points as Quad) : null);

/** Surfaces that furniture can stand on. */
export const isFloor = (l: Layer): l is SurfaceLayer =>
  l.kind === "surface" && !!planeOf(l) && (l.role === "floor" || (l.role === undefined && l.fill.type !== "color"));

/** The ruler of a floor: its first measuring line with a known length. */
export const rulerOf = (layers: Layer[], floorId: string): MeasureLayer | undefined =>
  layers.find((l): l is MeasureLayer => l.kind === "measure" && l.floorId === floorId && !!l.cm);

/** Real-world scale of a floor, if it has been measured. */
export function floorMetric(layers: Layer[], floorId: string): FloorMetric | null {
  const floor = layers.find((l) => l.id === floorId);
  const plane = floor?.kind === "surface" ? planeOf(floor) : null;
  const ruler = rulerOf(layers, floorId);
  if (!plane || !ruler || ruler.points.length < 2) return null;
  return calibrate(plane, ruler.points[0], ruler.points[1], ruler.cm!, ruler.imageW, ruler.imageH);
}

/**
 * Keeps derived geometry up to date after any change: products standing on a
 * floor follow its perspective (and its real size once measured), and floor
 * textures get their real tile size on a measured floor.
 */
export function syncAnchors(layers: Layer[]): Layer[] {
  const metrics = new Map<string, FloorMetric | null>();
  const metricOf = (id: string) => {
    if (!metrics.has(id)) metrics.set(id, floorMetric(layers, id));
    return metrics.get(id)!;
  };
  return layers.map((l) => {
    if (l.kind === "surface" && l.fill.type === "preset" && l.autoScale !== false && l.perspective) {
      const m = metricOf(l.id);
      const cm = presetCm(l.fill.preset);
      if (m && cm) {
        const scale = Math.max(5, Math.round(cm / m.sx));
        return scale === l.scale ? l : { ...l, scale };
      }
      return l;
    }
    if (l.kind !== "product" || !l.floor) return l;
    const floor = layers.find((f) => f.id === l.floor!.planeId);
    const plane = floor?.kind === "surface" ? planeOf(floor) : null;
    if (!plane) return { ...l, floor: undefined };
    return { ...l, corners: anchoredCorners(plane, l.floor, l.aspect, metricOf(floor!.id)) };
  });
}

/** Puts a product on a floor, keeping its current position and size as well as possible. */
export function placeOnFloor(product: ProductLayer, floor: SurfaceLayer, at?: Pt): ProductLayer {
  const plane = planeOf(floor)!;
  const c = product.corners;
  const bottom: Pt = at ?? [(c[2][0] + c[3][0]) / 2, (c[2][1] + c[3][1]) / 2];
  const q = project(imageToPlane(plane), bottom);
  const u = Math.min(PLANE * 0.95, Math.max(PLANE * 0.05, q[0]));
  const v = Math.min(PLANE * 0.98, Math.max(PLANE * 0.05, q[1]));
  const widthPx = Math.hypot(c[2][0] - c[3][0], c[2][1] - c[3][1]);
  const floorAnchor = { planeId: floor.id, u, v, width: widthPx / localScale(plane, [u, v]), angle: 0 };
  return { ...product, distort: false, floor: floorAnchor, corners: anchoredCorners(plane, floorAnchor, product.aspect) };
}
