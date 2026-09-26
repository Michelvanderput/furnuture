"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ROOMS, roomLabel } from "@/lib/categories";
import { formatDims } from "@/lib/dimensions";
import { cameraMarker, centroidOf, floodRoom, linkedView } from "@/lib/floorplan";
import { pointInPolygon } from "@/lib/geometry";
import { planeOf } from "@/lib/layers";
import { defaultSize, formatScale, plansOf, updateItem, updatePlan } from "@/lib/plans";
import { SURFACE_CATEGORIES } from "@/lib/layers";
import type { FloorPlan, PlanItem, Product, Project, Pt, RoomType } from "@/lib/types";
import { newId } from "@/lib/useProject";
import { imagePixels } from "@/lib/worker";
import { Img } from "./Img";
import { PlanItemControls } from "./PlanItemControls";
import { MeasureLabel, RulerPrompt } from "./visualizer/Measure";

interface Props {
  project: Project;
  update: (fn: (p: Project) => Project) => void;
  onOpenPhoto: (photoId: string) => void;
}

type Mode = null | "room" | "corners" | "ruler";
type Drag = { type: "item"; id: string; dx: number; dy: number } | { type: "rotate"; id: string } | { type: "vertex"; roomId: string; index: number };

const measure = (url: string) =>
  new Promise<{ w: number; h: number }>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = reject;
    img.src = url;
  });

/**
 * The floor plan as the model of the house: mark rooms, set the scale, place
 * furniture at real size. Linked photos (see Inrichten → Koppelen) show the
 * furniture in perspective.
 */
