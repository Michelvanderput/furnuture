import { ROOMS } from "./categories";
import { proxied } from "./images";
import type { RoomType } from "./types";

/**
 * Free, in-browser AI: OpenAI's CLIP model via transformers.js (ONNX/WebAssembly).
 * No API key, no server cost; the model (~90 MB) is downloaded once and cached by the browser.
 */
const TRANSFORMERS_URL = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js";
const MODEL = "Xenova/clip-vit-base-patch32";

type Classifier = (
  image: string,
  labels: string[],
  options?: { hypothesis_template?: string },
) => Promise<{ label: string; score: number }[]>;

export type Progress = (message: string) => void;

const pipelines = new Map<string, Promise<unknown>>();

/* eslint-disable @typescript-eslint/no-explicit-any */
let transformers: Promise<any> | null = null;
/** The transformers.js module, loaded once from the CDN. */
export function loadTransformers(): Promise<any> {
  transformers ??= import(/* webpackIgnore: true */ TRANSFORMERS_URL);
  transformers.catch(() => (transformers = null));
  return transformers;
}

/** Loads (once) a transformers.js pipeline from the CDN. */
export function getPipeline<T>(task: string, model: string, onProgress?: Progress): Promise<T> {
  const key = `${task}:${model}`;
  if (!pipelines.has(key)) {
    const p = loadTransformers().then((t) =>
      t.pipeline(task, model, {
        dtype: "q8",
        progress_callback: (e: { status: string; file?: string; progress?: number }) => {
          if (e.status === "progress" && e.file?.endsWith(".onnx")) {
            onProgress?.(`AI-model downloaden… ${Math.round(e.progress ?? 0)}%`);
          }
        },
      }),
    );
    p.catch(() => pipelines.delete(key));
    pipelines.set(key, p);
  }
  return pipelines.get(key) as Promise<T>;
}

const getClassifier = (onProgress?: Progress) =>
  getPipeline<Classifier>("zero-shot-image-classification", MODEL, onProgress);

const LABELED = ROOMS.filter((r) => r.clip);

/** Guesses the room type of each photo. Calls onResult as soon as a photo is done. */
export async function classifyRooms(
  photos: { id: string; url: string }[],
  onResult: (id: string, room: RoomType) => void,
  onProgress?: Progress,
): Promise<void> {
  onProgress?.("AI-model laden…");
  const classify = await getClassifier(onProgress);
  const labels = LABELED.map((r) => r.clip);
  for (const [i, photo] of photos.entries()) {
    onProgress?.(`Foto ${i + 1} van ${photos.length} herkennen…`);
    const src = new URL(proxied(photo.url), window.location.href).toString();
    const [best] = await classify(src, labels, { hypothesis_template: "a photo of {}" });
    const room = LABELED.find((r) => r.clip === best.label)?.id ?? "overig";
    onResult(photo.id, room);
  }
  onProgress?.("");
}

/**
 * AI background removal (BRIA RMBG-1.4, ~45 MB, free for non-commercial use).
 * Much better than the colour-based cut-out for light furniture or sfeerfoto's.
 */
const RMBG_MODEL = "briaai/RMBG-1.4";

type RawImage = { toCanvas: () => HTMLCanvasElement | OffscreenCanvas };
type Remover = (image: string) => Promise<RawImage[]>;

export async function removeBackgroundAI(src: string, onProgress?: Progress): Promise<string> {
  const remove = await getPipeline<Remover>("background-removal", RMBG_MODEL, onProgress);
  const [out] = await remove(new URL(proxied(src), window.location.href).toString());
  const canvas = out.toCanvas();
  if ("toDataURL" in canvas) return canvas.toDataURL("image/png");
  const blob = await (canvas as OffscreenCanvas).convertToBlob({ type: "image/png" });
  return await new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}
