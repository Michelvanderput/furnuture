"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { removeBackgroundAI } from "@/lib/ai";
import { categoryLabel, roomLabel } from "@/lib/categories";
import { centroid, quadToMatrix3d, rectQuad } from "@/lib/geometry";
import { cropCenter, loadImage, NoPlainBackground, proxied, removeBackground } from "@/lib/images";
import { erasePolygons } from "@/lib/inpaint";
import { FLOOR_PRESETS, presetTexture } from "@/lib/textures";
import { newId } from "@/lib/useProject";
import type { EraseLayer, Layer, Product, ProductLayer, Project, Pt, Quad, Scene, SurfaceFill, SurfaceLayer } from "@/lib/types";
import { cutoutKey, fillFor, SURFACE_CATEGORIES, surfaceDefaults } from "@/lib/layers";
import { LayerControls } from "./LayerControls";

interface Props {
  project: Project;
  update: (fn: (p: Project) => Project) => void;
  photoId: string | null;
  setPhotoId: (id: string) => void;
}

/** Size of the virtual plane a perspective texture is drawn on. */
const PLANE = 1000;
/** Rendered size of a product image before it is mapped onto its corners. */
const PRODUCT_W = 1000;

type Drawing = { kind: "surface" | "erase"; points: Pt[]; fill?: SurfaceFill };
type Drag =
  | { type: "move"; id: string; from: Pt; start: Quad }
  | { type: "corner"; id: string; index: number; from: Pt; start: Quad; distort: boolean }
  | { type: "vertex"; id: string; index: number };

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
  const drag = useRef<Drag | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSize(null);
    setSelected(null);
    setDrawing(null);
    setErased(null);
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
      const product = project.products.find((p) => p.id === (layer.fill as { productId: string }).productId);
      const key = `${layer.fill.productId}:${layer.crop}`;
      if (!product?.image || textures[key]) continue;
      setTextures((t) => ({ ...t, [key]: "pending" }));
      cropCenter(product.image, layer.crop)
        .then((url) => setTextures((t) => ({ ...t, [key]: url })))
        .catch(() => setTextures((t) => ({ ...t, [key]: proxied(product.image) })));
    }
  }, [scene.layers, project.products, textures]);

  // The photo with existing furniture painted out.
  const erasePolys = scene.layers.filter((l): l is EraseLayer => l.kind === "erase" && l.points.length >= 3);
  const eraseKey = erasePolys.length ? JSON.stringify(erasePolys.map((l) => l.points.map((p) => p.map(Math.round)))) : "";
  useEffect(() => {
    if (!photo || !eraseKey) return;
    let cancelled = false;
    setStatus("Gummen…");
    // Let the status paint before the (synchronous) fill blocks the page briefly.
    const t = setTimeout(() => {
      erasePolygons(photo.url, JSON.parse(eraseKey))
        .then((url) => !cancelled && setErased({ key: eraseKey, url }))
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
      return { ...p, scenes: { ...p.scenes, [photo.id]: { photoId: photo.id, layers: fn(current) } } };
    });
  };
  const patchLayer = (id: string, patch: Partial<ProductLayer> | Partial<SurfaceLayer> | Partial<EraseLayer>) =>
    setLayers((ls) => ls.map((l) => (l.id === id ? ({ ...l, ...patch } as Layer) : l)));

  const toPhoto = (e: { clientX: number; clientY: number }): Pt => {
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(svgRef.current!.getScreenCTM()!.inverse());
    return [pt.x, pt.y];
  };

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
    const layer: ProductLayer = {
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
    setLayers((ls) => [...ls, layer]);
    setSelected(layer.id);
  }

  /** Floors, paint and presets: fill the selected area, or start drawing one. */
  function applyFill(fill: SurfaceFill) {
    const current = scene.layers.find((l) => l.id === selected);
    if (current?.kind === "surface") {
      patchLayer(current.id, { fill, ...surfaceDefaults(fill) });
    } else {
      setSelected(null);
      setDrawing({ kind: "surface", points: [], fill });
    }
  }

  function finishDrawing() {
    if (!drawing || drawing.points.length < 3) return;
    const id = newId();
    if (drawing.kind === "erase") {
      // Erasing happens on the photo itself, so it goes below everything.
      setLayers((ls) => [{ kind: "erase", id, points: drawing.points }, ...ls]);
    } else {
      const fill = drawing.fill ?? { type: "color", color: products.find((p) => p.color)?.color ?? "#9fb3a3" };
      const four = drawing.points.length === 4;
      const layer: SurfaceLayer = {
        kind: "surface",
        id,
        points: drawing.points,
        fill,
        ...surfaceDefaults(fill),
        scale: four ? 350 : Math.round((size?.w ?? 1000) / 4),
        perspective: four,
        crop: 1,
      };
      // Surfaces go below products so furniture stands "on" the new floor.
      setLayers((ls) => {
        const firstProduct = ls.findIndex((l) => l.kind === "product");
        const at = firstProduct === -1 ? ls.length : firstProduct;
        return [...ls.slice(0, at), layer, ...ls.slice(at)];
      });
    }
    setDrawing(null);
    setSelected(id);
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = toPhoto(e);
    if (d.type === "move") {
      const dx = p[0] - d.from[0];
      const dy = p[1] - d.from[1];
      patchLayer(d.id, { corners: d.start.map(([x, y]) => [x + dx, y + dy]) as Quad });
    } else if (d.type === "corner") {
      if (d.distort) {
        patchLayer(d.id, { corners: d.start.map((c, i) => (i === d.index ? p : c)) as Quad });
      } else {
        // Uniform scale around the centre.
        const c = centroid(d.start);
        const f = Math.hypot(p[0] - c[0], p[1] - c[1]) / Math.max(1, Math.hypot(d.from[0] - c[0], d.from[1] - c[1]));
        patchLayer(d.id, { corners: d.start.map(([x, y]) => [c[0] + (x - c[0]) * f, c[1] + (y - c[1]) * f]) as Quad });
      }
    } else {
      setLayers((ls) =>
        ls.map((l) =>
          l.id === d.id && l.kind !== "product" ? { ...l, points: l.points.map((q, i) => (i === d.index ? p : q)) } : l,
        ),
      );
    }
  };

  const selectedLayer = scene.layers.find((l) => l.id === selected);
  const productById = useMemo(() => new Map(project.products.map((p) => [p.id, p])), [project.products]);

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

  const furniture = products.filter((p) => p.image && !SURFACE_CATEGORIES.has(p.category));
  const surfaces = products.filter((p) => SURFACE_CATEGORIES.has(p.category));

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
                  ? "Klik rondom het meubel dat weg moet"
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
              <button
                onClick={() => {
                  setDrawing({ kind: "surface", points: [] });
                  setSelected(null);
                }}
              >
                🖌️ Muur / vloer aanwijzen
              </button>
              <button
                onClick={() => {
                  setDrawing({ kind: "erase", points: [] });
                  setSelected(null);
                }}
              >
                🧽 Meubel weggummen
              </button>
              <button
                onPointerDown={() => setShowLayers(false)}
                onPointerUp={() => setShowLayers(true)}
                onPointerLeave={() => setShowLayers(true)}
              >
                👁 Houd vast: origineel
              </button>
              {scene.layers.length > 0 && (
                <button className="ghost" onClick={() => confirm("Alles van deze foto wissen?") && setLayers(() => [])}>
                  Alles wissen
                </button>
              )}
            </>
          )}
          {status && <span className="hint">{status}</span>}
        </div>

        {size ? (
          <div ref={stageRef} className="stage" style={{ aspectRatio: `${size.w} / ${size.h}` }}>
            <div className="canvas" style={{ width: size.w, height: size.h, transform: `scale(${scale})` }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="layer" src={bgSrc} alt="" style={{ width: size.w, height: size.h }} />
              {showLayers &&
                scene.layers.map((l) => {
                  if (l.kind === "erase") return null;
                  if (l.kind === "surface") {
                    const clip = `polygon(${l.points.map(([x, y]) => `${x}px ${y}px`).join(",")})`;
                    const tex = textureSrc(l);
                    return (
                      <div
                        key={l.id}
                        className="layer surface"
                        style={{ width: size.w, height: size.h, clipPath: clip, opacity: l.opacity, mixBlendMode: l.blend }}
                      >
                        {l.fill.type === "color" || !tex ? (
                          <div className="fill" style={{ background: l.fill.type === "color" ? l.fill.color : "#999" }} />
                        ) : l.perspective && l.points.length === 4 ? (
                          <div
                            className="plane"
                            style={{
                              width: PLANE,
                              height: PLANE,
                              backgroundImage: `url("${tex}")`,
                              backgroundSize: `${l.scale}px auto`,
                              transform: quadToMatrix3d(PLANE, PLANE, l.points as Quad),
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

            {/* Interaction layer: hit areas, outlines and handles, in photo coordinates. */}
            <svg
              ref={svgRef}
              className={`overlay ${drawing ? "drawing" : ""}`}
              viewBox={`0 0 ${size.w} ${size.h}`}
              preserveAspectRatio="none"
              onPointerMove={onPointerMove}
              onPointerUp={() => (drag.current = null)}
              onPointerLeave={() => (drag.current = null)}
              onPointerDown={(e) => {
                if (e.target !== e.currentTarget) return;
                if (drawing) setDrawing({ ...drawing, points: [...drawing.points, toPhoto(e)] });
                else setSelected(null);
              }}
            >
              {showLayers &&
                scene.layers.map((l) => {
                  const pts = l.kind === "product" ? l.corners : l.points;
                  const isSel = selected === l.id;
                  return (
                    <polygon
                      key={l.id}
                      points={pts.map((p) => p.join(",")).join(" ")}
                      className={`hit ${l.kind} ${isSel ? "selected" : ""}`}
                      onPointerDown={(e) => {
                        if (drawing) return;
                        e.stopPropagation();
                        setSelected(l.id);
                        if (l.kind === "product") drag.current = { type: "move", id: l.id, from: toPhoto(e), start: l.corners };
                      }}
                    />
                  );
                })}

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
                      drag.current = {
                        type: "corner",
                        id: selectedLayer.id,
                        index: i,
                        from: toPhoto(e),
                        start: selectedLayer.corners,
                        distort: selectedLayer.distort,
                      };
                    }}
                  />
                ))}
              {showLayers && selectedLayer && selectedLayer.kind !== "product" &&
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
                    <circle key={i} className="handle" cx={p[0]} cy={p[1]} r={handleR * 0.85} />
                  ))}
                </>
              )}
            </svg>
          </div>
        ) : (
          <div className="stage loading">Foto laden…</div>
        )}

        {selectedLayer && (
          <LayerControls
            layer={selectedLayer}
            products={products}
            cutoutState={selectedLayer.kind === "product" ? cutouts[cutoutKey(selectedLayer)] : undefined}
            onChange={(patch) => patchLayer(selectedLayer.id, patch)}
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
        <p className="muted small">Klik, en wijs dan de vloer of muur aan (of kies eerst een vlak).</p>
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

