"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { removeBackgroundAI } from "@/lib/ai";
import { categoryLabel, roomLabel } from "@/lib/categories";
import { centroid, pointInPolygon, project as projectPoint, quadToMatrix3d, rectQuad } from "@/lib/geometry";
import { cropCenter, loadImage, NoPlainBackground, proxied, removeBackground } from "@/lib/images";
import { renderErased } from "@/lib/inpaint";
import {
  cutoutKey,
  fillFor,
  isFloor,
  placeOnFloor,
  planeOf,
  SURFACE_CATEGORIES,
  surfaceDefaults,
  syncAnchors,
} from "@/lib/layers";
import { ensureMask, maskToDataUrl, polygonMask, readyMask, rememberMask } from "@/lib/masks";
import { fitFloorQuad, fitWallQuad, imageToPlane, PLANE, planeToImage } from "@/lib/plane";
import { furnitureMask, segmentMask, segmentRoom, type RoomSegmentation, type Segment } from "@/lib/segment";
import { FLOOR_PRESETS, presetTexture } from "@/lib/textures";
import type {
  EraseLayer,
  FloorAnchor,
  Layer,
  Product,
  ProductLayer,
  Project,
  Pt,
  Quad,
  Scene,
  SurfaceFill,
  SurfaceLayer,
} from "@/lib/types";
import { newId } from "@/lib/useProject";
import { LayerControls } from "./LayerControls";

interface Props {
  project: Project;
  update: (fn: (p: Project) => Project) => void;
  photoId: string | null;
  setPhotoId: (id: string) => void;
}

/** Rendered size of a product image before it is mapped onto its corners. */
const PRODUCT_W = 1000;

type Drawing = { kind: "surface" | "erase"; points: Pt[]; fill?: SurfaceFill };
type Drag =
  | { type: "move"; id: string; from: Pt; start: Quad }
  | { type: "corner"; id: string; from: Pt; start: Quad; index: number; distort: boolean }
  | { type: "anchor-move"; id: string; q0: Pt; start: FloorAnchor; toPlane: number[] }
  | { type: "anchor-scale"; id: string; from: Pt; center: Pt; start: FloorAnchor }
  | { type: "vertex"; id: string; index: number }
  | { type: "plane"; id: string; index: number };

// Room recognition results live in memory only (a few seconds to recompute).
const segmentations = new Map<string, RoomSegmentation>();
// Mask PNGs for drawn erase areas, so floors and walls can also cover them.
const polygonMaskUrls = new Map<string, string>();