export function FloorPlanPanel({ project, update, onOpenPhoto }: Props) {
  const plans = plansOf(project);
  const [planId, setPlanId] = useState<string | null>(null);
  const plan = plans.find((p) => p.id === planId) ?? plans[0];
  const photos = project.listing?.photos ?? [];
  const planPhoto = plan && photos.find((p) => p.id === plan.photoId);
  const candidates = photos.filter((p) => p.room === "plattegrond" && !plans.some((pl) => pl.photoId === p.id));

  async function addPlan(photoId: string) {
    const photo = photos.find((p) => p.id === photoId);
    if (!photo) return;
    const size = await measure(photo.url).catch(() => ({ w: 1440, h: 1000 }));
    const id = newId();
    update((p) => ({
      ...p,
      plans: [
        ...plansOf(p),
        { id, name: plansOf(p).length ? `Verdieping ${plansOf(p).length}` : "Begane grond", photoId, imageW: size.w, imageH: size.h, rooms: [], items: [], links: {} },
      ],
    }));
    setPlanId(id);
  }

  if (!plan || !planPhoto) {
    return (
      <section className="panel narrow">
        <h2>🗺️ Plattegrond</h2>
        <p className="muted">
          Op de plattegrond zet je meubels op ware grootte. Koppel je daarna je kamerfoto&apos;s (Inrichten → 🗺️ Koppelen), dan verschijnen
          ze in élke foto in het juiste perspectief.
        </p>
        {candidates.length ? (
          <div className="grid photos">
            {candidates.map((p) => (
              <button key={p.id} className="plan-choice" onClick={() => addPlan(p.id)}>
                <Img src={p.url} width={480} alt="Plattegrond" />
                <span>Gebruik deze plattegrond</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="empty">
            Geen plattegrond gevonden. Zet bij Woning een foto op &quot;Plattegrond&quot; (of voeg er een toe), dan kun je hem hier gebruiken.
          </p>
        )}
      </section>
    );
  }

  return (
    <PlanEditor
      key={plan.id}
      plan={plan}
      plans={plans}
      photoUrl={planPhoto.url}
      project={project}
      update={update}
      onPickPlan={setPlanId}
      onAddPlan={candidates.length ? () => addPlan(candidates[0].id) : undefined}
      onOpenPhoto={onOpenPhoto}
    />
  );
}

function PlanEditor({
  plan,
  plans,
  photoUrl,
  project,
  update,
  onPickPlan,
  onAddPlan,
  onOpenPhoto,
}: {
  plan: FloorPlan;
  plans: FloorPlan[];
  photoUrl: string;
  project: Project;
  update: Props["update"];
  onPickPlan: (id: string) => void;
  onAddPlan?: () => void;
  onOpenPhoto: (photoId: string) => void;
}) {
  const [mode, setMode] = useState<Mode>(null);
  const [draft, setDraft] = useState<Pt[]>([]);
  const [selected, setSelected] = useState<{ kind: "item" | "room"; id: string } | null>(null);
  const [rulerLine, setRulerLine] = useState<[Pt, Pt] | null>(null);
  const [message, setMessage] = useState("");
  const [pixels, setPixels] = useState<{ data: Uint8ClampedArray; width: number; height: number; f: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const W = plan.imageW, H = plan.imageH;

  // Pixels of the drawing, for finding rooms (at most 1600 px wide: plenty for walls).
  useEffect(() => {
    let alive = true;
    imagePixels(photoUrl, 1600)
      .then((img) => alive && setPixels({ ...img, f: img.width / W }))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [photoUrl, W]);

  const toPlan = (e: { clientX: number; clientY: number }): Pt => {
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(svgRef.current!.getScreenCTM()!.inverse());
    return [pt.x, pt.y];
  };
  const set = (fn: (p: FloorPlan) => FloorPlan) => updatePlan(update, plan.id, fn);
  const products = useMemo(() => new Map(project.products.map((p) => [p.id, p])), [project.products]);
  const furniture = project.products.filter((p) => p.status !== "afgewezen" && p.image && !SURFACE_CATEGORIES.has(p.category));

  const roomAt = (p: Pt) => [...plan.rooms].reverse().find((r) => pointInPolygon(p, r.polygon));
  const itemAt = (p: Pt) =>
    [...plan.items].reverse().find((it) => {
      if (!plan.cmPerPx) return false;
      const a = (-it.angle * Math.PI) / 180;
      const dx = p[0] - it.x, dy = p[1] - it.y;
      const lx = dx * Math.cos(a) + dy * Math.sin(a), ly = -dx * Math.sin(a) + dy * Math.cos(a);
      return Math.abs(lx) <= it.w / plan.cmPerPx / 2 && Math.abs(ly) <= it.d / plan.cmPerPx / 2;
    });

  function addRoom(polygon: Pt[]) {
    const id = newId();
    const used = new Set(plan.rooms.map((r) => r.type));
    const type = (["woonkamer", "keuken", "slaapkamer", "badkamer", "werkkamer", "hal", "toilet"] as RoomType[]).find((t) => !used.has(t));
    set((p) => ({ ...p, rooms: [...p.rooms, { id, name: type ? roomLabel(type) : `Kamer ${p.rooms.length + 1}`, type, polygon }] }));
    setSelected({ kind: "room", id });
  }

  function onPointerDown(e: React.PointerEvent) {
    const p = toPlan(e);
    setMessage("");
    if (mode === "room") {
      if (!pixels) return setMessage("Plattegrond wordt nog geladen…");
      const poly = floodRoom(pixels, [p[0] * pixels.f, p[1] * pixels.f]);
      if (!poly) {
        setMessage("Die kamer loopt over (een open deur of doorgang). Tik de hoeken van de kamer aan.");
        setMode("corners");
        setDraft([]);
        return;
      }
      addRoom(poly.map(([x, y]) => [x / pixels.f, y / pixels.f] as Pt));
      setMode(null);
      return;
    }
    if (mode === "corners") return setDraft((d) => [...d, p]);
    if (mode === "ruler") {
      const next = [...draft, p];
      if (next.length === 2) {
        setRulerLine([next[0], next[1]]);
        setDraft([]);
        setMode(null);
      } else setDraft(next);
      return;
    }
    const item = itemAt(p);
    if (item) {
      setSelected({ kind: "item", id: item.id });
      drag.current = { type: "item", id: item.id, dx: p[0] - item.x, dy: p[1] - item.y };
      svgRef.current?.setPointerCapture?.(e.pointerId);
      return;
    }
    const room = roomAt(p);
    setSelected(room ? { kind: "room", id: room.id } : null);
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const p = toPlan(e);
    if (d.type === "item") updateItem(update, plan.id, d.id, { x: p[0] - d.dx, y: p[1] - d.dy });
    else if (d.type === "rotate") {
      const it = plan.items.find((x) => x.id === d.id);
      if (!it) return;
      // The handle sits behind the product: pointing at it turns the back that way.
      const a = (Math.atan2(-(p[0] - it.x), -(p[1] - it.y)) * 180) / Math.PI;
      updateItem(update, plan.id, d.id, { angle: (Math.round(a / 5) * 5 + 360) % 360 });
    } else {
      set((pl) => ({
        ...pl,
        rooms: pl.rooms.map((r) => (r.id === d.roomId ? { ...r, polygon: r.polygon.map((q, i) => (i === d.index ? p : q)) } : r)),
      }));
    }
  }

  function addItem(product: Product) {
    if (!plan.cmPerPx) {
      setMessage("Stel eerst de schaal in (📏 Schaal), dan weet de app hoe groot meubels op deze tekening zijn.");
      return;
    }
    const room = plan.rooms.find((r) => r.id === (selected?.kind === "room" ? selected.id : undefined)) ?? plan.rooms[0];
    const [x, y] = room ? centroidOf(room.polygon) : [W / 2, H / 2];
    const size = defaultSize(product);
    const item: PlanItem = { id: newId(), productId: product.id, x, y, angle: 0, ...size, flip: false, cutout: "simple", tolerance: 18, shadow: 0.5 };
    set((p) => ({ ...p, items: [...p.items, item] }));
    setSelected({ kind: "item", id: item.id });
  }

  // Cameras of linked photos, drawn on the plan so you can check the link.
  const cameras = Object.entries(plan.links).flatMap(([photoId, link]) => {
    const floor = project.scenes[photoId]?.layers.find((l) => l.id === link.floorId);
    const quad = floor?.kind === "surface" ? planeOf(floor) : null;
    const view = quad && linkedView(link, quad, link.imageW, link.imageH);
    if (!view) return [];
    const m = cameraMarker(view);
    const half = Math.atan(link.imageW / 2 / view.camera.f);
    return [{ photoId, ...m, half }];
  });

  const selItem = selected?.kind === "item" ? plan.items.find((i) => i.id === selected.id) : undefined;
  const selRoom = selected?.kind === "room" ? plan.rooms.find((r) => r.id === selected.id) : undefined;
  const px = (cm: number) => cm / (plan.cmPerPx ?? 1);
  const fs = W / 70;
  const photoName = (id: string) => {
    const ph = project.listing?.photos.find((p) => p.id === id);
    return ph ? roomLabel(ph.room) : "Foto";
  };

  return (
    <section className="panel plan-panel">
      <div className="plan-main">
        <div className="toolbar row wrap">
          {plans.length > 1 &&
            plans.map((p) => (
              <button key={p.id} className={p.id === plan.id ? "on" : ""} onClick={() => onPickPlan(p.id)}>
                {p.name}
              </button>
            ))}
          {onAddPlan && <button onClick={onAddPlan}>+ Verdieping</button>}
          <button className={mode === "room" || mode === "corners" ? "primary" : ""} onClick={() => (setMode(mode ? null : "room"), setDraft([]))}>
            🏠 Kamer aanwijzen
          </button>
          <button className={mode === "ruler" ? "primary" : ""} onClick={() => (setMode(mode === "ruler" ? null : "ruler"), setDraft([]))}>
            📏 Schaal
          </button>
          <span className={`chip ${plan.cmPerPx ? "" : "warn"}`}>{formatScale(plan.cmPerPx)}</span>
          {mode === "corners" && (
            <>
              <span className="hint">Tik de hoeken van de kamer ({draft.length})</span>
              <button className="primary" disabled={draft.length < 3} onClick={() => (addRoom(draft), setDraft([]), setMode(null))}>
                Kamer maken
              </button>
            </>
          )}
          {mode === "room" && <span className="hint">Tik in een kamer op de tekening</span>}
          {mode === "ruler" && <span className="hint">Tik begin en eind van een maat die je kent ({draft.length}/2)</span>}
        </div>
        {message && <p className="error small">{message}</p>}
        {rulerLine && (
          <RulerPrompt
            tip="Neem een maat die op de plattegrond staat, bijvoorbeeld de breedte van de woonkamer (4,20 m = 420 cm). Tik precies op de binnenkant van de muren."
            onCancel={() => setRulerLine(null)}
            onSave={(cm) => {
              const [a, b] = rulerLine;
              set((p) => ({ ...p, ruler: { a, b, cm }, cmPerPx: cm / Math.hypot(b[0] - a[0], b[1] - a[1]) }));
              setRulerLine(null);
            }}
          />
        )}
        {!plan.rooms.length && !mode && (
          <ol className="help">
            <li>
              <strong>📏 Schaal</strong>: tik de uiteinden van een maat op de tekening en vul de lengte in.
            </li>
            <li>
              <strong>🏠 Kamer aanwijzen</strong>: tik in een kamer; de muren worden gevolgd.
            </li>
            <li>Tik rechts op een meubel: het komt op ware grootte in de gekozen kamer. Sleep en draai het.</li>
            <li>
              Koppel bij <strong>Inrichten → 🗺️ Koppelen</strong> je foto&apos;s: de meubels verschijnen daar in perspectief.
            </li>
          </ol>
        )}

        <div className="stage plan-stage" style={{ aspectRatio: `${W} / ${H}` }}>
          <Img src={photoUrl} alt="Plattegrond" className="plan-image" />
          <svg
            ref={svgRef}
            className={`overlay ${mode ? "drawing" : ""}`}
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={() => (drag.current = null)}
            onPointerCancel={() => (drag.current = null)}
          >
            {plan.rooms.map((r) => {
              const c = centroidOf(r.polygon);
              return (
                <g key={r.id} className={`plan-room ${selected?.id === r.id ? "selected" : ""}`}>
                  <polygon points={r.polygon.map((p) => p.join(",")).join(" ")} />
                  <text x={c[0]} y={c[1] - fs * 1.2} fontSize={fs} textAnchor="middle">
                    {r.name}
                  </text>
                </g>
              );
            })}
            {(plan.scanned ?? []).map((s, i) => (
              <g key={i} className="plan-scanned">
                <polygon points={s.polygon.map((p) => p.join(",")).join(" ")} />
                <text x={centroidOf(s.polygon)[0]} y={centroidOf(s.polygon)[1]} fontSize={fs * 0.7} textAnchor="middle">
                  {s.label} (nu)
                </text>
              </g>
            ))}
            {cameras.map((c) => {
              const len = W / 9;
              const ray = (a: number): Pt => {
                const cos = Math.cos(a), sin = Math.sin(a);
                return [c.x + (c.dir[0] * cos - c.dir[1] * sin) * len, c.y + (c.dir[0] * sin + c.dir[1] * cos) * len];
              };
              const [l, r] = [ray(-c.half), ray(c.half)];
              return (
                <g key={c.photoId} className="plan-camera" onPointerDown={(e) => (e.stopPropagation(), onOpenPhoto(c.photoId))}>
                  <polygon points={`${c.x},${c.y} ${l.join(",")} ${r.join(",")}`} />
                  <circle cx={c.x} cy={c.y} r={fs * 0.6} />
                  <text x={c.x} y={c.y + fs * 1.8} fontSize={fs * 0.8} textAnchor="middle">
                    📷 {photoName(c.photoId)}
                  </text>
                </g>
              );
            })}
            {plan.cmPerPx &&
              plan.items.map((it) => {
                const p = products.get(it.productId);
                const w = px(it.w), d = px(it.d);
                return (
                  <g key={it.id} className={`plan-item ${selected?.id === it.id ? "selected" : ""}`} transform={`translate(${it.x} ${it.y}) rotate(${-it.angle})`}>
                    <rect x={-w / 2} y={-d / 2} width={w} height={d} />
                    {p?.image && <image href={p.image} x={-w / 2} y={-d / 2} width={w} height={d} preserveAspectRatio="xMidYMid meet" opacity={0.85} />}
                    <line className="front" x1={-w / 2} y1={d / 2} x2={w / 2} y2={d / 2} />
                    {selected?.id === it.id && (
                      <circle
                        className="handle"
                        cy={-d / 2 - fs * 1.5}
                        r={fs * 0.7}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          drag.current = { type: "rotate", id: it.id };
                          svgRef.current?.setPointerCapture?.(e.pointerId);
                        }}
                      />
                    )}
                  </g>
                );
              })}
            {selRoom &&
              selRoom.polygon.map((p, i) => (
                <circle
                  key={i}
                  className="handle"
                  cx={p[0]}
                  cy={p[1]}
                  r={fs * 0.6}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    drag.current = { type: "vertex", roomId: selRoom.id, index: i };
                    svgRef.current?.setPointerCapture?.(e.pointerId);
                  }}
                />
              ))}
            {plan.ruler && (
              <g className="measure ruler">
                <line x1={plan.ruler.a[0]} y1={plan.ruler.a[1]} x2={plan.ruler.b[0]} y2={plan.ruler.b[1]} />
                <MeasureLabel
                  at={[(plan.ruler.a[0] + plan.ruler.b[0]) / 2, (plan.ruler.a[1] + plan.ruler.b[1]) / 2]}
                  text={`${Math.round(plan.ruler.cm)} cm`}
                  size={W * 0.8}
                />
              </g>
            )}
            {draft.length > 0 && <polyline className="draft" points={draft.map((p) => p.join(",")).join(" ")} />}
            {draft.map((p, i) => (
              <circle key={i} className="handle draft-point" cx={p[0]} cy={p[1]} r={fs * 0.5} />
            ))}
          </svg>
        </div>

        {selItem && (
          <PlanItemControls
            item={selItem}
            product={products.get(selItem.productId)}
            onChange={(patch) => updateItem(update, plan.id, selItem.id, patch)}
            onRemove={() => (set((p) => ({ ...p, items: p.items.filter((i) => i.id !== selItem.id) })), setSelected(null))}
            onDuplicate={() => {
              const id = newId();
              set((p) => ({ ...p, items: [...p.items, { ...selItem, id, x: selItem.x + px(selItem.w) * 0.3, y: selItem.y + px(selItem.d) * 0.3 }] }));
              setSelected({ kind: "item", id });
            }}
          />
        )}
        {selRoom && (
          <div className="layer-controls row wrap">
            <input className="room-name" value={selRoom.name} onChange={(e) => set((p) => ({ ...p, rooms: p.rooms.map((r) => (r.id === selRoom.id ? { ...r, name: e.target.value } : r)) }))} aria-label="Naam" />
            <select
              value={selRoom.type ?? ""}
              onChange={(e) => set((p) => ({ ...p, rooms: p.rooms.map((r) => (r.id === selRoom.id ? { ...r, type: (e.target.value || undefined) as RoomType } : r)) }))}
              aria-label="Soort ruimte"
            >
              <option value="">Soort…</option>
              {ROOMS.filter((r) => !["buitenkant", "plattegrond", "overig"].includes(r.id)).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
            <span className="muted small">Versleep de hoekpunten om de kamer bij te stellen.</span>
            <button className="ghost" onClick={() => (set((p) => ({ ...p, rooms: p.rooms.filter((r) => r.id !== selRoom.id) })), setSelected(null))}>
              🗑 Verwijderen
            </button>
          </div>
        )}
      </div>

      <aside className="palette">
        <h3>Meubels</h3>
        <p className="muted small">Tik om op de plattegrond te zetten{selRoom ? ` (in ${selRoom.name})` : ""}.</p>
        {furniture.map((p) => (
          <button key={p.id} className="palette-item" onClick={() => addItem(p)}>
            <Img src={p.thumb ?? p.image} alt="" loading="lazy" />
            <span>
              {p.title}
              <small>{p.dims ? formatDims(p.dims) : "maten onbekend"}</small>
            </span>
          </button>
        ))}
        <h3>Gekoppelde foto&apos;s</h3>
        {Object.keys(plan.links).length === 0 && <p className="muted small">Nog geen. Open een foto bij Inrichten en kies 🗺️ Koppelen.</p>}
        {Object.keys(plan.links).map((id) => {
          const ph = project.listing?.photos.find((p) => p.id === id);
          return (
            ph && (
              <button key={id} className="palette-item" onClick={() => onOpenPhoto(id)}>
                <Img src={ph.url} width={240} alt="" loading="lazy" />
                <span>
                  {roomLabel(ph.room)}
                  <small>openen</small>
                </span>
              </button>
            )
          );
        })}
      </aside>
    </section>
  );
}
