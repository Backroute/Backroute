/**
 * Rows of a CSV file, as cells: quoted cells may hold commas, line breaks and doubled quotes; blank lines are skipped.
 * `separators` also splits on tabs or semicolons (fuel card exports use either); `trim` trims each cell.
 */
export function parseCsv(text: string, opts: { separators?: string; trim?: boolean } = {}): string[][] {
  const seps = opts.separators ?? ",";
  const done = (cell: string) => (opts.trim ? cell.trim() : cell);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const endRow = () => {
    row.push(done(cell));
    if (row.some((x) => x.trim())) rows.push(row);
    row = [];
    cell = "";
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (seps.includes(c)) {
      row.push(done(cell));
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      endRow();
    } else cell += c;
  }
  endRow();
  return rows;
}

/** The same, as one object per row keyed by the header row's (trimmed) names. */
export function parseCsvRecords(text: string): Record<string, string>[] {
  const [header, ...body] = parseCsv(text);
  if (!header) return [];
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), r[i] ?? ""])));
}
