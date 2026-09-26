"use client";

import { formatDims } from "@/lib/dimensions";
import { centroid, rectQuad, rotateQuad, turnQuad } from "@/lib/geometry";
import { fillFor, SURFACE_CATEGORIES, surfaceDefaults } from "@/lib/layers";
import { formatCm, type FloorMetric } from "@/lib/metric";
import { FLOOR_PRESETS } from "@/lib/textures";
import type { CutoutMode, EraseLayer, Layer, MeasureLayer, Product, ProductLayer, SurfaceFill, SurfaceLayer } from "@/lib/types";
import { heavyAiAllowed } from "@/lib/worker";

export type LayerPatch = Partial<ProductLayer> | Partial<SurfaceLayer> | Partial<EraseLayer> | Partial<MeasureLayer>;

interface Props {
  layer: Layer;
  products: Product[];
  /** Floors in this photo that furniture can stand on. */
  floors: SurfaceLayer[];
  /** Real-world scale of the relevant floor (the product's floor, the line's floor, or this floor). */
  metric?: FloorMetric | null;
  /** Length of the selected measuring line, when its floor is measured. */
  lengthCm?: number | null;
  cutoutState?: string;
  onChange: (patch: LayerPatch) => void;
  onPlaceOnFloor: (floorId: string) => void;
  onRemove: () => void;
  onReorder: (dir: number) => void;
  onDuplicate: () => void;
}

const fillValue = (f: SurfaceFill) =>
  f.type === "none" ? "none:" : f.type === "color" ? `color:${f.color}` : f.type === "texture" ? `tex:${f.productId}` : `preset:${f.preset}`;

/** Number input that only reports on blur/enter (no re-render storm while typing). */
function CmInput({ value, onCommit, label }: { value?: number; onCommit: (cm: number | undefined) => void; label: string }) {
  return (
    <label className="row">
      {label}
      <input
        className="cm-input"
        inputMode="decimal"
        defaultValue={value ? String(Math.round(value)) : ""}
        key={value ?? "none"}
        placeholder="cm"
        onBlur={(e) => {
          const n = parseFloat(e.target.value.replace(",", "."));
          onCommit(Number.isFinite(n) && n > 0 ? n : undefined);
        }}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
      cm
    </label>
  );
}

