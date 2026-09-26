"use client";

import { formatDims } from "@/lib/dimensions";
import type { CutoutMode, PlanItem, Product } from "@/lib/types";

interface Props {
  item: PlanItem;
  product?: Product;
  onChange: (patch: Partial<PlanItem>) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  /** Only in photos: show the visual options too. */
  visual?: boolean;
}

function Cm({ label, value, onCommit }: { label: string; value?: number; onCommit: (v: number | undefined) => void }) {
  return (
    <label className="row">
      {label}
      <input
        className="cm-input"
        key={value ?? "none"}
        inputMode="decimal"
        defaultValue={value ? String(Math.round(value)) : ""}
        placeholder="cm"
        onBlur={(e) => {
          const n = parseFloat(e.target.value.replace(",", "."));
          onCommit(Number.isFinite(n) && n > 0 ? n : undefined);
        }}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
    </label>
  );
}

/** Controls for a piece of furniture on the floor plan (used in the plan and in linked photos). */
export function PlanItemControls({ item, product, onChange, onRemove, onDuplicate, visual }: Props) {
  const rotate = (deg: number) => onChange({ angle: (((item.angle + deg) % 360) + 360) % 360 });
  return (
    <div className="layer-controls">
      <div className="row wrap">
        <strong>🗺️ {product?.title ?? "Meubel"}</strong>
        <span className="muted small">Staat op de plattegrond: zichtbaar in alle gekoppelde foto&apos;s.</span>
      </div>
      <div className="row wrap size-row">
        <Cm label="B" value={item.w} onCommit={(v) => v && onChange({ w: v })} />
        <Cm label="D" value={item.d} onCommit={(v) => v && onChange({ d: v })} />
        <Cm label="H" value={item.h} onCommit={(v) => onChange({ h: v })} />
        <span className="muted small">cm{product?.dims ? ` · product: ${formatDims(product.dims)}` : ""}</span>
      </div>
      <div className="row wrap">
        <button onClick={() => rotate(-90)} title="Kwartslag linksom">
          ⟲ 90°
        </button>
        <button onClick={() => rotate(-15)}>↺ 15°</button>
        <label className="row">
          Draaien
          <input type="range" min={0} max={359} value={Math.round(item.angle)} onChange={(e) => onChange({ angle: Number(e.target.value) })} />
        </label>
        <button onClick={() => rotate(15)}>↻ 15°</button>
        <button onClick={() => rotate(90)} title="Kwartslag rechtsom">
          ⟳ 90°
        </button>
      </div>
      {visual && (
        <div className="row wrap">
          <label className="row">
            Achtergrond
            <select value={item.cutout} onChange={(e) => onChange({ cutout: e.target.value as CutoutMode })}>
              <option value="simple">Weghalen</option>
              <option value="ai">Weghalen met AI</option>
              <option value="off">Laten staan</option>
            </select>
          </label>
          <label className="row">
            Schaduw
            <input type="range" min={0} max={1} step={0.05} value={item.shadow ?? 0.5} onChange={(e) => onChange({ shadow: Number(e.target.value) })} />
          </label>
          <label className="row">
            Licht
            <input type="range" min={0.5} max={1.3} step={0.01} value={item.light ?? 1} onChange={(e) => onChange({ light: Number(e.target.value) })} />
          </label>
          <label className="row">
            Warmte
            <input type="range" min={0} max={0.5} step={0.01} value={item.warmth ?? 0} onChange={(e) => onChange({ warmth: Number(e.target.value) })} />
          </label>
          <button onClick={() => onChange({ flip: !item.flip })}>↔ Spiegelen</button>
        </div>
      )}
      <div className="row wrap">
        <button onClick={onDuplicate}>⧉ Dupliceren</button>
        <button className="ghost" onClick={onRemove}>
          🗑 Verwijderen
        </button>
      </div>
    </div>
  );
}
