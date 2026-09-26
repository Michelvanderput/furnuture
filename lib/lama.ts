import type { Progress } from "./ai";

/**
 * AI object removal with LaMa ("Resolution-robust Large Mask Inpainting", Apache-2.0),
 * run in the browser with onnxruntime-web (WebGPU when available, else WebAssembly).
 * The model is ~200 MB; it is downloaded once and kept in the browser's Cache Storage.
 */
const ORT_DIST = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/";
const MODEL_URL = "https://huggingface.co/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx";
const SIZE = 512;

/* eslint-disable @typescript-eslint/no-explicit-any */
type Ort = any;
type Session = any;

let session: Promise<{ ort: Ort; session: Session }> | null = null;

async function downloadModel(onProgress?: Progress): Promise<ArrayBuffer> {
  const cache = typeof caches !== "undefined" ? await caches.open("furnuture-models").catch(() => null) : null;
  const cached = await cache?.match(MODEL_URL);
  if (cached) return cached.arrayBuffer();

  const res = await fetch(MODEL_URL);
  if (!res.ok || !res.body) throw new Error(`Model downloaden mislukt (${res.status})`);
  const total = Number(res.headers.get("content-length")) || 208_000_000;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress?.(`AI-gum downloaden (eenmalig)… ${Math.min(100, Math.round((loaded / total) * 100))}%`);
  }
  const buffer = new Uint8Array(loaded);
  let offset = 0;
  for (const c of chunks) buffer.set(c, (offset += c.length) - c.length);
  await cache?.put(MODEL_URL, new Response(buffer, { headers: { "content-type": "application/octet-stream" } })).catch(() => undefined);
  return buffer.buffer;
}

function getSession(onProgress?: Progress) {
  session ??= (async () => {
    const ort: Ort = await import(/* webpackIgnore: true */ `${ORT_DIST}ort.webgpu.min.mjs`);
    ort.env.wasm.wasmPaths = ORT_DIST;
    const model = await downloadModel(onProgress);
    onProgress?.("AI-gum starten…");
    const providers = "gpu" in navigator ? ["webgpu", "wasm"] : ["wasm"];
    for (const ep of providers) {
      try {
        return { ort, session: await ort.InferenceSession.create(model, { executionProviders: [ep] }) };
      } catch (e) {
        if (ep === providers.at(-1)) throw e;
      }
    }
    throw new Error("Geen AI-backend beschikbaar");
  })();
  session.catch(() => (session = null));
  return session;
}

/**
 * Removes the masked area from the canvas (in place). Works on a square crop around
 * the mask so small objects keep full detail, then blends the result back in.
 */
export async function lamaInpaint(canvas: HTMLCanvasElement, mask: Uint8Array, onProgress?: Progress): Promise<void> {
  const W = canvas.width;
  const H = canvas.height;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let i = 0; i < W * H; i++) {
    if (!mask[i]) continue;
    const x = i % W, y = (i / W) | 0;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  if (x1 < 0) return;

  const { ort, session: s } = await getSession(onProgress);
  onProgress?.("AI gumt weg…");

  // Square crop with context around the object, clamped to the photo.
  const side = Math.min(Math.max(W, H), Math.max(SIZE, Math.max(x1 - x0, y1 - y0) * 1.8));
  const cw = Math.min(W, side);
  const ch = Math.min(H, side);
  const cx = Math.min(Math.max(0, (x0 + x1) / 2 - cw / 2), W - cw);
  const cy = Math.min(Math.max(0, (y0 + y1) / 2 - ch / 2), H - ch);

  const work = document.createElement("canvas");
  work.width = work.height = SIZE;
  const wctx = work.getContext("2d", { willReadFrequently: true })!;
  wctx.drawImage(canvas, cx, cy, cw, ch, 0, 0, SIZE, SIZE);
  const px = wctx.getImageData(0, 0, SIZE, SIZE);

  const image = new Float32Array(3 * SIZE * SIZE);
  const m = new Float32Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = y * SIZE + x;
      for (let c = 0; c < 3; c++) image[c * SIZE * SIZE + i] = px.data[i * 4 + c] / 255;
      const sx = Math.min(W - 1, Math.floor(cx + ((x + 0.5) * cw) / SIZE));
      const sy = Math.min(H - 1, Math.floor(cy + ((y + 0.5) * ch) / SIZE));
      m[i] = mask[sy * W + sx] ? 1 : 0;
    }
  }

  const [imageName, maskName] = s.inputNames.includes("mask")
    ? [s.inputNames.find((n: string) => n !== "mask"), "mask"]
    : s.inputNames;
  const out = await s.run({
    [imageName]: new ort.Tensor("float32", image, [1, 3, SIZE, SIZE]),
    [maskName]: new ort.Tensor("float32", m, [1, 1, SIZE, SIZE]),
  });
  const result: Float32Array = out[s.outputNames[0]].data;
  // This export returns 0..255; be tolerant of 0..1 exports too.
  let max = 0;
  for (let i = 0; i < result.length; i += 97) max = Math.max(max, result[i]);
  const k = max <= 1.5 ? 255 : 1;
  for (let i = 0; i < SIZE * SIZE; i++) {
    for (let c = 0; c < 3; c++) px.data[i * 4 + c] = result[c * SIZE * SIZE + i] * k;
    px.data[i * 4 + 3] = 255;
  }
  wctx.putImageData(px, 0, 0);

  // Blend back: only inside the (slightly feathered) mask.
  const patch = document.createElement("canvas");
  patch.width = W;
  patch.height = H;
  const pctx = patch.getContext("2d")!;
  pctx.drawImage(work, 0, 0, SIZE, SIZE, cx, cy, cw, ch);
  const alpha = document.createElement("canvas");
  alpha.width = W;
  alpha.height = H;
  const actx = alpha.getContext("2d")!;
  const aimg = actx.createImageData(W, H);
  for (let i = 0; i < W * H; i++) if (mask[i]) aimg.data[i * 4 + 3] = 255;
  actx.putImageData(aimg, 0, 0);
  pctx.globalCompositeOperation = "destination-in";
  pctx.filter = `blur(${Math.max(1, W / 800)}px)`;
  pctx.drawImage(alpha, 0, 0);
  canvas.getContext("2d")!.drawImage(patch, 0, 0);
  onProgress?.("");
}
