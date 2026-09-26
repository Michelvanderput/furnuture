/// <reference lib="webworker" />
/**
 * All AI models run in this worker. The page starts a fresh worker per job and
 * terminates it afterwards: WebAssembly memory is never returned while a worker
 * lives, and on iPad Safari the models together otherwise exceed the tab's memory.
 */
import { labelsFromLogits, samMaskToPhoto, toFloat32 } from "./labels";

/* eslint-disable @typescript-eslint/no-explicit-any */
const TRANSFORMERS_URL = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js";
const ORT_DIST = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/";
const MIGAN_URL = "https://huggingface.co/andraniksargsyan/migan/resolve/main/migan_pipeline_v2.onnx";

export type Img = { data: Uint8ClampedArray; width: number; height: number };

/**
 * `models` are candidates, strongest first: when one cannot be loaded (not
 * downloadable, not supported) the next one is tried. `gpu` asks for WebGPU,
 * with the WebAssembly CPU path as fallback. `gpuModels` are stronger models
 * tried first on a GPU with half precision (too heavy for the CPU path).
 */
export type Task = { gpu?: boolean; gpuModels?: string[] } & (
  | { task: "segment"; image: Img; models: string[]; outW: number; outH: number }
  | { task: "classify"; images: Img[]; labels: string[]; models: string[] }
  | { task: "removeBackground"; image: Img; models: string[] }
  | { task: "inpaint"; image: Img; mask: Uint8Array }
  | { task: "samEmbed"; image: Img; models: string[] }
  | { task: "samMask"; points: [number, number][]; labels: number[]; outW: number; outH: number }
);

/** How models run: WebGPU (fast, weights in GPU memory) or WebAssembly on the CPU (int8, works everywhere). */
type Run = { device: "webgpu" | "wasm"; dtype: "fp16" | "fp32" | "q8" };
const CPU: Run = { device: "wasm", dtype: "q8" };

/** WebGPU settings for this device, or null when there is no usable GPU. */
async function gpuRun(): Promise<Run | null> {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ features: Set<string> } | null> } }).gpu;
    const adapter = await gpu?.requestAdapter();
    if (!adapter) return null;
    return { device: "webgpu", dtype: adapter.features.has("shader-f16") ? "fp16" : "fp32" };
  } catch {
    return null;
  }
}

/**
 * Models loaded by this worker. The page reuses a worker for a run of jobs of
 * the same kind (three cut-outs in a row load the model once) and closes it
 * afterwards, which frees all of this.
 */
const loaded = new Map<string, Promise<any>>();
function keep<T>(key: string, load: () => Promise<T>): Promise<T> {
  let p = loaded.get(key);
  if (!p) {
    p = load();
    loaded.set(key, p);
    p.catch(() => loaded.delete(key));
  }
  return p;
}

/** Loads the first candidate model that works. */
async function firstModel<T = any>(models: string[], load: (id: string) => Promise<T>): Promise<T> {
  let error: unknown = new Error("Geen model opgegeven");
  for (const id of models) {
    try {
      return await load(id);
    } catch (e) {
      error = e;
      console.warn(`Model ${id} kon niet laden`, e);
    }
  }
  throw error;
}

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

async function segment({ image, models, outW, outH }: Extract<Task, { task: "segment" }>, run: Run) {
  const t = await transformers();
  progress("Kamer-herkenning laden…");
  const [processor, net, model] = await keep(`segment:${models}:${run.device}:${run.dtype}`, () =>
    firstModel(models, (model) =>
      Promise.all([
        t.AutoProcessor.from_pretrained(model),
        t.AutoModelForSemanticSegmentation.from_pretrained(model, { ...run, progress_callback: onDownload("Kamer-herkenning") }),
        model,
      ]),
    ),
  );
  progress("Meubels, muren en vloer herkennen…");
  const { logits } = await net(await processor(rawImage(t, image)));
  const [, classes, h, w] = logits.dims as number[];
  // fp16 on the GPU: read the logits back as float32.
  const data = toFloat32(logits);
  const classMap = labelsFromLogits(data, classes, h, w, outW, outH, Math.max(outW, outH));
  logits.dispose?.();
  return { result: { classMap, id2label: net.config.id2label, model }, transfer: [classMap.buffer] };
}

async function classify({ images, labels, models }: Extract<Task, { task: "classify" }>, run: Run) {
  const t = await transformers();
  const clip = await keep(`classify:${models}:${run.device}:${run.dtype}`, () =>
    firstModel(models, (model) => t.pipeline("zero-shot-image-classification", model, { ...run, progress_callback: onDownload("AI-model") })),
  );
  const out: string[] = [];
  for (const [i, img] of images.entries()) {
    progress(`Foto ${i + 1} van ${images.length} herkennen…`);
    const [best] = await clip(rawImage(t, img), labels, { hypothesis_template: "a photo of {}" });
    out.push(best.label);
  }
  return { result: out, transfer: [] };
}

