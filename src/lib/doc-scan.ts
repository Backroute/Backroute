"use client";

/**
 * Makes a phone photo of a BOL, POD or receipt look scanned: finds the paper (the bright sheet against a darker
 * dashboard, dock floor or clipboard), crops to it, and lifts the contrast so it reads cleanly when the broker opens
 * it. Works on the phone, before upload; if it can't tell where the paper is, it only cleans up the contrast. PDFs
 * and anything that isn't a photo pass through untouched.
 */

const WORK = 400; // the size it looks at the photo in, for speed
const MAX_OUT = 2000; // longest side of the result

/** Otsu's threshold: the gray level that best splits paper from background. */
export function otsu(hist: number[], total: number): number {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return threshold;
}

/**
 * Where the paper is, as fractions of the image (left, top, right, bottom), or null when it fills the frame or
 * there's no clear sheet. From how much of each row and column is "paper bright", keeping the run around the middle.
 */
export function paperBox(gray: Uint8ClampedArray | number[], w: number, h: number): [number, number, number, number] | null {
  const hist = new Array(256).fill(0);
  for (const g of gray) hist[g]++;
  const t = otsu(hist, gray.length);
  const rows = new Array(h).fill(0);
  const cols = new Array(w).fill(0);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (gray[y * w + x] > t) {
        rows[y]++;
        cols[x]++;
      }
  const span = (counts: number[], len: number, other: number): [number, number] | null => {
    const on = counts.map((c) => c / other > 0.45);
    const mid = Math.floor(len / 2);
    if (!on[mid]) return null;
    let a = mid;
    let b = mid;
    while (a > 0 && on[a - 1]) a--;
    while (b < len - 1 && on[b + 1]) b++;
    return [a, b + 1];
  };
  const ys = span(rows, h, w);
  const xs = span(cols, w, h);
  if (!ys || !xs) return null;
  const box: [number, number, number, number] = [xs[0] / w, ys[0] / h, xs[1] / w, ys[1] / h];
  const area = (box[2] - box[0]) * (box[3] - box[1]);
  // Most of the frame already, or a sliver: nothing worth cropping.
  if (area > 0.92 || area < 0.15) return null;
  return box;
}

async function loadImage(file: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

export async function autoCrop(file: File): Promise<{ file: File; cropped: boolean }> {
  if (!file.type.startsWith("image/") || typeof document === "undefined") return { file, cropped: false };
  try {
    const img = await loadImage(file);
    const scale = WORK / Math.max(img.naturalWidth, img.naturalHeight);
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const small = document.createElement("canvas");
    small.width = w;
    small.height = h;
    const sctx = small.getContext("2d", { willReadFrequently: true });
    if (!sctx) return { file, cropped: false };
    sctx.drawImage(img, 0, 0, w, h);
    const px = sctx.getImageData(0, 0, w, h).data;
    const gray = new Uint8ClampedArray(w * h);
    for (let i = 0; i < w * h; i++) gray[i] = (px[i * 4] * 299 + px[i * 4 + 1] * 587 + px[i * 4 + 2] * 114) / 1000;
    const box = paperBox(gray, w, h);

    // A little margin so no text on the edge is lost.
    const pad = 0.012;
    const [l, t, r, b] = box ? [Math.max(0, box[0] - pad), Math.max(0, box[1] - pad), Math.min(1, box[2] + pad), Math.min(1, box[3] + pad)] : [0, 0, 1, 1];
    const sx = l * img.naturalWidth;
    const sy = t * img.naturalHeight;
    const sw = (r - l) * img.naturalWidth;
    const sh = (b - t) * img.naturalHeight;
    const out = Math.min(1, MAX_OUT / Math.max(sw, sh));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(sw * out);
    canvas.height = Math.round(sh * out);
    const ctx = canvas.getContext("2d");
    if (!ctx) return { file, cropped: false };
    // The scanned look: a touch brighter and more contrast, so faded carbon copies and pencil read.
    ctx.filter = "contrast(1.25) brightness(1.06) saturate(0.85)";
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.86));
    if (!blob) return { file, cropped: false };
    const name = file.name.replace(/\.[a-z0-9]+$/i, "") + "-scan.jpg";
    return { file: new File([blob], name, { type: "image/jpeg", lastModified: Date.now() }), cropped: !!box };
  } catch {
    return { file, cropped: false };
  }
}

/** Letter size, in PDF points. */
const PAGE_W = 612;
const PAGE_H = 792;

/**
 * Several photographed pages (a two-page BOL, a POD with a lumper slip stapled on) as one PDF, a page each, scaled to
 * fit a letter page the way a scanner would: brokers want one file per document, not three photos.
 */
export async function pagesToPdf(pages: File[], name: string): Promise<File> {
  const { PDFDocument } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  for (const page of pages) {
    const bytes = await (await jpegOf(page)).arrayBuffer();
    const img = await pdf.embedJpg(bytes);
    const scale = Math.min(PAGE_W / img.width, PAGE_H / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    pdf.addPage([PAGE_W, PAGE_H]).drawImage(img, { x: (PAGE_W - w) / 2, y: (PAGE_H - h) / 2, width: w, height: h });
  }
  const out = await pdf.save();
  return new File([out as BlobPart], name.replace(/\.[^.]+$/, "") + ".pdf", { type: "application/pdf", lastModified: Date.now() });
}

/** A photo as JPEG bytes (cropped pages already are; a PNG or HEIC-converted one goes through a canvas). */
async function jpegOf(file: File): Promise<Blob> {
  if (file.type === "image/jpeg") return file;
  const img = await loadImage(file);
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  canvas.getContext("2d")!.drawImage(img, 0, 0);
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.86));
  if (!blob) throw new Error("jpeg");
  return blob;
}