export function Visualizer({ project, update, photoId, setPhotoId }: Props) {
  const photos = (project.listing?.photos ?? []).filter((p) => p.room !== "plattegrond" && p.room !== "buitenkant");
  const photo = photos.find((p) => p.id === photoId) ?? photos[0];
  const scene: Scene = (photo && project.scenes[photo.id]) || { photoId: photo?.id ?? "", layers: [] };
  const products = project.products.filter((p) => p.status !== "afgewezen" && (p.image || p.color));

  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [displayWidth, setDisplayWidth] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [drawing, setDrawing] = useState<Drawing | null>(null);
  const [showLayers, setShowLayers] = useState(true);
  const [cutouts, setCutouts] = useState<Record<string, string>>({});
  const [textures, setTextures] = useState<Record<string, string>>({});
  const [erased, setErased] = useState<{ key: string; url: string } | null>(null);
  const [status, setStatus] = useState("");
  const [notice, setNotice] = useState("");
  const [segmentation, setSegmentation] = useState<RoomSegmentation | null>(null);
  const [picked, setPicked] = useState<Segment | null>(null);
  const drag = useRef<Drag | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSize(null);
    setSelected(null);
    setDrawing(null);
    setErased(null);
    setPicked(null);
    setNotice("");
    setSegmentation(photo ? (segmentations.get(photo.id) ?? null) : null);
    if (!photo) return;
    loadImage(proxied(photo.url))
      .then((img) => setSize({ w: img.naturalWidth, h: img.naturalHeight }))
      .catch(() => setSize({ w: 1440, h: 960 }));
  }, [photo?.id, photo?.url]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setDisplayWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [size]);

  // Decode stored masks so clicks can hit them.
  useEffect(() => {
    if (!size) return;
    for (const l of scene.layers) if (l.kind !== "product" && l.mask) ensureMask(l.mask, size.w, size.h).catch(() => undefined);
  }, [scene.layers, size]);

  // Background-free product images (simple colour flood fill, or AI).
  useEffect(() => {
    for (const layer of scene.layers) {
      if (layer.kind !== "product" || layer.cutout === "off") continue;
      const key = cutoutKey(layer);
      if (cutouts[key]) continue;
      const product = project.products.find((p) => p.id === layer.productId);
      if (!product?.image) continue;
      setCutouts((c) => ({ ...c, [key]: "pending" }));
      const job =
        layer.cutout === "ai"
          ? removeBackgroundAI(product.image, setStatus).finally(() => setStatus(""))
          : removeBackground(product.image, layer.tolerance);
      job
        .then((png) => setCutouts((c) => ({ ...c, [key]: png })))
        .catch((e) => setCutouts((c) => ({ ...c, [key]: e instanceof NoPlainBackground ? "failed:plain" : "failed" })));
    }
  }, [scene.layers, project.products, cutouts]);

  // Product photos used as texture, cropped to their centre.
  useEffect(() => {
    for (const layer of scene.layers) {
      if (layer.kind !== "surface" || layer.fill.type !== "texture") continue;
      const productId = layer.fill.productId;
      const product = project.products.find((p) => p.id === productId);
      const key = `${productId}:${layer.crop}`;
      if (!product?.image || textures[key]) continue;
      setTextures((t) => ({ ...t, [key]: "pending" }));
      cropCenter(product.image, layer.crop)
        .then((url) => setTextures((t) => ({ ...t, [key]: url })))
        .catch(() => setTextures((t) => ({ ...t, [key]: proxied(product.image) })));
    }
  }, [scene.layers, project.products, textures]);

  // The photo with existing furniture painted out.
  const eraseLayers = scene.layers.filter((l): l is EraseLayer => l.kind === "erase" && (!!l.mask || l.points.length >= 3));
  const eraseKey = eraseLayers.length
    ? JSON.stringify(eraseLayers.map((l) => [l.method, l.mask ?? l.points.map((p) => p.map(Math.round))]))
    : "";
  useEffect(() => {
    if (!photo || !eraseKey) return;
    let cancelled = false;
    setStatus("Gummen…");
    // Let the status paint before the fill blocks the page briefly.
    const t = setTimeout(() => {
      renderErased(photo.url, eraseLayers, (m) => !cancelled && setStatus(m || "Gummen…"))
        .then(({ url, aiFailed }) => {
          if (cancelled) return;
          setErased({ key: eraseKey, url });
          if (aiFailed) setNotice("De AI-gum kon niet starten (download of geheugen); er is snel gegumd.");
        })
        .catch(() => undefined)
        .finally(() => !cancelled && setStatus(""));
    }, 30);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [photo?.url, eraseKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const setLayers = (fn: (layers: Layer[]) => Layer[]) => {
    if (!photo) return;
    update((p) => {
      const current = p.scenes[photo.id]?.layers ?? [];
      return { ...p, scenes: { ...p.scenes, [photo.id]: { photoId: photo.id, layers: syncAnchors(fn(current)) } } };
    });
  };
  const patchLayer = (id: string, patch: Partial<ProductLayer> | Partial<SurfaceLayer> | Partial<EraseLayer>) =>
    setLayers((ls) => ls.map((l) => (l.id === id ? ({ ...l, ...patch } as Layer) : l)));

  const toPhoto = (e: { clientX: number; clientY: number }): Pt => {
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(svgRef.current!.getScreenCTM()!.inverse());
    return [pt.x, pt.y];
  };

  const floors = scene.layers.filter(isFloor);
  const productById = useMemo(() => new Map(project.products.map((p) => [p.id, p])), [project.products]);

  async function detect() {
    if (!photo) return;
    setNotice("");
    try {
      const seg = await segmentRoom(photo.url, setStatus);
      segmentations.set(photo.id, seg);
      setSegmentation(seg);
      if (!seg.segments.length) setNotice("Geen meubels, muren of vloer herkend op deze foto.");
    } catch (e) {
      setStatus("");
      setNotice(`Herkennen mislukt: ${e instanceof Error ? e.message : e}`);
    }
  }

  function segmentLayerMask(seg: Segment): string | null {
    if (!segmentation || !size) return null;
    const mask = segmentMask(segmentation, seg.id);
    const url = maskToDataUrl(mask, segmentation.w, segmentation.h);
    if (segmentation.w === size.w && segmentation.h === size.h) rememberMask(url, size.w, size.h, mask);
    return url;
  }

  function eraseSegment(seg: Segment, method: "ai" | "simple") {
    const mask = segmentLayerMask(seg);
    if (!mask) return;
    setLayers((ls) => [{ kind: "erase", id: newId(), points: [], mask, method, label: seg.label }, ...ls]);
    setPicked(null);
  }

  /** Floor or wall from the recognition, with a fitted perspective plane. */
  function surfaceFromSegment(seg: Segment, fill: SurfaceFill): string | null {
    if (!segmentation) return null;
    const mask = segmentMask(segmentation, seg.id);
    const url = segmentLayerMask(seg);
    if (!url) return null;
    const floor = seg.kind === "floor";
    const occluder = furnitureMask(segmentation);
    const plane = floor
      ? fitFloorQuad(mask, segmentation.w, segmentation.h, occluder)
      : fitWallQuad(mask, segmentation.w, segmentation.h, occluder);
    const id = newId();
    const layer: SurfaceLayer = {
      kind: "surface",
      id,
      points: [],
      mask: url,
      plane: plane ?? undefined,
      role: floor ? "floor" : "wall",
      fill,
      ...surfaceDefaults(fill),
      scale: 350,
      perspective: !!plane && fill.type !== "color",
      crop: 1,
    };
    insertSurface(layer);
    setPicked(null);
    setSelected(id);
    return id;
  }

  function insertSurface(layer: SurfaceLayer) {
    // Surfaces go below products so furniture stands "on" the new floor.
    setLayers((ls) => {
      const firstProduct = ls.findIndex((l) => l.kind === "product");
      const at = firstProduct === -1 ? ls.length : firstProduct;
      return [...ls.slice(0, at), layer, ...ls.slice(at)];
    });
  }

  async function addProduct(product: Product) {
    if (!size || !product.image) return;
    let aspect = 1;
    try {
      const img = await loadImage(proxied(product.image));
      aspect = img.naturalHeight / img.naturalWidth;
    } catch {
      /* keep square */
    }
    const width = size.w * 0.3;
    const height = width * aspect;
    let layer: ProductLayer = {
      kind: "product",
      id: newId(),
      productId: product.id,
      corners: rectQuad(size.w / 2 - width / 2, size.h * 0.6 - height / 2, width, height),
      aspect,
      flip: false,
      cutout: "simple",
      tolerance: 18,
      distort: false,
    };
    // With a floor in the room, stand on it: perspective and depth come for free.
    const floor = floors.at(-1);
    if (floor) layer = placeOnFloor(layer, floor, projectPoint(planeToImage(planeOf(floor)!), [PLANE / 2, PLANE * 0.65]));
    setLayers((ls) => [...ls, layer]);
    setSelected(layer.id);
  }

  /** Floors, paint and presets: fill the selected area or recognised floor/wall, or start drawing one. */
  function applyFill(fill: SurfaceFill) {
    const current = scene.layers.find((l) => l.id === selected);
    if (current?.kind === "surface") {
      patchLayer(current.id, { fill, ...surfaceDefaults(fill), perspective: !!planeOf(current) && fill.type !== "color" });
    } else if (picked && picked.kind !== "furniture") {
      surfaceFromSegment(picked, fill);
    } else {
      setSelected(null);
      setDrawing({ kind: "surface", points: [], fill });
    }
  }

  function finishDrawing() {
    if (!drawing || drawing.points.length < 3) return;
    const id = newId();
    if (drawing.kind === "erase") {
      setLayers((ls) => [{ kind: "erase", id, points: drawing.points, method: "ai" }, ...ls]);
    } else {
      const fill = drawing.fill ?? { type: "color", color: products.find((p) => p.color)?.color ?? "#9fb3a3" };
      const four = drawing.points.length === 4;
      insertSurface({
        kind: "surface",
        id,
        points: drawing.points,
        fill,
        ...surfaceDefaults(fill),
        scale: four ? 350 : Math.round((size?.w ?? 1000) / 4),
        perspective: four,
        crop: 1,
        role: fill.type === "color" ? "wall" : drawing.fill ? "floor" : undefined,
      });
    }
    setDrawing(null);
    setSelected(id);
  }

  /** Topmost layer under a point. */
  function hitLayer(p: Pt): Layer | undefined {
    if (!size) return undefined;
    const idx = Math.round(p[1]) * size.w + Math.round(p[0]);
    for (const l of [...scene.layers].reverse()) {
      if (l.kind === "product" && pointInPolygon(p, l.corners)) return l;
      if (l.kind !== "product") {
        if (l.mask) {
          if (readyMask(l.mask, size.w, size.h)?.[idx]) return l;
        } else if (l.points.length >= 3 && pointInPolygon(p, l.points)) return l;
      }
    }
    return undefined;
  }

  function onPointerDown(e: React.PointerEvent) {
    const p = toPhoto(e);
    if (drawing) {
      if (e.target === e.currentTarget) setDrawing({ ...drawing, points: [...drawing.points, p] });
      return;
    }
    if (e.target !== e.currentTarget) return; // handles
    const hit = hitLayer(p);
    if (hit) {
      setSelected(hit.id);
      setPicked(null);
      if (hit.kind === "product") {
        const floor = hit.floor && scene.layers.find((l) => l.id === hit.floor!.planeId);
        if (hit.floor && floor?.kind === "surface" && planeOf(floor)) {
          const toPlane = imageToPlane(planeOf(floor)!);
          drag.current = { type: "anchor-move", id: hit.id, q0: projectPoint(toPlane, p), start: hit.floor, toPlane };
        } else {
          drag.current = { type: "move", id: hit.id, from: p, start: hit.corners };
        }
      }
      return;
    }
    setSelected(null);
    if (segmentation && showLayers) {
      const sx = Math.min(segmentation.w - 1, Math.max(0, Math.round((p[0] * segmentation.w) / (size?.w ?? 1))));
      const sy = Math.min(segmentation.h - 1, Math.max(0, Math.round((p[1] * segmentation.h) / (size?.h ?? 1))));
      const id = segmentation.ids[sy * segmentation.w + sx];
      setPicked(segmentation.segments.find((s) => s.id === id) ?? null);
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = toPhoto(e);
    if (d.type === "move") {
      const dx = p[0] - d.from[0];
      const dy = p[1] - d.from[1];
      patchLayer(d.id, { corners: d.start.map(([x, y]) => [x + dx, y + dy]) as Quad });
    } else if (d.type === "anchor-move") {
      const q = projectPoint(d.toPlane, p);
      const clamp = (v: number) => Math.min(PLANE * 1.2, Math.max(-PLANE * 0.2, v));
      patchLayer(d.id, { floor: { ...d.start, u: clamp(d.start.u + q[0] - d.q0[0]), v: clamp(d.start.v + q[1] - d.q0[1]) } });
    } else if (d.type === "anchor-scale") {
      const f = Math.hypot(p[0] - d.center[0], p[1] - d.center[1]) / Math.max(1, Math.hypot(d.from[0] - d.center[0], d.from[1] - d.center[1]));
      patchLayer(d.id, { floor: { ...d.start, width: Math.max(10, d.start.width * f) } });
    } else if (d.type === "corner") {
      if (d.distort) {
        patchLayer(d.id, { corners: d.start.map((c, i) => (i === d.index ? p : c)) as Quad });
      } else {
        // Uniform scale around the centre.
        const c = centroid(d.start);
        const f = Math.hypot(p[0] - c[0], p[1] - c[1]) / Math.max(1, Math.hypot(d.from[0] - c[0], d.from[1] - c[1]));
        patchLayer(d.id, { corners: d.start.map(([x, y]) => [c[0] + (x - c[0]) * f, c[1] + (y - c[1]) * f]) as Quad });
      }
    } else if (d.type === "plane") {
      setLayers((ls) =>
        ls.map((l) =>
          l.id === d.id && l.kind === "surface" && l.plane
            ? { ...l, plane: l.plane.map((q, i) => (i === d.index ? p : q)) as Quad }
            : l,
        ),
      );
    } else {
      setLayers((ls) =>
        ls.map((l) =>
          l.id === d.id && l.kind !== "product" ? { ...l, points: l.points.map((q, i) => (i === d.index ? p : q)) } : l,
        ),
      );
    }
  };

  const selectedLayer = scene.layers.find((l) => l.id === selected);
  const pickedMask = useMemo(() => (picked ? segmentLayerMask(picked) : null), [picked]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!photo) {
    return (
      <section className="panel narrow">
        <h2>3. Visualiseren</h2>
        <p className="empty">Laad eerst een woning in (stap 1) om kamers in te richten.</p>
      </section>
    );
  }

  const bgSrc = showLayers && erased && erased.key === eraseKey && eraseKey ? erased.url : proxied(photo.url);
  const scale = size && displayWidth ? displayWidth / size.w : 0;
  const handleR = size ? Math.max(9, size.w / 110) : 10;

  const textureSrc = (l: SurfaceLayer): string | null => {
    if (l.fill.type === "preset") return presetTexture(l.fill.preset);
    if (l.fill.type !== "texture") return null;
    const t = textures[`${l.fill.productId}:${l.crop}`];
    const product = productById.get(l.fill.productId);
    return t && t !== "pending" ? t : product?.image ? proxied(product.image) : null;
  };

  // Erased areas as masks: a new floor or wall also covers the spot where old furniture stood.
  const eraseMaskUrls = size
    ? eraseLayers.map((l) => {
        if (l.mask) return l.mask;
        const key = `${size.w}x${size.h}:${JSON.stringify(l.points)}`;
        if (!polygonMaskUrls.has(key)) polygonMaskUrls.set(key, maskToDataUrl(polygonMask(l.points, size.w, size.h), size.w, size.h));
        return polygonMaskUrls.get(key)!;
      })
    : [];

  const surfaceStyle = (l: SurfaceLayer): React.CSSProperties => {
    const style: React.CSSProperties = { opacity: l.opacity, mixBlendMode: l.blend };
    const plane = planeOf(l);
    if (l.mask) {
      const masks = [l.mask, ...eraseMaskUrls].map((u) => `url("${u}")`).join(",");
      Object.assign(style, { maskImage: masks, WebkitMaskImage: masks, maskSize: "100% 100%", WebkitMaskSize: "100% 100%" });
      if (plane) style.clipPath = `polygon(${plane.map(([x, y]) => `${x}px ${y}px`).join(",")})`;
    } else {
      style.clipPath = `polygon(${l.points.map(([x, y]) => `${x}px ${y}px`).join(",")})`;
    }
    return style;
  };

  const furniture = products.filter((p) => p.image && !SURFACE_CATEGORIES.has(p.category));
  const surfaces = products.filter((p) => SURFACE_CATEGORIES.has(p.category));
  const found = segmentation?.segments ?? [];

  return (
    <section className="panel visualizer">
      <aside className="photo-strip">
        {photos.map((p) => (
          <button key={p.id} className={p.id === photo.id ? "active" : ""} onClick={() => setPhotoId(p.id)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={proxied(p.url)} alt="" loading="lazy" />
            <span>
              {roomLabel(p.room)}
              {project.scenes[p.id]?.layers.length ? " •" : ""}
            </span>
          </button>
        ))}
      </aside>

      <div className="stage-wrap">
        <div className="toolbar row wrap">
          {drawing ? (
            <>
              <span className="hint">
                {drawing.kind === "erase"
                  ? "Klik rondom wat weg moet"
                  : "Klik de hoeken van de vloer of muur aan — 4 hoeken geeft perspectief"}{" "}
                ({drawing.points.length} punten)
              </span>
              <button className="primary" disabled={drawing.points.length < 3} onClick={finishDrawing}>
                {drawing.kind === "erase" ? "Weggummen" : "Vlak afmaken"}
              </button>
              <button onClick={() => setDrawing(null)}>Annuleren</button>
            </>
          ) : (
            <>
              <button className="primary" onClick={detect} disabled={!!status}>
                ✨ {segmentation ? "Opnieuw herkennen" : "Herken meubels, muren & vloer"}
              </button>
              <button
                onClick={() => {
                  setDrawing({ kind: "surface", points: [] });
                  setSelected(null);
                }}
              >
                🖌️ Zelf vlak aanwijzen
              </button>
              <button
                onClick={() => {
                  setDrawing({ kind: "erase", points: [] });
                  setSelected(null);
                }}
              >
                🧽 Zelf weggummen
              </button>
              <button
                onPointerDown={() => setShowLayers(false)}
                onPointerUp={() => setShowLayers(true)}
                onPointerLeave={() => setShowLayers(true)}
              >
                👁 Origineel
              </button>
              {scene.layers.length > 0 && (
                <button className="ghost" onClick={() => confirm("Alles van deze foto wissen?") && setLayers(() => [])}>
                  Alles wissen
                </button>
              )}
            </>
          )}
          {status && <span className="hint">⏳ {status}</span>}
        </div>
        {notice && <p className="error small">{notice}</p>}

        {found.length > 0 && !drawing && (
          <div className="found row wrap">
            <span className="muted small">Gevonden — klik in de foto of hier:</span>
            {found.map((s) => (
              <button key={s.id} className={`chip ${s.kind} ${picked?.id === s.id ? "on" : ""}`} onClick={() => (setSelected(null), setPicked(s))}>
                {s.label}
              </button>
            ))}
          </div>
        )}

        {size ? (
          <div ref={stageRef} className="stage" style={{ aspectRatio: `${size.w} / ${size.h}` }}>
            <div className="canvas" style={{ width: size.w, height: size.h, transform: `scale(${scale})` }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="layer" src={bgSrc} alt="" style={{ width: size.w, height: size.h }} />
              {showLayers &&
                scene.layers.map((l) => {
                  if (l.kind === "erase") return null;
                  if (l.kind === "surface") {
                    const tex = textureSrc(l);
                    const plane = planeOf(l);
                    return (
                      <div key={l.id} className="layer surface" style={{ width: size.w, height: size.h, ...surfaceStyle(l) }}>
                        {l.fill.type === "color" || !tex ? (
                          <div className="fill" style={{ background: l.fill.type === "color" ? l.fill.color : "#999" }} />
                        ) : l.perspective && plane ? (
                          <div
                            className="plane"
                            style={{
                              width: PLANE,
                              height: PLANE,
                              backgroundImage: `url("${tex}")`,
                              backgroundSize: `${l.scale}px auto`,
                              transform: quadToMatrix3d(PLANE, PLANE, plane),
                            }}
                          />
                        ) : (
                          <div className="fill" style={{ backgroundImage: `url("${tex}")`, backgroundSize: `${l.scale}px auto` }} />
                        )}
                      </div>
                    );
                  }
                  const product = productById.get(l.productId);
                  if (!product?.image) return null;
                  const cut = cutouts[cutoutKey(l)];
                  const src = l.cutout !== "off" && cut && !cut.startsWith("failed") && cut !== "pending" ? cut : proxied(product.image);
                  const h = PRODUCT_W * l.aspect;
                  return (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={l.id}
                      className="layer product"
                      src={src}
                      alt={product.title}
                      style={{
                        width: PRODUCT_W,
                        height: h,
                        transform: quadToMatrix3d(PRODUCT_W, h, l.corners) + (l.flip ? ` translateX(${PRODUCT_W}px) scaleX(-1)` : ""),
                      }}
                    />
                  );
                })}
            </div>

            {/* Interaction layer: outlines and handles, in photo coordinates. Clicks are hit-tested in code. */}
            <svg
              ref={svgRef}
              className={`overlay ${drawing ? "drawing" : ""} ${segmentation ? "pickable" : ""}`}
              viewBox={`0 0 ${size.w} ${size.h}`}
              preserveAspectRatio="none"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={() => (drag.current = null)}
              onPointerLeave={() => (drag.current = null)}
            >
              {pickedMask && <image className="highlight" href={pickedMask} width={size.w} height={size.h} preserveAspectRatio="none" />}
              {showLayers &&
                selectedLayer &&
                (selectedLayer.kind !== "product" && selectedLayer.mask ? (
                  <image className="highlight" href={selectedLayer.mask} width={size.w} height={size.h} preserveAspectRatio="none" />
                ) : (
                  <polygon
                    className="outline"
                    points={(selectedLayer.kind === "product" ? selectedLayer.corners : selectedLayer.points).map((p) => p.join(",")).join(" ")}
                  />
                ))}
              {showLayers &&
                scene.layers
                  .filter((l): l is EraseLayer => l.kind === "erase" && !l.mask && l.id !== selected)
                  .map((l) => <polygon key={l.id} className="outline faint" points={l.points.map((p) => p.join(",")).join(" ")} />)}

              {showLayers && selectedLayer?.kind === "product" &&
                selectedLayer.corners.map((c, i) => (
                  <circle
                    key={i}
                    className={`handle ${selectedLayer.distort ? "distort" : ""}`}
                    cx={c[0]}
                    cy={c[1]}
                    r={handleR}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      const from = toPhoto(e);
                      if (selectedLayer.floor) {
                        const c2 = selectedLayer.corners;
                        const center: Pt = [(c2[2][0] + c2[3][0]) / 2, (c2[2][1] + c2[3][1]) / 2];
                        drag.current = { type: "anchor-scale", id: selectedLayer.id, from, center, start: selectedLayer.floor };
                      } else {
                        drag.current = {
                          type: "corner",
                          id: selectedLayer.id,
                          index: i,
                          from,
                          start: selectedLayer.corners,
                          distort: selectedLayer.distort,
                        };
                      }
                    }}
                  />
                ))}
              {showLayers && selectedLayer?.kind === "surface" && selectedLayer.plane && (
                <>
                  <polygon className="outline plane-outline" points={selectedLayer.plane.map((p) => p.join(",")).join(" ")} />
                  {selectedLayer.plane.map((p, i) => (
                    <rect
                      key={i}
                      className="handle plane-handle"
                      x={p[0] - handleR}
                      y={p[1] - handleR}
                      width={handleR * 2}
                      height={handleR * 2}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        drag.current = { type: "plane", id: selectedLayer.id, index: i };
                      }}
                    />
                  ))}
                </>
              )}
              {showLayers && selectedLayer && selectedLayer.kind !== "product" && !selectedLayer.mask &&
                selectedLayer.points.map((p, i) => (
                  <circle
                    key={i}
                    className="handle"
                    cx={p[0]}
                    cy={p[1]}
                    r={handleR * 0.85}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      drag.current = { type: "vertex", id: selectedLayer.id, index: i };
                    }}
                  />
                ))}

              {drawing && drawing.points.length > 0 && (
                <>
                  <polygon className={`draft ${drawing.kind}`} points={drawing.points.map((p) => p.join(",")).join(" ")} />
                  {drawing.points.map((p, i) => (
                    <circle key={i} className="handle draft-point" cx={p[0]} cy={p[1]} r={handleR * 0.85} />
                  ))}
                </>
              )}
            </svg>
          </div>
        ) : (
          <div className="stage loading">Foto laden…</div>
        )}

        {picked && !selectedLayer && (
          <div className="layer-controls row wrap">
            <strong>{picked.label}</strong>
            {picked.kind === "furniture" ? (
              <>
                <button className="primary" onClick={() => eraseSegment(picked, "ai")}>
                  🧽 Weghalen met AI
                </button>
                <button onClick={() => eraseSegment(picked, "simple")}>Snel weghalen</button>
              </>
            ) : picked.kind === "floor" ? (
              <>
                <button className="primary" onClick={() => surfaceFromSegment(picked, { type: "preset", preset: "eiken-naturel" })}>
                  🪵 Nieuwe vloer leggen
                </button>
                <span className="muted small">of klik rechts op een vloer</span>
              </>
            ) : (
              <>
                <button
                  className="primary"
                  onClick={() => surfaceFromSegment(picked, { type: "color", color: products.find((p) => p.color)?.color ?? "#d8cfc4" })}
                >
                  🎨 Verven
                </button>
                <span className="muted small">of klik rechts op verf, behang of tegels</span>
              </>
            )}
            <button className="ghost" onClick={() => setPicked(null)}>
              Sluiten
            </button>
          </div>
        )}

        {selectedLayer && (
          <LayerControls
            layer={selectedLayer}
            products={products}
            floors={floors}
            cutoutState={selectedLayer.kind === "product" ? cutouts[cutoutKey(selectedLayer)] : undefined}
            onChange={(patch) => patchLayer(selectedLayer.id, patch)}
            onPlaceOnFloor={(floorId) => {
              const floor = floors.find((f) => f.id === floorId);
              if (floor && selectedLayer.kind === "product") setLayers((ls) => ls.map((l) => (l.id === selectedLayer.id ? placeOnFloor(selectedLayer, floor) : l)));
            }}
            onRemove={() => {
              setLayers((ls) => ls.filter((l) => l.id !== selectedLayer.id));
              setSelected(null);
            }}
            onReorder={(dir) =>
              setLayers((ls) => {
                const i = ls.findIndex((l) => l.id === selectedLayer.id);
                const j = i + dir;
                if (j < 0 || j >= ls.length) return ls;
                const copy = [...ls];
                [copy[i], copy[j]] = [copy[j], copy[i]];
                return copy;
              })
            }
          />
        )}
      </div>

      <aside className="palette">
        <h3>Meubels</h3>
        {furniture.length === 0 && <p className="muted small">Voeg in stap 2 meubels toe.</p>}
        {furniture
          .sort((a, b) => Number(b.status === "favoriet") - Number(a.status === "favoriet"))
          .map((p) => (
            <button key={p.id} className="palette-item" onClick={() => addProduct(p)} title={`${p.title} in de kamer plaatsen`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={proxied(p.image)} alt="" loading="lazy" />
              <span>
                {p.status === "favoriet" && "❤️ "}
                {p.title}
                <small>{categoryLabel(p.category)}</small>
              </span>
            </button>
          ))}

        <h3>Vloeren & wanden</h3>
        <p className="muted small">Kies eerst een vloer of muur in de foto, klik dan hier.</p>
        {surfaces.map((p) => (
          <button key={p.id} className="palette-item" onClick={() => applyFill(fillFor(p))}>
            {p.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={proxied(p.image)} alt="" loading="lazy" />
            ) : (
              <i className="swatch" style={{ background: p.color }} />
            )}
            <span>
              {p.title}
              <small>{categoryLabel(p.category)}</small>
            </span>
          </button>
        ))}
        <div className="presets">
          {FLOOR_PRESETS.map((f) => (
            <button key={f.id} className="preset" title={f.label} onClick={() => applyFill({ type: "preset", preset: f.id })}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={presetTexture(f.id)} alt="" />
              <span>{f.label}</span>
            </button>
          ))}
        </div>
      </aside>
    </section>
  );
}

