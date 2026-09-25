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

export function textPdf(lines: PdfLine[]): Buffer {
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
    `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`,
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
