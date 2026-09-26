import { quadToMatrix3d } from "@/lib/geometry";
import { PLANE } from "@/lib/plane";
import type { ProductLayer, Quad } from "@/lib/types";

/**
 * Soft contact shadow. On a floor it is drawn in the floor's plane, so it lies
 * flat in perspective under the product's footprint; otherwise a flat ellipse
 * under the bottom edge. (lib/exportImage.ts draws the same shadow for downloads.)
 */
export function Shadow({ layer, plane, size }: { layer: ProductLayer; plane: Quad | null; size: { w: number; h: number } }) {
  const strength = layer.shadow ?? 0.5;
  const gradient = `radial-gradient(closest-side, rgba(0,0,0,${0.55 * strength}), rgba(0,0,0,${0.3 * strength}) 55%, transparent)`;
  // Furniture from the floor plan: its footprint, already projected onto the floor.
  if (layer.shadowQuad) {
    return (
      <div className="layer shadow" style={{ width: size.w, height: size.h }}>
        <div className="plane" style={{ width: PLANE, height: PLANE, background: gradient, transform: quadToMatrix3d(PLANE, PLANE, layer.shadowQuad) }} />
      </div>
    );
  }
  if (layer.floor && plane) {
    const { u, v, width, angle } = layer.floor;
    const depth = width * 0.45; // footprint behind the front edge
    return (
      <div className="layer shadow" style={{ width: size.w, height: size.h }}>
        <div className="plane" style={{ width: PLANE, height: PLANE, transform: quadToMatrix3d(PLANE, PLANE, plane) }}>
          <div
            style={{
              position: "absolute",
              left: u - width * 0.6,
              top: v - depth * 1.1,
              width: width * 1.2,
              height: depth * 1.3,
              background: gradient,
              transform: `rotate(${angle}deg)`,
              transformOrigin: `50% ${((depth * 1.1) / (depth * 1.3)) * 100}%`,
            }}
          />
        </div>
      </div>
    );
  }
  const [, , br, bl] = layer.corners;
  const w = Math.hypot(br[0] - bl[0], br[1] - bl[1]) * 1.15;
  const h = w * 0.14;
  const cx = (br[0] + bl[0]) / 2;
  const cy = (br[1] + bl[1]) / 2;
  const rot = (Math.atan2(br[1] - bl[1], br[0] - bl[0]) * 180) / Math.PI;
  return (
    <div
      className="layer shadow"
      style={{ left: cx - w / 2, top: cy - h * 0.6, width: w, height: h, background: gradient, transform: `rotate(${rot}deg)`, transformOrigin: "50% 60%" }}
    />
  );
}