export function LayerControls({
  layer,
  products,
  floors,
  metric,
  lengthCm,
  cutoutState,
  onChange,
  onPlaceOnFloor,
  onRemove,
  onReorder,
  onDuplicate,
}: Props) {
  if (layer.kind === "measure") {
    return (
      <div className="layer-controls row wrap">
        {layer.cm ? (
          <>
            <strong>📏 Meetlat</strong>
            <CmInput label="Echte lengte" value={layer.cm} onCommit={(cm) => cm && onChange({ cm })} />
            <span className="muted small">Hiermee kent de app de maat van deze vloer. Versleep de uiteinden precies op de randen.</span>
          </>
        ) : (
          <>
            <strong>📏 {lengthCm ? formatCm(lengthCm) : "Meting"}</strong>
            {!metric && <span className="muted small">Geef één lijn een echte lengte om te kunnen meten.</span>}
            <button onClick={() => onChange({ cm: lengthCm ? Math.round(lengthCm) : 100 })}>Maak dit de meetlat</button>
          </>
        )}
        <button className="ghost" onClick={onRemove}>
          🗑 Verwijderen
        </button>
      </div>
    );
  }


  if (layer.kind === "erase") {
    return (
      <div className="layer-controls row wrap">
        <strong>{layer.label ?? "Weggegumd"}</strong>
        <select value={layer.method} onChange={(e) => onChange({ method: e.target.value as EraseLayer["method"] })}>
          <option value="ai">AI-gum (mooiste resultaat)</option>
          <option value="simple">Snel (vervagen vanuit de omgeving)</option>
        </select>
        {!layer.mask && <span className="muted small">Versleep de punten om het gebied aan te passen.</span>}
        <button className="ghost" onClick={onRemove}>
          🗑 Terugzetten
        </button>
      </div>
    );
  }

  const lowMemory = !heavyAiAllowed();
  const order = (
    <>
      <button onClick={onDuplicate} title="Dupliceren (⌘/Ctrl + D)">
        ⧉ Dupliceren
      </button>
      <button onClick={() => onReorder(-1)} title="Naar achteren" aria-label="Naar achteren">
        ⬇
      </button>
      <button onClick={() => onReorder(1)} title="Naar voren" aria-label="Naar voren">
        ⬆
      </button>
      <button className="ghost" onClick={onRemove} title="Verwijderen (Delete)">
        🗑 Verwijderen
      </button>
    </>
  );

  if (layer.kind === "product") {
    const c = layer.corners;
    const product = products.find((p) => p.id === layer.productId);
    const dims = product?.dims;
    const trueSize = !!layer.floor?.widthCm;
    const straighten = () => {
      const [cx, cy] = centroid(c);
      const width = (Math.hypot(c[1][0] - c[0][0], c[1][1] - c[0][1]) + Math.hypot(c[2][0] - c[3][0], c[2][1] - c[3][1])) / 2;
      const height = width * layer.aspect;
      onChange({ corners: rectQuad(cx - width / 2, cy - height / 2, width, height) });
    };
    return (
      <div className="layer-controls">
        <div className="row wrap">
          <label className="row">
            Achtergrond
            <select value={layer.cutout} onChange={(e) => onChange({ cutout: e.target.value as CutoutMode })}>
              <option value="simple">Weghalen (snel)</option>
              {/* RMBG works at 1024×1024 and needs more memory than iPad Safari allows. */}
              <option value="ai" disabled={lowMemory}>
                Weghalen met AI (nauwkeurig){lowMemory ? " – niet op dit apparaat" : ""}
              </option>
              <option value="off">Laten staan</option>
            </select>
          </label>
          {layer.cutout === "simple" && (
            <label className="row" title="Lager = voorzichtiger. Verdwijnt er iets van het meubel? Zet hem lager.">
              Gevoeligheid
              <input
                type="range"
                min={4}
                max={60}
                value={layer.tolerance}
                onChange={(e) => onChange({ tolerance: Number(e.target.value) })}
              />
            </label>
          )}
          {cutoutState === "pending" && <small className="muted">bezig…</small>}
          {cutoutState === "failed:plain" && <small className="error">Geen effen achtergrond — kies AI.</small>}
          {cutoutState === "failed" && <small className="error">Uitknippen mislukt.</small>}
        </div>
        {layer.floor && (
          <div className="row wrap size-row">
            {metric ? (
              <>
                <label className="row" title="Teken het meubel op zijn echte maat, volgens de gemeten vloer">
                  <input
                    type="checkbox"
                    checked={trueSize}
                    onChange={(e) => onChange({ floor: { ...layer.floor!, widthCm: e.target.checked ? (dims?.w ?? 200) : undefined } })}
                  />
                  📐 Ware grootte
                </label>
                {trueSize && <CmInput label="Breedte" value={layer.floor.widthCm} onCommit={(cm) => cm && onChange({ floor: { ...layer.floor!, widthCm: cm } })} />}
                {dims && <span className="muted small">Productmaat: {formatDims(dims)}</span>}
                {trueSize && !dims?.w && <span className="muted small">Tip: vul bij Producten de maten in.</span>}
              </>
            ) : (
              <span className="muted small">📏 Meet de vloer (knop Meten) om dit meubel op ware grootte te zetten.</span>
            )}
          </div>
        )}
        {layer.floor ? (
          <div className="row wrap">
            <span className="small">✅ Staat op de vloer: schuif hem naar achteren en hij wordt vanzelf kleiner.</span>
            <label className="row" title="Draai het meubel op de vloer, bijvoorbeeld schuin in een hoek">
              Draaien op de vloer
              <input
                type="range"
                min={-60}
                max={60}
                value={layer.floor.angle}
                onChange={(e) => onChange({ floor: { ...layer.floor!, angle: Number(e.target.value) } })}
              />
            </label>
            <button onClick={() => onChange({ floor: undefined })}>Losmaken van vloer</button>
          </div>
        ) : (
          <div className="row wrap">
            {floors.length > 0 && (
              <button className="primary" onClick={() => onPlaceOnFloor(floors.at(-1)!.id)} title="Perspectief en diepte volgen de vloer">
                ⬇ Op de vloer zetten
              </button>
            )}
            <label className="row" title="Sleep de hoeken los om het meubel schuin of de diepte in te zetten">
              <input type="checkbox" checked={layer.distort} onChange={(e) => onChange({ distort: e.target.checked })} />
              Hoeken los
            </label>
            <button onClick={() => onChange({ corners: turnQuad(c, "left"), distort: true })} title="Linkerkant de diepte in">
              ◧ Links naar achteren
            </button>
            <button onClick={() => onChange({ corners: turnQuad(c, "right"), distort: true })} title="Rechterkant de diepte in">
              ◨ Rechts naar achteren
            </button>
            <button onClick={() => onChange({ corners: rotateQuad(c, -4) })} title="Draaien">
              ↺
            </button>
            <button onClick={() => onChange({ corners: rotateQuad(c, 4) })} title="Draaien">
              ↻
            </button>
            <button onClick={straighten}>Recht zetten</button>
          </div>
        )}
        <div className="row wrap">
          <label className="row" title="Zachte schaduw op de vloer">
            Schaduw
            <input type="range" min={0} max={1} step={0.05} value={layer.shadow ?? 0.5} onChange={(e) => onChange({ shadow: Number(e.target.value) })} />
          </label>
          <label className="row" title="Productfoto's zijn feller dan een kamer: maak hem wat donkerder">
            Licht
            <input type="range" min={0.5} max={1.3} step={0.01} value={layer.light ?? 1} onChange={(e) => onChange({ light: Number(e.target.value) })} />
          </label>
          <label className="row" title="Warmere kleur, passend bij het licht in de kamer">
            Warmte
            <input type="range" min={0} max={0.5} step={0.01} value={layer.warmth ?? 0} onChange={(e) => onChange({ warmth: Number(e.target.value) })} />
          </label>
          <label className="row" title="De kant van het meubel die van het raam af staat, wordt donkerder">
            Zijlicht
            <input type="range" min={0} max={1.5} step={0.05} value={layer.sideLight ?? 0.8} onChange={(e) => onChange({ sideLight: Number(e.target.value) })} />
          </label>
          <button onClick={() => onChange({ flip: !layer.flip })}>↔ Spiegelen</button>
          {order}
        </div>
      </div>
    );
  }

  const paints = products.filter((p) => p.color);
  const textures = products.filter((p) => p.image && SURFACE_CATEGORIES.has(p.category) && p.category !== "verf");
  const isTexture = layer.fill.type === "texture" || layer.fill.type === "preset";
  const realSize = layer.fill.type === "preset" && layer.autoScale !== false && layer.perspective && !!metric;

  return (
    <div className="layer-controls">
      <div className="row wrap">
        <select
          value={fillValue(layer.fill)}
          onChange={(e) => {
            const [type, value] = e.target.value.split(/:(.*)/s);
            const product = products.find((p) => p.id === value);
            const fill: SurfaceFill =
              type === "none"
                ? { type: "none" }
                : type === "preset"
                  ? { type: "preset", preset: value }
                  : type === "tex" && product
                    ? fillFor(product)
                    : { type: "color", color: value };
            onChange({
              fill,
              ...(fill.type !== layer.fill.type ? surfaceDefaults(fill) : {}),
              perspective: !!(layer.plane || layer.points.length === 4) && (fill.type === "preset" || fill.type === "texture"),
            });
          }}
        >
          {layer.fill.type === "color" && !paints.some((p) => p.color === (layer.fill as { color: string }).color) && (
            <option value={fillValue(layer.fill)}>🎨 Eigen kleur</option>
          )}
          {paints.length > 0 && (
            <optgroup label="Jouw verf">
              {paints.map((p) => (
                <option key={p.id} value={`color:${p.color}`}>
                  🎨 {p.title}
                </option>
              ))}
            </optgroup>
          )}
          {textures.length > 0 && (
            <optgroup label="Jouw vloeren, tegels & behang">
              {textures.map((p) => (
                <option key={p.id} value={`tex:${p.id}`}>
                  🪵 {p.title}
                </option>
              ))}
            </optgroup>
          )}
          {layer.role === "floor" && <option value="none:">Niets (alleen om te meten)</option>}
          <optgroup label="Vloersoorten">
            {FLOOR_PRESETS.map((f) => (
              <option key={f.id} value={`preset:${f.id}`}>
                {f.group}: {f.label}
              </option>
            ))}
          </optgroup>
        </select>
        {layer.fill.type === "color" && (
          <input type="color" value={layer.fill.color} onChange={(e) => onChange({ fill: { type: "color", color: e.target.value } })} />
        )}
        {(layer.plane || layer.points.length === 4) && isTexture && (
          <label className="row" title="Leg de textuur in perspectief; versleep de vierkante hoeken om de diepte bij te stellen">
            <input type="checkbox" checked={layer.perspective} onChange={(e) => onChange({ perspective: e.target.checked })} />
            Perspectief
          </label>
        )}
        {isTexture && (
          <button onClick={() => onChange({ rotate: !layer.rotate })} title="Planken of patroon een kwartslag draaien" aria-pressed={!!layer.rotate} className={layer.rotate ? "on" : ""}>
            ↻ Richting
          </button>
        )}
      </div>
      <div className="row wrap">
        {isTexture && (
          <label className="row" title={realSize ? "Staat op ware maat (gemeten vloer). Schuiven zet dat uit." : undefined}>
            Patroongrootte{realSize && " 📏"}
            <input
              type="range"
              min={5}
              max={1000}
              value={layer.scale}
              onChange={(e) => onChange({ scale: Number(e.target.value), autoScale: false })}
            />
          </label>
        )}
        {layer.fill.type === "preset" && layer.autoScale === false && metric && (
          <button onClick={() => onChange({ autoScale: true })}>📏 Op ware maat</button>
        )}
        {layer.fill.type === "texture" && (
          <label className="row" title="Gebruik alleen het midden van de productfoto (handig als het een sfeerfoto is)">
            Uitsnede
            <input
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={layer.crop}
              onChange={(e) => onChange({ crop: Number(e.target.value) })}
            />
          </label>
        )}
        {layer.fill.type !== "none" && (
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
        )}
        {layer.fill.type !== "none" && (
        <label className="row">
          <input
            type="checkbox"
            checked={layer.blend === "multiply"}
            onChange={(e) => onChange({ blend: e.target.checked ? "multiply" : "normal" })}
          />
          Schaduw behouden
        </label>
        )}
        {order}
      </div>
    </div>
  );
}