async function removeBackground({ image, models }: Extract<Task, { task: "removeBackground" }>, run: Run) {
  const t = await transformers();
  const remove = await keep(`removeBackground:${models}:${run.device}:${run.dtype}`, () =>
    firstModel(models, (model) => t.pipeline("background-removal", model, { ...run, progress_callback: onDownload("Uitknip-AI") })),
  );
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
  const session = await keep("inpaint", async () => {
    const bytes = await modelBytes(MIGAN_URL, "AI-gum");
    progress("AI-gum starten…");
    return ort.InferenceSession.create(bytes, { executionProviders: ["wasm"] });
  });
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
  return { result: { data: rgba, width: ow, height: oh }, transfer: [rgba.buffer] };
}

// Tap-to-select (Segment Anything). The photo is analysed once ("embedding");
// every tap then only runs the small mask decoder, which takes a fraction of a second.
let sam: { processor: any; model: any; sizes: { original_sizes: any; reshaped_input_sizes: any }; emb: any } | null = null;

async function samEmbed({ image, models }: Extract<Task, { task: "samEmbed" }>, run: Run) {
  const t = await transformers();
  progress("Selecteer-AI laden…");
  // A new photo: free the previous photo's model and analysis first.
  await sam?.model.dispose?.();
  sam = null;
  const [processor, net] = await firstModel(models, (model) =>
    Promise.all([
      t.AutoProcessor.from_pretrained(model),
      t.SamModel.from_pretrained(model, {
        device: run.device,
        dtype: { vision_encoder: run.dtype, prompt_encoder_mask_decoder: "fp32" },
        progress_callback: onDownload("Selecteer-AI"),
      }),
    ]),
  );
  progress("Foto analyseren…");
  const inputs = await processor(rawImage(t, image));
  const emb = await net.get_image_embeddings(inputs);
  inputs.pixel_values?.dispose?.();
  sam = { processor, model: net, sizes: { original_sizes: inputs.original_sizes, reshaped_input_sizes: inputs.reshaped_input_sizes }, emb };
  return { result: { ok: true }, transfer: [] };
}

async function samMask({ points, labels, outW, outH }: Extract<Task, { task: "samMask" }>) {
  if (!sam) throw new Error("Selecteer-AI is niet voorbereid");
  const { processor, model, sizes, emb } = sam;
  const input_points = processor.reshape_input_points([points], sizes.original_sizes, sizes.reshaped_input_sizes);
  const input_labels = processor.add_input_labels([labels], input_points);
  const out = await model({ ...emb, input_points, input_labels });
  const scores = toFloat32(out.iou_scores);
  let best = 0;
  for (let i = 1; i < scores.length; i++) if (scores[i] > scores[best]) best = i;
  const [lh, lw] = (out.pred_masks.dims as number[]).slice(-2);
  const logits = toFloat32(out.pred_masks).subarray(best * lh * lw, (best + 1) * lh * lw);
  const [rh, rw] = sizes.reshaped_input_sizes[0] as [number, number];
  const mask = samMaskToPhoto(logits, rw, rh, outW, outH, lh, 1024);
  return { result: { mask, score: scores[best] }, transfer: [mask.buffer] };
}

type Handler = (t: Task, run: Run) => Promise<{ result: unknown; transfer: Transferable[] }>;
const handlers = { segment, classify, removeBackground, inpaint, samEmbed, samMask } as unknown as Record<Task["task"], Handler>;
/** Jobs whose models run through transformers.js and can use WebGPU. */
const GPU_TASKS = new Set<Task["task"]>(["segment", "classify", "removeBackground", "samEmbed"]);
/** How the SAM model of this worker was loaded (samMask runs on the same). */
let samRun: Run = CPU;

ctx.onmessage = async (e: MessageEvent<Task>) => {
  const job = e.data;
  const handler = handlers[job.task];
  let gpuFailed = false;
  try {
    let run: Run = job.task === "samMask" ? samRun : CPU;
    const gpu = job.gpu && GPU_TASKS.has(job.task) ? await gpuRun() : null;
    let out: Awaited<ReturnType<Handler>>;
    if (gpu) {
      try {
        const strong = gpu.dtype === "fp16" && job.gpuModels?.length && "models" in job ? { ...job, models: [...job.gpuModels, ...job.models] } : job;
        out = await handler(strong as Task, gpu);
        run = gpu;
      } catch (err) {
        // Not every model or browser works on WebGPU: redo the job on the CPU.
        console.warn("WebGPU failed, using the CPU", err);
        gpuFailed = true;
        progress("Overschakelen naar de processor…");
        out = await handler(job, CPU);
      }
    } else out = await handler(job, run);
    if (job.task === "samEmbed") samRun = run;
    ctx.postMessage({ type: "done", result: out.result, gpuFailed }, out.transfer);
  } catch (err) {
    ctx.postMessage({ type: "error", message: err instanceof Error ? err.message : String(err), gpuFailed });
  }
};
