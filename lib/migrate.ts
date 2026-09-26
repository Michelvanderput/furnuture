import { rectQuad } from "./geometry";
import type { Layer, Project } from "./types";

type Legacy = Record<string, unknown>;

/** Upgrades layers saved by older versions of the app. */
export function migrateLayer(raw: Layer | Legacy): Layer {
  const l = raw as Legacy;
  if (l.kind === "product" && !l.corners) {
    const width = Number(l.width) || 300;
    const aspect = Number(l.aspect) || 1;
    return {
      kind: "product",
      id: String(l.id),
      productId: String(l.productId),
      corners: rectQuad(Number(l.x) || 0, Number(l.y) || 0, width, width * aspect),
      aspect,
      flip: !!l.flip,
      cutout: l.cutout === false ? "off" : "simple",
      tolerance: 18,
      distort: false,
    };
  }
  if (l.kind === "product" && typeof l.cutout === "boolean") return { ...(l as unknown as Layer), cutout: l.cutout ? "simple" : "off" } as Layer;
  if (l.kind === "erase" && !l.method) return { ...(l as unknown as Layer), method: "simple" } as Layer;
  if (l.kind === "surface" && l.crop === undefined) {
    return { ...(l as unknown as Layer), perspective: (l.points as unknown[]).length === 4, crop: 1 } as Layer;
  }
  return raw as Layer;
}

export function migrateProject(p: Project): Project {
  const scenes = Object.fromEntries(
    Object.entries(p.scenes ?? {}).map(([id, s]) => [id, { ...s, layers: s.layers.map(migrateLayer) }]),
  );
  return { ...p, scenes };
}
