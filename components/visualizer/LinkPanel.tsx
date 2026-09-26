"use client";

import { useRef, useState } from "react";
import { cameraMarker, type LinkedView } from "@/lib/floorplan";
import type { FloorPlan, Pt, Quad } from "@/lib/types";
import { Img } from "../Img";

interface Props {
  plan: FloorPlan;
  planUrl: string;
  view: LinkedView | null;
  /** Current link quad on the plan (for fine-tuning), if linked. */
  linkQuad?: Quad;
  imageW: number;
  onLink: (left: Pt, right: Pt) => void;
  onAdjust: (quad: Quad) => void;
  onUnlink: () => void;
  onClose: () => void;
}

/**
 * Link a photo to the floor plan: tap where the two far floor corners (L and R,
 * marked in the photo) are on the plan. Room corners snap. The recovered camera
 * is drawn on the plan, so you see immediately whether it is right.
 */
export function LinkPanel({ plan, planUrl, view, linkQuad, imageW, onLink, onAdjust, onUnlink, onClose }: Props) {
  const [taps, setTaps] = useState<Pt[]>([]);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragIndex = useRef<number | null>(null);
  const W = plan.imageW, H = plan.imageH;
  const fs = W / 60;
  const corners = plan.rooms.flatMap((r) => r.polygon);

  const toPlan = (e: { clientX: number; clientY: number }): Pt => {
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(svgRef.current!.getScreenCTM()!.inverse());
    return [pt.x, pt.y];
  };
  const snap = (p: Pt): Pt => {
    let best: Pt = p, bd = fs * 1.6;
    for (const c of corners) {
      const d = Math.hypot(c[0] - p[0], c[1] - p[1]);
      if (d < bd) (bd = d), (best = c);
    }
    return best;
  };

  const cam = view && cameraMarker(view);
  const half = view ? Math.atan(imageW / 2 / view.camera.f) : 0;
  const ray = (a: number): Pt | null => {
    if (!cam) return null;
    const cos = Math.cos(a), sin = Math.sin(a), len = W / 7;
    return [cam.x + (cam.dir[0] * cos - cam.dir[1] * sin) * len, cam.y + (cam.dir[0] * sin + cam.dir[1] * cos) * len];
  };
  const [l, r] = [ray(-half), ray(half)];

  return (
    <div className="link-panel">
      <div className="row wrap between">
        <strong>🗺️ Koppel deze foto aan de plattegrond</strong>
        <div className="row">
          {linkQuad && (
            <button className="ghost" onClick={onUnlink}>
              Ontkoppelen
            </button>
          )}
          <button className="primary" onClick={onClose}>
            Klaar
          </button>
        </div>
      </div>
      <p className="small">
        {taps.length === 0
          ? "Tik op de plattegrond waar punt L staat (de linker verre hoek van de vloer, zie de foto)."
          : "Tik nu waar punt R staat (de rechter verre hoek)."}{" "}
        Kamerhoeken worden vanzelf gevonden.
        {linkQuad && " Gekoppeld: de camera staat op de plattegrond. Klopt het niet helemaal? Versleep de oranje punten."}
      </p>
      <div className="stage plan-stage mini" style={{ aspectRatio: `${W} / ${H}` }}>
        <Img src={planUrl} alt="Plattegrond" className="plan-image" />
        <svg
          ref={svgRef}
          className="overlay drawing"
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          onPointerDown={(e) => {
            if (e.target !== e.currentTarget) return;
            const p = snap(toPlan(e));
            if (taps.length === 0) setTaps([p]);
            else {
              onLink(taps[0], p);
              setTaps([]);
            }
          }}
          onPointerMove={(e) => {
            if (dragIndex.current === null || !linkQuad) return;
            const q = linkQuad.map((c, i) => (i === dragIndex.current ? toPlan(e) : c)) as Quad;
            onAdjust(q);
          }}
          onPointerUp={() => (dragIndex.current = null)}
        >
          {plan.rooms.map((room) => (
            <polygon key={room.id} className="plan-room" points={room.polygon.map((p) => p.join(",")).join(" ")} />
          ))}
          {linkQuad && <polygon className="link-quad" points={linkQuad.map((p) => p.join(",")).join(" ")} />}
          {cam && l && r && (
            <g className="plan-camera">
              <polygon points={`${cam.x},${cam.y} ${l.join(",")} ${r.join(",")}`} />
              <circle cx={cam.x} cy={cam.y} r={fs * 0.6} />
            </g>
          )}
          {linkQuad?.map((p, i) => (
            <circle
              key={i}
              className="handle"
              cx={p[0]}
              cy={p[1]}
              r={fs * 0.55}
              onPointerDown={(e) => {
                e.stopPropagation();
                dragIndex.current = i;
                svgRef.current?.setPointerCapture?.(e.pointerId);
              }}
            />
          ))}
          {taps.map((p, i) => (
            <g key={i}>
              <circle className="handle draft-point" cx={p[0]} cy={p[1]} r={fs * 0.6} />
              <text x={p[0]} y={p[1] - fs} fontSize={fs} textAnchor="middle" className="corner-label">
                L
              </text>
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}
