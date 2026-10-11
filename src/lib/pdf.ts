/**
 * A PDF of plain text lines, for invoices, pay statements and trip reports. Built by hand (PDF is text underneath) so
 * no library is needed. Uses the standard Helvetica fonts, which every PDF reader has; characters outside Latin-1
 * become "?". Lines that don't fit go on as many more pages as they need.
 */

export interface PdfLine {
  text: string;
  size?: number;
  bold?: boolean;
  /** Points from the left edge; default 56 (about 0.8 inch). */
  x?: number;
  /** Extra space above this line, in points. Negative puts it on the line above (a right-hand column). */
  gap?: number;
}

const esc = (s: string) =>
  s
    .replace(/[^\x20-\x7e\xa0-\xff]/g, "?")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");

const WIDTH = 612;
const HEIGHT = 792; // US Letter
const TOP = HEIGHT - 64;
const BOTTOM = 56;

/** The lines laid out page by page: each page's content stream. */
function pages(lines: PdfLine[]): string[] {
  const out: string[][] = [["BT"]];
  let y = TOP;
  lines.forEach((line, i) => {
    const size = line.size ?? 11;
    const step = (line.gap ?? 0) + size * 1.35;
    // A new page when this line won't fit, but never between a line and its right-hand column (negative gap).
    if (y - step < BOTTOM && step > 0) {
      out[out.length - 1].push("ET");
      out.push(["BT"]);
      y = TOP;
    }
    y -= i === 0 || y === TOP ? size * 1.35 : step;
    out[out.length - 1].push(`/${line.bold ? "F2" : "F1"} ${size} Tf 1 0 0 1 ${line.x ?? 56} ${y.toFixed(1)} Tm (${esc(line.text)}) Tj`);
  });
  out[out.length - 1].push("ET");
  const total = out.length;
  // Page numbers at the foot of each page, once there's more than one.
  if (total > 1) out.forEach((p, n) => p.splice(p.length - 1, 0, `/F1 8 Tf 1 0 0 1 ${WIDTH - 110} 32 Tm (Page ${n + 1} of ${total}) Tj`));
  return out.map((p) => p.join("\n"));
}

/** The PDF's bytes; works in the browser too (pay statements and trip reports are made on the phone). */
export function pdfBytes(lines: PdfLine[]): Uint8Array {
  const streams = pages(lines);
  const n = streams.length;
  // 1 catalog, 2 pages, 3 and 4 fonts, then a page object and its content stream for each page.
  const pageIds = streams.map((_, i) => 5 + i * 2);
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${n} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
  ];
  streams.forEach((stream, i) => {
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${WIDTH} ${HEIGHT}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageIds[i] + 1} 0 R >>`);
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  // Every character is Latin-1 (esc replaced the rest), so one character is one byte.
  return Uint8Array.from(out, (c) => c.charCodeAt(0));
}

export function textPdf(lines: PdfLine[]): Buffer {
  return Buffer.from(pdfBytes(lines));
}
