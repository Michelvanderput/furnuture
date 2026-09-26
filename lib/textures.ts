/**
 * Built-in floor textures, drawn on a canvas (no image downloads, seamless tiles).
 */
export const FLOOR_PRESETS = [
  { id: "eiken-licht", label: "Eiken planken, licht", group: "Hout" },
  { id: "eiken-naturel", label: "Eiken planken, naturel", group: "Hout" },
  { id: "noten-donker", label: "Noten planken, donker", group: "Hout" },
  { id: "visgraat-naturel", label: "Visgraat, naturel eiken", group: "Hout" },
  { id: "visgraat-licht", label: "Visgraat, licht eiken", group: "Hout" },
  { id: "pvc-grijs", label: "PVC, grijs eiken", group: "PVC & laminaat" },
  { id: "beton", label: "Betonlook / gietvloer", group: "Steen" },
  { id: "tegel-60-grijs", label: "Tegel 60×60, grijs", group: "Steen" },
  { id: "tegel-wit", label: "Tegel 30×30, wit", group: "Steen" },
  { id: "portugees", label: "Cementtegels, zwart-wit", group: "Steen" },
  { id: "terrazzo", label: "Terrazzo", group: "Steen" },
  { id: "tapijt-beige", label: "Tapijt, beige", group: "Tapijt" },
] as const;

export type PresetId = (typeof FLOOR_PRESETS)[number]["id"];

// Small deterministic PRNG so a texture looks the same every time.
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

type Ctx = CanvasRenderingContext2D;

function grain(ctx: Ctx, x: number, y: number, w: number, h: number, rand: () => number, dark: string, count: number) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.strokeStyle = dark;
  for (let i = 0; i < count; i++) {
    const gy = y + rand() * h;
    ctx.globalAlpha = 0.05 + rand() * 0.12;
    ctx.lineWidth = 0.5 + rand() * 1.2;
    ctx.beginPath();
    ctx.moveTo(x - 10, gy);
    const amp = rand() * 2.5;
    for (let gx = x; gx <= x + w + 10; gx += 20) ctx.lineTo(gx, gy + Math.sin(gx / (30 + rand() * 40)) * amp);
    ctx.stroke();
  }
  ctx.restore();
}

function noise(ctx: Ctx, size: number, amount: number, rand: () => number) {
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rand() - 0.5) * amount;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

const shade = (hex: string, f: number) => {
  const n = parseInt(hex.slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.max(0, Math.min(255, Math.round(v * f))));
  return `rgb(${c.join(",")})`;
};

function planks(ctx: Ctx, size: number, base: string, rand: () => number) {
  const rows = 8;
  const rh = size / rows;
  for (let r = 0; r < rows; r++) {
    const tone = shade(base, 0.88 + rand() * 0.24);
    ctx.fillStyle = tone;
    ctx.fillRect(0, r * rh, size, rh);
    grain(ctx, 0, r * rh, size, rh, rand, shade(base, 0.55), 14);
    // One joint per row; the plank wraps around the tile edge so the tile is seamless.
    const joint = Math.round(rand() * size);
    ctx.fillStyle = shade(base, 0.6);
    ctx.fillRect(joint, r * rh, 1.5, rh);
    ctx.fillRect(0, r * rh, size, 1.2);
  }
}

/** Classic herringbone: planks L = 4W, drawn at 45°, on a lattice so the tile repeats. */
function herringbone(ctx: Ctx, size: number, base: string, rand: () => number) {
  const W = size / (4 * Math.SQRT2); // plank width
  const L = 4 * W;
  ctx.fillStyle = shade(base, 0.6);
  ctx.fillRect(0, 0, size, size);
  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.rotate(Math.PI / 4);
  // Lattice vectors of the herringbone (in plank units): a = (W, W), b = (L, -L).
  const tones: Record<string, string> = {};
  // One tile is 4 lattice steps high (i) and 1 step wide (j): tone may only depend on i mod 4.
  const toneFor = (i: number, _j: number, v: number) => {
    const key = `${((i % 4) + 4) % 4},${v}`;
    return (tones[key] ??= shade(base, 0.86 + rand() * 0.28));
  };
  const n = Math.ceil(size / W) + 4;
  for (let i = -n; i <= n; i++) {
    for (let j = -n; j <= n; j++) {
      const ox = i * W + j * L;
      const oy = i * W - j * L;
      if (Math.abs(ox) > size * 1.5 || Math.abs(oy) > size * 1.5) continue;
      // Horizontal plank at (ox, oy), vertical plank next to it.
      ctx.fillStyle = toneFor(i, j, 0);
      ctx.fillRect(ox + 0.6, oy + 0.6, L - 1.2, W - 1.2);
      ctx.fillStyle = toneFor(i, j, 1);
      ctx.fillRect(ox + L + 0.6, oy - L + W + 0.6, W - 1.2, L - 1.2);
    }
  }
  ctx.restore();
}

