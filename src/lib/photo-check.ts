/**
 * A quick look at a document photo before it's sent, on the phone: too dark, or too blurry to read. Read from a small
 * copy of the picture (brightness, and how sharp its edges are), so the driver retakes it at the dock instead of
 * hearing about it hours later. PDFs and anything the browser can't open pass.
 */
type PhotoVerdict = { ok: true } | { ok: false; why: "dark" | "blurry" | "bright" };

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
    let sum = 0;
    for (let i = 0; i < w * h; i++) {
      const g = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
      gray[i] = g;
      sum += g;
    }
    const mean = sum / (w * h);
    if (mean < 45) return { ok: false, why: "dark" };
    if (mean > 245) return { ok: false, why: "bright" };
    // Sharpness: how much the picture changes from pixel to pixel (the variance of a Laplacian).
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
    const variance = lsq / n - (lsum / n) ** 2;
    return variance < 40 ? { ok: false, why: "blurry" } : { ok: true };
  } catch {
    return { ok: true };
  }
}
