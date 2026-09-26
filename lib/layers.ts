import { project } from "./geometry";
import { anchoredCorners, imageToPlane, localScale, PLANE } from "./plane";
import type { Layer, Product, ProductLayer, Pt, Quad, SurfaceFill, SurfaceLayer } from "./types";

/** Categories that are laid on a floor or wall instead of placed as an object. */
export const SURFACE_CATEGORIES = new Set(["vloeren", "behang", "tegels", "verf"]);

export const cutoutKey = (l: ProductLayer) =>
  l.cutout === "ai" ? `${l.productId}:ai` : `${l.productId}:simple:${l.tolerance}`;

export function fillFor(product: Product): SurfaceFill {
  // Paint without a known colour starts neutral; the colour can be picked on the product card.
  return product.category === "verf"
    ? { type: "color", color: product.color ?? "#d8cfc4" }
    : { type: "texture", productId: product.id };
}

export function surfaceDefaults(fill: SurfaceFill): Pick<SurfaceLayer, "blend" | "opacity"> {
  return fill.type === "color" ? { blend: "multiply", opacity: 0.75 } : { blend: "normal", opacity: 0.95 };
}

// ---------------------------------------------------------------------------
// Floors and products standing on them


/** The perspective plane of a surface: explicit (AI-detected) or its 4 drawn corners. */
export const planeOf = (l: SurfaceLayer): Quad | null => l.plane ?? (l.points.length === 4 ? (l.points as Quad) : null);

/** Surfaces that furniture can stand on. */
export const isFloor = (l: Layer): l is SurfaceLayer =>
  l.kind === "surface" && !!planeOf(l) && (l.role === "floor" || (l.role === undefined && l.fill.type !== "color"));

/** Recomputes the corners of products that stand on a floor (after the floor or the product changed). */
export function syncAnchors(layers: Layer[]): Layer[] {
  return layers.map((l) => {
    if (l.kind !== "product" || !l.floor) return l;
    const floor = layers.find((f) => f.id === l.floor!.planeId);
    const plane = floor?.kind === "surface" ? planeOf(floor) : null;
    if (!plane) return { ...l, floor: undefined };
    return { ...l, corners: anchoredCorners(plane, l.floor, l.aspect) };
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
