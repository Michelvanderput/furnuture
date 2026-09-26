/// <reference lib="webworker" />
/**
 * All AI models run in this worker. The page starts a fresh worker per job and
 * terminates it afterwards: WebAssembly memory is never returned while a worker
 * lives, and on iPad Safari the models together otherwise exceed the tab's memory.
 */
import { labelsFromLogits } from "./labels";

/* eslint-disable @typescript-eslint/no-explicit-any */
const TRANSFORMERS_URL = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js";
const ORT_DIST = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/";
const MIGAN_URL = "https://huggingface.co/andraniksargsyan/migan/resolve/main/migan_pipeline_v2.onnx";

export type Img = { data: Uint8ClampedArray; width: number; height: number };

export type Task =
  | { task: "segment"; image: Img; model: string; outW: number; outH: number }
  | { task: "classify"; images: Img[]; labels: string[] }
  | { task: "removeBackground"; image: Img }
  | { task: "inpaint"; image: Img; mask: Uint8Array };

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const progress = (message: string) => ctx.postMessage({ type: "progress", message });

async function transformers(): Promise<any> {
  const t = await import(/* webpackIgnore: true */ TRANSFORMERS_URL);
  t.env.allowLocalModels = false;
  // One thread: extra threads each need their own memory, and Safari has no SharedArrayBuffer here anyway.
  t.env.backends.onnx.wasm.numThreads = 1;
  return t;
}

const onDownload = (label: string) => (e: { status: string; file?: string; progress?: number }) => {
  if (e.status === "progress" && e.file?.endsWith(".onnx")) progress(`${label} downloaden (eenmalig)… ${Math.round(e.progress ?? 0)}%`);
};

const rawImage = (t: any, img: Img) => new t.RawImage(img.data, img.width, img.height, 4);

async function segment({ image, model, outW, outH }: Extract<Task, { task: "segment" }>) {
  const t = await transformers();
  progress("Kamer-herkenning laden…");
  const [processor, net] = await Promise.all([
    t.AutoProcessor.from_pretrained(model),
    t.AutoModelForSemanticSegmentation.from_pretrained(model, { dtype: "q8", progress_callback: onDownload("Kamer-herkenning") }),
  ]);
  progress("Meubels, muren en vloer herkennen…");
  const { logits } = await net(await processor(rawImage(t, image)));
  const [, classes, h, w] = logits.dims as number[];
  const classMap = labelsFromLogits(logits.data as Float32Array, classes, h, w, outW, outH, Math.max(outW, outH));
  return { result: { classMap, id2label: net.config.id2label }, transfer: [classMap.buffer] };
}

async function classify({ images, labels }: Extract<Task, { task: "classify" }>) {
  const t = await transformers();
  const clip = await t.pipeline("zero-shot-image-classification", "Xenova/clip-vit-base-patch32", {
    dtype: "q8",
    progress_callback: onDownload("AI-model"),
  });
  const out: string[] = [];
  for (const [i, img] of images.entries()) {
    progress(`Foto ${i + 1} van ${images.length} herkennen…`);
    const [best] = await clip(rawImage(t, img), labels, { hypothesis_template: "a photo of {}" });
    out.push(best.label);
  }
  return { result: out, transfer: [] };
}

async function removeBackground({ image }: Extract<Task, { task: "removeBackground" }>) {
  const t = await transformers();
  const remove = await t.pipeline("background-removal", "briaai/RMBG-1.4", { dtype: "q8", progress_callback: onDownload("Uitknip-AI") });
  progress("Achtergrond weghalen…");
  const [out] = await remove(rawImage(t, image));
  const rgba = out.channels === 4 ? out : out.rgba();
  const data = new Uint8ClampedArray(rgba.data);
  return { result: { data, width: rgba.width, height: rgba.height }, transfer: [data.buffer] };
}

async function modelBytes(url: string, label: string): Promise<ArrayBuffer> {
  const cache = await caches.open("furnuture-models").catch(() => null);
  const hit = await cache?.match(url);
  if (hit) return hit.arrayBuffer();
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Model downloaden mislukt (${res.status})`);
  const total = Number(res.headers.get("content-length")) || 28_000_000;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    progress(`${label} downloaden (eenmalig)… ${Math.min(100, Math.round((loaded / total) * 100))}%`);
  }
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const c of chunks) (bytes.set(c, offset), (offset += c.length));
  await cache?.put(url, new Response(bytes)).catch(() => undefined);
  return bytes.buffer;
}

/** MI-GAN (27 MB, made for phones): uint8 image [1,3,H,W] + mask [1,1,H,W] (0 = remove) -> uint8 image. */
async function inpaint({ image, mask }: Extract<Task, { task: "inpaint" }>) {
  const ort: any = await import(/* webpackIgnore: true */ `${ORT_DIST}ort.wasm.min.mjs`);
  ort.env.wasm.wasmPaths = ORT_DIST;
  ort.env.wasm.numThreads = 1;
  const bytes = await modelBytes(MIGAN_URL, "AI-gum");
  progress("AI-gum starten…");
  const session = await ort.InferenceSession.create(bytes, { executionProviders: ["wasm"] });
  const { width: w, height: h, data } = image;
  const n = w * h;
  const chw = new Uint8Array(3 * n);
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) chw[c * n + i] = data[i * 4 + c];
  progress("AI gumt weg…");
  const [imageName, maskName] = session.inputNames.includes("mask")
    ? [session.inputNames.find((x: string) => x !== "mask"), "mask"]
    : session.inputNames;
  const out = await session.run({
    [imageName]: new ort.Tensor("uint8", chw, [1, 3, h, w]),
    [maskName]: new ort.Tensor("uint8", mask, [1, 1, h, w]),
  });
  const res = out[session.outputNames[0]];
  const [oh, ow] = res.dims.slice(-2) as number[];
  const on = oh * ow;
  const rgba = new Uint8ClampedArray(on * 4);
  const src = res.data as Uint8Array | Float32Array;
  const k = src instanceof Float32Array && src.reduce((m, v, i) => (i % 101 ? m : Math.max(m, v)), 0) <= 1.5 ? 255 : 1;
  for (let i = 0; i < on; i++) {
    for (let c = 0; c < 3; c++) rgba[i * 4 + c] = src[c * on + i] * k;
    rgba[i * 4 + 3] = 255;
  }
  await session.release?.();
  return { result: { data: rgba, width: ow, height: oh }, transfer: [rgba.buffer] };
}

const handlers = { segment, classify, removeBackground, inpaint } as const;

ctx.onmessage = async (e: MessageEvent<Task>) => {
  try {
    const { result, transfer } = await (handlers[e.data.task] as (t: Task) => Promise<{ result: unknown; transfer: Transferable[] }>)(e.data);
    ctx.postMessage({ type: "done", result }, transfer);
  } catch (err) {
    ctx.postMessage({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
