import { isLightMode, runAi, type Img, type Progress } from "./worker";

/** Largest crop sent to the AI: MI-GAN works at 512 px internally, more only costs memory. */
const maxCrop = () => (isLightMode() ? 640 : 1024);

/**
 * Removes the masked area from the canvas (in place) with MI-GAN in a worker.
 * Only a crop with some context around the object is sent, so small objects keep
 * their detail and memory stays low; the result is blended back with a soft edge.
 */
export async function aiInpaint(canvas: HTMLCanvasElement, mask: Uint8Array, onProgress?: Progress): Promise<void> {
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

  // Crop with context around the object, clamped to the photo.
  const side = Math.max(x1 - x0, y1 - y0) * 2;
  const cw = Math.min(W, Math.max(256, side));
  const ch = Math.min(H, Math.max(256, side));
  const cx = Math.round(Math.min(Math.max(0, (x0 + x1) / 2 - cw / 2), W - cw));
  const cy = Math.round(Math.min(Math.max(0, (y0 + y1) / 2 - ch / 2), H - ch));
  const f = Math.min(1, maxCrop() / Math.max(cw, ch));
  const sw = Math.round(cw * f);
  const sh = Math.round(ch * f);

  const work = document.createElement("canvas");
  work.width = sw;
  work.height = sh;
  const wctx = work.getContext("2d", { willReadFrequently: true })!;
  wctx.drawImage(canvas, cx, cy, cw, ch, 0, 0, sw, sh);
  const image: Img = { data: wctx.getImageData(0, 0, sw, sh).data, width: sw, height: sh };
  // MI-GAN: 255 = keep, 0 = remove.
  const m = new Uint8Array(sw * sh);
  for (let y = 0; y < sh; y++) {
    const sy = Math.min(H - 1, Math.floor(cy + ((y + 0.5) * ch) / sh));
    for (let x = 0; x < sw; x++) {
      const sx = Math.min(W - 1, Math.floor(cx + ((x + 0.5) * cw) / sw));
      m[y * sw + x] = mask[sy * W + sx] ? 0 : 255;
    }
  }

  const out = await runAi<Img>({ task: "inpaint", image, mask: m }, onProgress, [image.data.buffer, m.buffer]);
  wctx.putImageData(new ImageData(new Uint8ClampedArray(out.data), out.width, out.height), 0, 0);

  // Blend back only inside the (softened) mask.
  const patch = document.createElement("canvas");
  patch.width = cw;
  patch.height = ch;
  const pctx = patch.getContext("2d")!;
  pctx.drawImage(work, 0, 0, out.width, out.height, 0, 0, cw, ch);
  const alpha = document.createElement("canvas");
  alpha.width = cw;
  alpha.height = ch;
  const actx = alpha.getContext("2d")!;
  const aimg = actx.createImageData(cw, ch);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) if (mask[(cy + y) * W + cx + x]) aimg.data[(y * cw + x) * 4 + 3] = 255;
  actx.putImageData(aimg, 0, 0);
  pctx.globalCompositeOperation = "destination-in";
  pctx.filter = `blur(${Math.max(1, W / 800)}px)`;
  pctx.drawImage(alpha, 0, 0);
  canvas.getContext("2d")!.drawImage(patch, cx, cy);
  // Free canvas memory immediately (Safari keeps backing stores around).
  for (const c of [work, patch, alpha]) c.width = c.height = 0;
}
