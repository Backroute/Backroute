/**
 * A one-page PDF of plain text lines, for invoices. Built by hand (PDF is text underneath) so no library is needed.
 * Uses the standard Helvetica fonts, which every PDF reader has; characters outside Latin-1 become "?".
 */

export interface PdfLine {
  text: string;
  size?: number;
  bold?: boolean;
  /** Points from the left edge; default 56 (about 0.8 inch). */
  x?: number;
  /** Extra space above this line, in points. */
  gap?: number;
}

const esc = (s: string) =>
  s
    .replace(/[^\x20-\x7e\xa0-\xff]/g, "?")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");

/** The PDF's bytes; works in the browser too (pay statements and trip reports are made on the phone). */
export function pdfBytes(lines: PdfLine[]): Uint8Array {
  const width = 612;
  const height = 792; // US Letter
  let y = height - 64;
  const ops: string[] = ["BT"];
  for (const line of lines) {
    const size = line.size ?? 11;
    y -= (line.gap ?? 0) + size * 1.35;
    if (y < 48) break;
    ops.push(`/${line.bold ? "F2" : "F1"} ${size} Tf 1 0 0 1 ${line.x ?? 56} ${y.toFixed(1)} Tm (${esc(line.text)}) Tj`);
  }
  ops.push("ET");
  const stream = ops.join("\n");

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
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
