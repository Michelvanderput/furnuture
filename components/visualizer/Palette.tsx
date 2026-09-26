"use client";

import { memo, useEffect, useState } from "react";
import { categoryLabel, roomLabel } from "@/lib/categories";
import { euro } from "@/lib/shopping";
import { PasteButton } from "../PasteButton";
import { fillFor } from "@/lib/layers";
import { PAINT_PRESETS } from "@/lib/paints";
import { FLOOR_PRESETS, presetTextureAsync } from "@/lib/textures";
import type { Product, RoomType, SurfaceFill } from "@/lib/types";
import { Img } from "../Img";

interface Props {
  furniture: Product[];
  surfaces: Product[];
  onAddProduct: (p: Product) => void;
  onFill: (fill: SurfaceFill) => void;
  /** Paste a webshop link here: the product is fetched and placed in one go. */
  onAddLink: (url: string) => Promise<string | void>;
  /** Room of the current photo, to show its products first. */
  room?: RoomType;
  /** What this design uses, with the total price. */
  design: { items: { product: Product; count: number }[]; total: number; unknown: number };
  onFavoriteAll: () => void;
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
export const Palette = memo(function Palette({ furniture, surfaces, onAddProduct, onFill, onAddLink, room, design, onFavoriteAll }: Props) {
  const textures = usePresetTextures();
  const [query, setQuery] = useState("");
  const [onlyRoom, setOnlyRoom] = useState(false);
  const hasRooms = !!room && furniture.some((p) => p.room === room);
  const q = query.trim().toLowerCase();
  const shown = furniture
    .filter((p) => !q || `${p.title} ${p.shop} ${categoryLabel(p.category)}`.toLowerCase().includes(q))
    .filter((p) => !onlyRoom || !hasRooms || p.room === room || !p.room)
    // Favourites first, then what is meant for this room.
    .sort((a, b) => Number(b.status === "favoriet") - Number(a.status === "favoriet") || Number(b.room === room) - Number(a.room === room));
  return (
    <aside className="palette">
      <LinkAdder onAddLink={onAddLink} />

      {design.items.length > 0 && (
        <details className="design-list" open>
          <summary>
            In dit ontwerp <strong>{euro(design.total)}</strong>
          </summary>
          {design.items.map(({ product: p, count }) => (
            <div key={p.id} className="design-row">
              <span className="design-title" title={p.title}>
                {count > 1 && `${count}× `}
                {p.status === "favoriet" && "❤️ "}
                {p.title}
              </span>
              <span className="design-price">{p.price ?? "–"}</span>
              <a href={p.url} target="_blank" rel="noreferrer" aria-label={`${p.title} bij ${p.shop} bekijken`} title={`Bekijk bij ${p.shop}`}>
                ↗
              </a>
            </div>
          ))}
          {design.unknown > 0 && <p className="muted small">{design.unknown} zonder prijs (vul die in bij Producten).</p>}
          {design.items.some(({ product }) => product.status !== "favoriet") && (
            <button className="small" onClick={onFavoriteAll} title="Zet alles uit dit ontwerp op je boodschappenlijst">
              ❤️ Alles favoriet
            </button>
          )}
        </details>
      )}

      <h3>Meubels</h3>
      {furniture.length > 6 && (
        <input type="search" placeholder="Zoek (bank, IKEA, lamp…)" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Zoek meubels" />
      )}
      {hasRooms && (
        <label className="row small">
          <input type="checkbox" checked={onlyRoom} onChange={(e) => setOnlyRoom(e.target.checked)} />
          Alleen voor {roomLabel(room!).toLowerCase()}
        </label>
      )}
      {furniture.length === 0 && <p className="muted small">Plak hierboven een link van een meubel, of voeg ze toe bij Producten.</p>}
      {furniture.length > 0 && shown.length === 0 && <p className="muted small">Niets gevonden.</p>}
      {shown.map((p) => (
        <button key={p.id} className="palette-item" onClick={() => onAddProduct(p)} title={`${p.title} in de kamer zetten`}>
          <Img src={p.thumb ?? p.image} alt="" loading="lazy" />
          <span>
            {p.status === "favoriet" && "❤️ "}
            {p.title}
            <small>
              {categoryLabel(p.category)}
              {p.price && ` · ${p.price}`}
            </small>
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

/** Paste a link while decorating: fetched, added to Producten and put in the room. */
function LinkAdder({ onAddLink }: { onAddLink: (url: string) => Promise<string | void> }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const add = async (text = url) => {
    const link = text.match(/https?:\/\/[^\s<>"']+/i)?.[0];
    if (!link) return setMessage("Plak een link naar een product.");
    setBusy(true);
    setMessage("");
    try {
      setMessage((await onAddLink(link)) ?? "");
      setUrl("");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="link-adder stack">
      <input
          type="url"
          placeholder="Link van een meubel…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())}
          aria-label="Link van een product"
          enterKeyHint="go"
        />
      <div className="row">
        <PasteButton label="📋 Plak link" onPaste={(t) => add(t)} />
        <button className="primary" onClick={() => add()} disabled={busy || !url.trim()}>
          {busy ? "Ophalen…" : "Zet in kamer"}
        </button>
      </div>
      {message && <p className="small error">{message}</p>}
    </div>
  );
}
