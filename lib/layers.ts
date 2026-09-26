import type { Product, ProductLayer, SurfaceFill, SurfaceLayer } from "./types";

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
