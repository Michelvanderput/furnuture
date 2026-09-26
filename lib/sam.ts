import { AiSession, imagePixels, type Progress } from "./worker";

/**
 * Tap-to-select with SlimSAM (a slimmed-down Segment Anything, ~15 MB, free in
 * the browser). Tap an object and you get exactly that object; extra taps add
 * (+) or remove (−) parts. The photo is analysed once per photo, in a worker that
 * closes itself after 90 seconds without taps.
 */
const MODEL = "Xenova/slimsam-77-uniform";
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
    await this.session.run({ task: "samEmbed", image, model: MODEL }, onProgress, [image.data.buffer]);
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
  ): Promise<Uint8Array> {
    await this.prepare(photoUrl, onProgress);
    const { mask } = await this.session.run<{ mask: Uint8Array; score: number }>(
      {
        task: "samMask",
        points: points.map((p) => [p.at[0] * this.dims.w, p.at[1] * this.dims.h]),
        labels: points.map((p) => (p.positive ? 1 : 0)),
        outW,
        outH,
      },
      onProgress,
    );
    return mask;
  }

  close() {
    this.session.close();
    this.photo = null;
  }
}
