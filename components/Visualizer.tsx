"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { categoryLabel, roomLabel } from "@/lib/categories";
import { loadImage, proxied, removeBackground } from "@/lib/images";
import { newId } from "@/lib/useProject";
import type { Layer, Photo, Product, ProductLayer, Project, Scene, SurfaceLayer } from "@/lib/types";

interface Props {
  project: Project;
  update: (fn: (p: Project) => Project) => void;
  photoId: string | null;
  setPhotoId: (id: string) => void;
}

const TEXTURE_CATEGORIES = new Set(["vloeren", "behang", "tegels", "vloerkleden"]);

type Drag =
  | { type: "move"; id: string; dx: number; dy: number }
  | { type: "resize"; id: string; x0: number }
  | { type: "vertex"; id: string; index: number };

export function Visualizer({ project, update, photoId, setPhotoId }: Props) {
  const photos = (project.listing?.photos ?? []).filter((p) => p.room !== "plattegrond" && p.room !== "buitenkant");
  const photo = photos.find((p) => p.id === photoId) ?? photos[0];
  const scene: Scene = (photo && project.scenes[photo.id]) || { photoId: photo?.id ?? "", layers: [] };
  const products = project.products.filter((p) => p.status !== "afgewezen" && (p.image || p.color));

  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [drawing, setDrawing] = useState<[number, number][] | null>(null);
  const [showLayers, setShowLayers] = useState(true);
  const [cutouts, setCutouts] = useState<Record<string, string>>({});
  const drag = useRef<Drag | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    setSize(null);
    setSelected(null);
    setDrawing(null);
    if (!photo) return;
    loadImage(proxied(photo.url))
      .then((img) => setSize({ w: img.naturalWidth, h: img.naturalHeight }))
      .catch(() => setSize({ w: 1440, h: 960 }));
  }, [photo?.id, photo?.url]); // eslint-disable-line react-hooks/exhaustive-deps

  // Compute background-free versions of product images that are shown as cut-outs.
  useEffect(() => {
    for (const layer of scene.layers) {
      if (layer.kind !== "product" || !layer.cutout || cutouts[layer.productId]) continue;
      const product = project.products.find((p) => p.id === layer.productId);
      if (!product?.image) continue;
      setCutouts((c) => ({ ...c, [layer.productId]: "pending" }));
      removeBackground(product.image)
        .then((png) => setCutouts((c) => ({ ...c, [layer.productId]: png })))
        .catch(() => setCutouts((c) => ({ ...c, [layer.productId]: "failed" })));
    }
  }, [scene.layers, project.products, cutouts]);

  const setLayers = (fn: (layers: Layer[]) => Layer[]) => {
    if (!photo) return;
    update((p) => {
      const current = p.scenes[photo.id]?.layers ?? [];
      return { ...p, scenes: { ...p.scenes, [photo.id]: { photoId: photo.id, layers: fn(current) } } };
    });
  };
  const patchLayer = (id: string, patch: Partial<ProductLayer> | Partial<SurfaceLayer>) =>
    setLayers((ls) => ls.map((l) => (l.id === id ? ({ ...l, ...patch } as Layer) : l)));

  const toSvg = (e: { clientX: number; clientY: number }): [number, number] => {
    const svg = svgRef.current!;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM()!.inverse());
    return [pt.x, pt.y];
  };

  async function addProduct(product: Product) {
    if (!size) return;
    if (!product.image) return;
    let aspect = 1;
    try {
      const img = await loadImage(proxied(product.image));
      aspect = img.naturalHeight / img.naturalWidth;
    } catch {
      /* keep square */
    }
    const width = size.w * 0.3;
    const layer: ProductLayer = {
      kind: "product",
      id: newId(),
      productId: product.id,
      x: size.w / 2 - width / 2,
      y: size.h * 0.55 - (width * aspect) / 2,
      width,
      aspect,
      flip: false,
      cutout: true,
    };
    setLayers((ls) => [...ls, layer]);
    setSelected(layer.id);
  }

  function finishSurface() {
    if (!drawing || drawing.length < 3) return;
    const layer: SurfaceLayer = {
      kind: "surface",
      id: newId(),
      points: drawing,
      fill: { type: "color", color: products.find((p) => p.color)?.color ?? "#9fb3a3" },
      opacity: 0.75,
      blend: "multiply",
      scale: Math.round((size?.w ?? 1000) / 6),
    };
    // Surfaces go below products so furniture stands "on" the new floor.
    setLayers((ls) => [layer, ...ls]);
    setDrawing(null);
    setSelected(layer.id);
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const [x, y] = toSvg(e);
    if (d.type === "move") patchLayer(d.id, { x: x - d.dx, y: y - d.dy });
    if (d.type === "resize") patchLayer(d.id, { width: Math.max(20, x - d.x0) });
    if (d.type === "vertex") {
      setLayers((ls) =>
        ls.map((l) =>
          l.id === d.id && l.kind === "surface"
            ? { ...l, points: l.points.map((p, i) => (i === d.index ? ([x, y] as [number, number]) : p)) }
            : l,
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

  return (
    <section className="panel visualizer">
      <aside className="photo-strip">
        {photos.map((p: Photo) => (
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
              <span className="hint">Klik de hoeken van een muur of vloer aan ({drawing.length} punten)</span>
              <button className="primary" disabled={drawing.length < 3} onClick={finishSurface}>
                Vlak afmaken
              </button>
              <button onClick={() => setDrawing(null)}>Annuleren</button>
            </>
          ) : (
            <>
              <button
                onClick={() => {
                  setDrawing([]);
                  setSelected(null);
                }}
              >
                🖌️ Muur / vloer aanwijzen
              </button>
              <button onPointerDown={() => setShowLayers(false)} onPointerUp={() => setShowLayers(true)} onPointerLeave={() => setShowLayers(true)}>
                👁 Houd vast: origineel
              </button>
              {scene.layers.length > 0 && (
                <button className="ghost" onClick={() => confirm("Alles van deze foto wissen?") && setLayers(() => [])}>
                  Alles wissen
                </button>
              )}
            </>
          )}
        </div>

        {size ? (
          <svg
            ref={svgRef}
            className={`stage ${drawing ? "drawing" : ""}`}
            viewBox={`0 0 ${size.w} ${size.h}`}
            onPointerMove={onPointerMove}
            onPointerUp={() => (drag.current = null)}
            onPointerLeave={() => (drag.current = null)}
            onClick={(e) => {
              if (drawing) setDrawing([...drawing, toSvg(e)]);
              else if (e.target === e.currentTarget || (e.target as Element).classList.contains("bg")) setSelected(null);
            }}
          >
            <defs>
              {scene.layers.map((l) => {
                if (l.kind !== "surface" || l.fill.type !== "texture") return null;
                const product = productById.get(l.fill.productId);
                if (!product?.image) return null;
                return (
                  <pattern key={l.id} id={`tex-${l.id}`} patternUnits="userSpaceOnUse" width={l.scale} height={l.scale}>
                    <image href={proxied(product.image)} width={l.scale} height={l.scale} preserveAspectRatio="xMidYMid slice" />
                  </pattern>
                );
              })}
            </defs>
            <image className="bg" href={proxied(photo.url)} width={size.w} height={size.h} />

            {showLayers &&
              scene.layers.map((l) => {
                if (l.kind === "surface") {
                  const fill = l.fill.type === "color" ? l.fill.color : `url(#tex-${l.id})`;
                  return (
                    <polygon
                      key={l.id}
                      points={l.points.map((p) => p.join(",")).join(" ")}
                      fill={fill}
                      opacity={l.opacity}
                      style={{ mixBlendMode: l.blend }}
                      className={selected === l.id ? "selected" : ""}
                      onClick={(e) => {
                        if (drawing) return;
                        e.stopPropagation();
                        setSelected(l.id);
                      }}
                    />
                  );
                }
                const product = productById.get(l.productId);
                if (!product) return null;
                const cut = cutouts[l.productId];
                const href = l.cutout && cut && cut !== "pending" && cut !== "failed" ? cut : proxied(product.image);
                const h = l.width * l.aspect;
                return (
                  <g
                    key={l.id}
                    className={`product-layer ${selected === l.id ? "selected" : ""}`}
                    transform={l.flip ? `translate(${2 * l.x + l.width} 0) scale(-1 1)` : undefined}
                    onPointerDown={(e) => {
                      if (drawing) return;
                      e.stopPropagation();
                      const [x, y] = toSvg(e);
                      setSelected(l.id);
                      drag.current = { type: "move", id: l.id, dx: x - l.x, dy: y - l.y };
                    }}
                  >
                    <image href={href} x={l.x} y={l.y} width={l.width} height={h} preserveAspectRatio="xMidYMid meet" />
                    {selected === l.id && <rect x={l.x} y={l.y} width={l.width} height={h} className="outline" />}
                  </g>
                );
              })}

            {/* Resize handle and vertex handles for the selected layer (drawn unflipped, on top). */}
            {showLayers && selectedLayer?.kind === "product" && (
              <circle
                className="handle"
                cx={selectedLayer.x + selectedLayer.width}
                cy={selectedLayer.y + selectedLayer.width * selectedLayer.aspect}
                r={Math.max(10, size.w / 90)}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  drag.current = { type: "resize", id: selectedLayer.id, x0: selectedLayer.x };
                }}
              />
            )}
            {showLayers &&
              selectedLayer?.kind === "surface" &&
              selectedLayer.points.map((p, i) => (
                <circle
                  key={i}
                  className="handle"
                  cx={p[0]}
                  cy={p[1]}
                  r={Math.max(8, size.w / 120)}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    drag.current = { type: "vertex", id: selectedLayer.id, index: i };
                  }}
                />
              ))}

            {drawing && drawing.length > 0 && (
              <>
                <polyline className="draft" points={drawing.map((p) => p.join(",")).join(" ")} />
                {drawing.map((p, i) => (
                  <circle key={i} className="handle" cx={p[0]} cy={p[1]} r={Math.max(8, size.w / 120)} />
                ))}
              </>
            )}
          </svg>
        ) : (
          <div className="stage loading">Foto laden…</div>
        )}

        {selectedLayer && (
          <LayerControls
            layer={selectedLayer}
            products={products}
            cutoutState={selectedLayer.kind === "product" ? cutouts[selectedLayer.productId] : undefined}
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
        <h3>Jouw producten</h3>
        {products.length === 0 && <p className="muted small">Voeg in stap 2 producten toe.</p>}
        {products
          .filter((p) => p.image)
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
      </aside>
    </section>
  );
}

function LayerControls({
  layer,
  products,
  cutoutState,
  onChange,
  onRemove,
  onReorder,
}: {
  layer: Layer;
  products: Product[];
  cutoutState?: string;
  onChange: (patch: Partial<ProductLayer> | Partial<SurfaceLayer>) => void;
  onRemove: () => void;
  onReorder: (dir: number) => void;
}) {
  const textures = products.filter((p) => p.image && TEXTURE_CATEGORIES.has(p.category));
  const paints = products.filter((p) => p.color);

  return (
    <div className="layer-controls row wrap">
      {layer.kind === "product" ? (
        <>
          <label className="row">
            <input type="checkbox" checked={layer.cutout} onChange={(e) => onChange({ cutout: e.target.checked })} />
            Achtergrond weghalen
            {layer.cutout && cutoutState === "pending" && <small> (bezig…)</small>}
            {layer.cutout && cutoutState === "failed" && <small> (lukt niet bij deze afbeelding)</small>}
          </label>
          <button onClick={() => onChange({ flip: !layer.flip })}>↔ Spiegelen</button>
        </>
      ) : (
        <>
          <select
            value={layer.fill.type === "color" ? `color:${layer.fill.color}` : `tex:${layer.fill.productId}`}
            onChange={(e) => {
              const [type, value] = e.target.value.split(/:(.*)/s);
              if (type === "tex") onChange({ fill: { type: "texture", productId: value }, blend: "normal", opacity: 0.9 });
              else if (value !== "custom") onChange({ fill: { type: "color", color: value }, blend: "multiply" });
            }}
          >
            {layer.fill.type === "color" && !paints.some((p) => p.color === (layer.fill as { color: string }).color) && (
              <option value={`color:${layer.fill.color}`}>Eigen kleur</option>
            )}
            {paints.map((p) => (
              <option key={p.id} value={`color:${p.color}`}>
                🎨 {p.title}
              </option>
            ))}
            {textures.map((p) => (
              <option key={p.id} value={`tex:${p.id}`}>
                🪵 {p.title}
              </option>
            ))}
          </select>
          {layer.fill.type === "color" && (
            <input type="color" value={layer.fill.color} onChange={(e) => onChange({ fill: { type: "color", color: e.target.value } })} />
          )}
          {layer.fill.type === "texture" && (
            <label className="row">
              Patroon
              <input
                type="range"
                min={40}
                max={800}
                value={layer.scale}
                onChange={(e) => onChange({ scale: Number(e.target.value) })}
              />
            </label>
          )}
          <label className="row">
            Dekking
            <input
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={layer.opacity}
              onChange={(e) => onChange({ opacity: Number(e.target.value) })}
            />
          </label>
          <label className="row">
            <input
              type="checkbox"
              checked={layer.blend === "multiply"}
              onChange={(e) => onChange({ blend: e.target.checked ? "multiply" : "normal" })}
            />
            Schaduw behouden
          </label>
        </>
      )}
      <button onClick={() => onReorder(-1)} title="Naar achteren">
        ⬇
      </button>
      <button onClick={() => onReorder(1)} title="Naar voren">
        ⬆
      </button>
      <button className="ghost" onClick={onRemove}>
        🗑 Verwijderen
      </button>
    </div>
  );
}