function tiles(ctx: Ctx, size: number, count: number, base: string, grout: string, rand: () => number, vary = 0.06) {
  const t = size / count;
  ctx.fillStyle = grout;
  ctx.fillRect(0, 0, size, size);
  for (let y = 0; y < count; y++)
    for (let x = 0; x < count; x++) {
      ctx.fillStyle = shade(base, 1 - vary / 2 + rand() * vary);
      ctx.fillRect(x * t + 1.5, y * t + 1.5, t - 3, t - 3);
    }
}

function cementTiles(ctx: Ctx, size: number) {
  const t = size / 2;
  ctx.fillStyle = "#f1eee7";
  ctx.fillRect(0, 0, size, size);
  for (let y = 0; y < 2; y++)
    for (let x = 0; x < 2; x++) {
      const cx = x * t + t / 2;
      const cy = y * t + t / 2;
      ctx.fillStyle = "#2b2b2b";
      ctx.beginPath();
      for (let k = 0; k < 8; k++) {
        const a = (k * Math.PI) / 4;
        const r = k % 2 ? t * 0.2 : t * 0.47;
        ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      }
      ctx.fill();
      ctx.fillStyle = "#f1eee7";
      ctx.beginPath();
      ctx.arc(cx, cy, t * 0.12, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#cfcac0";
      ctx.lineWidth = 2;
      ctx.strokeRect(x * t, y * t, t, t);
    }
}

function terrazzo(ctx: Ctx, size: number, rand: () => number) {
  ctx.fillStyle = "#e9e4dc";
  ctx.fillRect(0, 0, size, size);
  const colors = ["#b9a893", "#8d8a86", "#d9b8a3", "#6f6a65", "#f7f4ef", "#c7b299"];
  for (let i = 0; i < 260; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 1.5 + rand() * 6;
    ctx.fillStyle = colors[Math.floor(rand() * colors.length)];
    // Draw wrapped copies so chips crossing the edge continue on the other side.
    for (const dx of [-size, 0, size])
      for (const dy of [-size, 0, size]) {
        ctx.beginPath();
        ctx.ellipse(x + dx, y + dy, r, r * (0.5 + rand() * 0.5), rand() * Math.PI, 0, Math.PI * 2);
        ctx.fill();
      }
  }
}

const cache = new Map<string, string>();

export function presetTexture(id: string): string {
  const hit = cache.get(id);
  if (hit) return hit;
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const rand = rng([...id].reduce((s, c) => s * 31 + c.charCodeAt(0), 7));
  switch (id as PresetId) {
    case "eiken-licht": planks(ctx, size, "#d9bf98", rand); break;
    case "eiken-naturel": planks(ctx, size, "#b98b5a", rand); break;
    case "noten-donker": planks(ctx, size, "#6b4a33", rand); break;
    case "visgraat-naturel": herringbone(ctx, size, "#b98b5a", rand); break;
    case "visgraat-licht": herringbone(ctx, size, "#d8c09c", rand); break;
    case "pvc-grijs": planks(ctx, size, "#a39b91", rand); break;
    case "beton": ctx.fillStyle = "#a9a6a1"; ctx.fillRect(0, 0, size, size); noise(ctx, size, 26, rand); break;
    case "tegel-60-grijs": tiles(ctx, size, 2, "#8f8c88", "#6d6a66", rand); noise(ctx, size, 14, rand); break;
    case "tegel-wit": tiles(ctx, size, 4, "#f2f1ee", "#c9c6c0", rand, 0.03); break;
    case "portugees": cementTiles(ctx, size); noise(ctx, size, 8, rand); break;
    case "terrazzo": terrazzo(ctx, size, rand); break;
    case "tapijt-beige": ctx.fillStyle = "#cbbba3"; ctx.fillRect(0, 0, size, size); noise(ctx, size, 40, rand); break;
    default: ctx.fillStyle = "#b98b5a"; ctx.fillRect(0, 0, size, size);
  }
  const url = canvas.toDataURL("image/jpeg", 0.9);
  cache.set(id, url);
  return url;
}

export const presetLabel = (id: string) => FLOOR_PRESETS.find((p) => p.id === id)?.label ?? id;

// Generating a texture takes a few tens of ms; the palette shows 12 of them.
// Make them one at a time when the browser is idle, so the page never stutters.
let queue: Promise<unknown> = Promise.resolve();
const pending = new Map<string, Promise<string>>();
const whenIdle = (fn: () => void) => {
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
  if (w.requestIdleCallback) w.requestIdleCallback(fn, { timeout: 400 });
  else setTimeout(fn, 16);
};

export function presetTextureAsync(id: string): Promise<string> {
  const hit = cache.get(id);
  if (hit) return Promise.resolve(hit);
  if (!pending.has(id)) {
    const job = queue.then(() => new Promise<string>((resolve) => whenIdle(() => resolve(presetTexture(id)))));
    queue = job;
    pending.set(id, job);
  }
  return pending.get(id)!;
}
