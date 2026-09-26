"use client";

import { memo, useEffect, useState } from "react";
import { categoryLabel } from "@/lib/categories";
import { fillFor } from "@/lib/layers";
import { PAINT_PRESETS } from "@/lib/paints";
import { FLOOR_PRESETS, presetTextureAsync } from "@/lib/textures";
import type { Product, SurfaceFill } from "@/lib/types";
import { Img } from "../Img";

interface Props {
  furniture: Product[];
  surfaces: Product[];
  onAddProduct: (p: Product) => void;
  onFill: (fill: SurfaceFill) => void;
}

/** Textures appear one by one while the browser is idle. */
function usePresetTextures() {
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    for (const f of FLOOR_PRESETS) presetTextureAsync(f.id).then((u) => alive && setUrls((m) => ({ ...m, [f.id]: u })));
    return () => {
      alive = false;
    };
  }, []);
  return urls;
}

/** Right-hand column. Memoised: it does not re-render while something is dragged. */
export const Palette = memo(function Palette({ furniture, surfaces, onAddProduct, onFill }: Props) {
  const textures = usePresetTextures();
  const sorted = [...furniture].sort((a, b) => Number(b.status === "favoriet") - Number(a.status === "favoriet"));
  return (
    <aside className="palette">
      <h3>Meubels</h3>
      {sorted.length === 0 && <p className="muted small">Voeg bij Producten meubels toe via een link.</p>}
      {sorted.map((p) => (
        <button key={p.id} className="palette-item" onClick={() => onAddProduct(p)} title={`${p.title} in de kamer zetten`}>
          <Img src={p.thumb ?? p.image} alt="" loading="lazy" />
          <span>
            {p.status === "favoriet" && "❤️ "}
            {p.title}
            <small>{categoryLabel(p.category)}</small>
          </span>
        </button>
      ))}

      <h3>Vloeren & wanden</h3>
      <p className="muted small">Tik eerst op een vloer of muur in de foto, dan hier.</p>
      {surfaces.map((p) => (
        <button key={p.id} className="palette-item" onClick={() => onFill(fillFor(p))}>
          {p.image ? <Img src={p.thumb ?? p.image} alt="" loading="lazy" /> : <i className="swatch" style={{ background: p.color }} />}
          <span>
            {p.title}
            <small>{categoryLabel(p.category)}</small>
          </span>
        </button>
      ))}

      <h4>Verfkleuren</h4>
      <div className="paints">
        {PAINT_PRESETS.map((c) => (
          <button
            key={c.color}
            className="paint"
            style={{ background: c.color }}
            title={c.label}
            aria-label={`Verf: ${c.label}`}
            onClick={() => onFill({ type: "color", color: c.color })}
          />
        ))}
      </div>

      <h4>Vloersoorten</h4>
      <div className="presets">
        {FLOOR_PRESETS.map((f) => (
          <button key={f.id} className="preset" title={f.label} onClick={() => onFill({ type: "preset", preset: f.id })}>
            {textures[f.id] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={textures[f.id]} alt="" />
            ) : (
              <i className="preset-placeholder" />
            )}
            <span>{f.label}</span>
          </button>
        ))}
      </div>
    </aside>
  );
});
