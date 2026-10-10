/**
 * A quick look at a document photo before it's sent, on the phone: too dark, or too blurry to read. Read from a small
 * copy of the picture (brightness, and how sharp its edges are), so the driver retakes it at the dock instead of
 * hearing about it hours later. PDFs and anything the browser can't open pass.
 */
import { paperBox } from "./doc-scan";

type PhotoVerdict = { ok: true } | { ok: false; why: "dark" | "blurry" | "bright" };

/** What's wrong with one camera frame, for the live hint while the driver lines up the page: null when it looks good. */
export type FrameHint = "dark" | "bright" | "blurry" | "far";

/** Brightness, glare and sharpness of a gray picture (the variance of a Laplacian: low is blurry). */
export function grayStats(gray: ArrayLike<number>, w: number, h: number): { mean: number; glare: number; sharpness: number } {
  let sum = 0;
  let hot = 0;
  for (let i = 0; i < w * h; i++) {
    sum += gray[i];
    if (gray[i] > 250) hot++;
  }
  let n = 0;
  let lsum = 0;
  let lsq = 0;
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const l = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w];
      lsum += l;
      lsq += l * l;
      n++;
    }
  return { mean: sum / (w * h), glare: hot / (w * h), sharpness: n ? lsq / n - (lsum / n) ** 2 : 0 };
}

/**
 * The live hint for one small camera frame: too dark, glare, moving (blurry), or the page too small in the picture
 * (step closer, all of it in). Null: take it.
 */
export function frameHint(gray: Uint8ClampedArray, w: number, h: number): FrameHint | null {
  const { mean, glare, sharpness } = grayStats(gray, w, h);
  if (mean < 45) return "dark";
  if (mean > 245 || glare > 0.12) return "bright";
  if (sharpness < 40) return "blurry";
  const box = paperBox(gray, w, h);
  if (box && (box[2] - box[0]) * (box[3] - box[1]) < 0.35) return "far";
  return null;
}

export async function checkPhoto(file: Blob): Promise<PhotoVerdict> {
  if (!file.type.startsWith("image/") || typeof createImageBitmap === "undefined") return { ok: true };
  try {
    const bmp = await createImageBitmap(file);
    const w = 320;
    const h = Math.max(1, Math.round((bmp.height / bmp.width) * w));
    const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h });
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) return { ok: true };
    ctx.drawImage(bmp, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);
    const gray = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
    const { mean, sharpness } = grayStats(gray, w, h);
    if (mean < 45) return { ok: false, why: "dark" };
    if (mean > 245) return { ok: false, why: "bright" };
    return sharpness < 40 ? { ok: false, why: "blurry" } : { ok: true };
  } catch {
    return { ok: true };
  }
}
