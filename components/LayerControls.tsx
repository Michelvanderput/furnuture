"use client";

import { centroid, rectQuad, rotateQuad, turnQuad } from "@/lib/geometry";
import { FLOOR_PRESETS } from "@/lib/textures";
import type { CutoutMode, EraseLayer, Layer, Product, ProductLayer, SurfaceFill, SurfaceLayer } from "@/lib/types";
import { fillFor, SURFACE_CATEGORIES, surfaceDefaults } from "@/lib/layers";

interface Props {
  layer: Layer;
  products: Product[];
  /** Floors in this photo that furniture can stand on. */
  floors: SurfaceLayer[];
  cutoutState?: string;
  onChange: (patch: Partial<ProductLayer> | Partial<SurfaceLayer> | Partial<EraseLayer>) => void;
  onPlaceOnFloor: (floorId: string) => void;
  onRemove: () => void;
  onReorder: (dir: number) => void;
}

const fillValue = (f: SurfaceFill) =>
  f.type === "color" ? `color:${f.color}` : f.type === "texture" ? `tex:${f.productId}` : `preset:${f.preset}`;

export function LayerControls({ layer, products, floors, cutoutState, onChange, onPlaceOnFloor, onRemove, onReorder }: Props) {
  if (layer.kind === "erase") {
    return (
      <div className="layer-controls row wrap">
        <strong>{layer.label ?? "Weggegumd"}</strong>
        <select value={layer.method} onChange={(e) => onChange({ method: e.target.value as EraseLayer["method"] })}>
          <option value="ai">AI-gum (LaMa, mooiste resultaat)</option>
          <option value="simple">Snel (vervagen vanuit de omgeving)</option>
        </select>
        {!layer.mask && <span className="muted small">Versleep de punten om het gebied aan te passen.</span>}
        <button className="ghost" onClick={onRemove}>
          🗑 Terugzetten
        </button>
      </div>
    );
  }

  const order = (
    <>
      <button onClick={() => onReorder(-1)} title="Naar achteren">
        ⬇
      </button>
      <button onClick={() => onReorder(1)} title="Naar voren">
        ⬆
      </button>
      <button className="ghost" onClick={onRemove}>
        🗑 Verwijderen
      </button>
    </>
  );

  if (layer.kind === "product") {
    const c = layer.corners;
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
              <option value="ai">Weghalen met AI (nauwkeurig)</option>
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
          <button onClick={() => onChange({ flip: !layer.flip })}>↔ Spiegelen</button>
          {order}
        </div>
      </div>
    );
  }

  const paints = products.filter((p) => p.color);
  const textures = products.filter((p) => p.image && SURFACE_CATEGORIES.has(p.category) && p.category !== "verf");
  const isTexture = layer.fill.type !== "color";

  return (
    <div className="layer-controls">
      <div className="row wrap">
        <select
          value={fillValue(layer.fill)}
          onChange={(e) => {
            const [type, value] = e.target.value.split(/:(.*)/s);
            const product = products.find((p) => p.id === value);
            const fill: SurfaceFill =
              type === "preset"
                ? { type: "preset", preset: value }
                : type === "tex" && product
                  ? fillFor(product)
                  : { type: "color", color: value };
            onChange({ fill, ...(fill.type !== layer.fill.type ? surfaceDefaults(fill) : {}) });
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
      </div>
      <div className="row wrap">
        {isTexture && (
          <label className="row">
            Patroongrootte
            <input type="range" min={30} max={1000} value={layer.scale} onChange={(e) => onChange({ scale: Number(e.target.value) })} />
          </label>
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
        {order}
      </div>
    </div>
  );
}
