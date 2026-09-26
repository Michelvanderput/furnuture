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

let classifier: Promise<Classifier> | null = null;

export type Progress = (message: string) => void;

function getClassifier(onProgress?: Progress): Promise<Classifier> {
  classifier ??= import(/* webpackIgnore: true */ TRANSFORMERS_URL).then((t) =>
    t.pipeline("zero-shot-image-classification", MODEL, {
      dtype: "q8",
      progress_callback: (p: { status: string; file?: string; progress?: number }) => {
        if (p.status === "progress" && p.file?.endsWith(".onnx")) {
          onProgress?.(`AI-model downloaden… ${Math.round(p.progress ?? 0)}%`);
        }
      },
    }),
  );
  classifier.catch(() => (classifier = null));
  return classifier;
}

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
