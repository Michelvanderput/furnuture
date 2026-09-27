import { falReady } from "./fal";
import { falSelect } from "./falTasks";
import { AiSession, imagePixels, isLightMode, type Progress } from "./worker";

/**
 * Tap-to-select with SlimSAM (a slimmed-down Segment Anything, ~15 MB, free in
 * the browser). Tap an object and you get exactly that object; extra taps add
 * (+) or remove (−) parts. The photo is analysed once per photo, in a worker that
 * closes itself after 90 seconds without taps.
 */
/** SlimSAM-50 keeps twice the weights of SlimSAM-77 and traces edges better; 77 in light mode or as fallback. */
const MODELS = ["Xenova/slimsam-50-uniform", "Xenova/slimsam-77-uniform"];
const MODELS_LIGHT = ["Xenova/slimsam-77-uniform"];
/** SAM looks at 1024 px; sending more only costs memory. */
const INPUT_SIDE = 1024;

export class Selector {
  private session = new AiSession(90_000);
  private photo: string | null = null;
  private dims = { w: 0, h: 0 };

  private async prepare(photoUrl: string, onProgress?: Progress) {
    if (this.photo === photoUrl && this.session.active) return;
    const image = await imagePixels(photoUrl, INPUT_SIDE);
    this.dims = { w: image.width, h: image.height };
    await this.session.run({ task: "samEmbed", image, models: isLightMode() ? MODELS_LIGHT : MODELS }, onProgress, [image.data.buffer]);
    this.photo = photoUrl;
  }

  /**
   * Mask (outW×outH) of the object at the given points. Points are fractions of the
   * photo (0..1); positive points belong to the object, negative ones do not.
   */
  async select(
    photoUrl: string,
    points: { at: [number, number]; positive: boolean }[],
    outW: number,
    outH: number,
    onProgress?: Progress,
    /** Box around the object (fractions of the photo: x0, y0, x1, y1), e.g. from the room recognition. */
    box?: [number, number, number, number],
  ): Promise<Uint8Array> {
    // With fal set up: SAM 3 there (sharper, and nothing heavy on this device).
    if (falReady()) {
      try {
        return await falSelect(photoUrl, points, outW, outH, onProgress, box);
      } catch (e) {
        console.warn("fal select failed, selecting here", e);
        onProgress?.(`fal: ${e instanceof Error ? e.message : e} — nu zelf selecteren…`);
      }
    }
    const ask = () =>
      this.session.run<{ mask: Uint8Array; score: number }>(
        {
          task: "samMask",
          points: points.map((p) => [p.at[0] * this.dims.w, p.at[1] * this.dims.h]),
          labels: points.map((p) => (p.positive ? 1 : 0)),
          outW,
          outH,
          box: box && [box[0] * this.dims.w, box[1] * this.dims.h, box[2] * this.dims.w, box[3] * this.dims.h],
        },
        onProgress,
      );
    await this.prepare(photoUrl, onProgress);
    let mask: Uint8Array;
    try {
      ({ mask } = await ask());
    } catch (e) {
      // Only when the analysis is gone (worker closed to free memory for another AI job):
      // analyse again. Any other error would only fail again, a slow second time.
      if (this.session.active && !/niet voorbereid|Analyse verlopen|Geen analyse/.test(String(e))) throw e;
      this.photo = null;
      await this.prepare(photoUrl, onProgress);
      ({ mask } = await ask());
    }
    return mask;
  }

  close() {
    this.session.close();
    this.photo = null;
  }
}
