/**
 * Which truck takes which load, for the whole fleet at once: the pairing with the best total, not each load's nearest
 * truck in turn. Two trucks and two loads where the nearest-truck rule would send both trucks after the same load (or
 * strand the better one) come out right. The Hungarian method on a square table, padded with "no pair" cells.
 */

/** `value[i][j]` is what load i on truck j is worth, or null when that truck can't take it. Returns [load, truck] pairs. */
export function bestAssignment(value: (number | null)[][]): [number, number][] {
  const rows = value.length;
  const cols = rows ? Math.max(...value.map((r) => r.length)) : 0;
  if (!rows || !cols) return [];
  const n = Math.max(rows, cols);
  let top = 0;
  for (const r of value) for (const v of r) if (v !== null && v > top) top = v;
  // Costs to minimize: a real pair costs (top - value); a missing one costs more than any real pair could.
  const NONE = (top + 1) * 1000 + 1e6;
  const cost = (i: number, j: number) => {
    const v = i < rows ? value[i][j] : null;
    return v === null || v === undefined ? NONE : top - v;
  };
  // Potentials u (rows) and v (columns), p[j] = row matched to column j, 1-indexed with 0 as the free slot.
  const u = new Array<number>(n + 1).fill(0);
  const v = new Array<number>(n + 1).fill(0);
  const p = new Array<number>(n + 1).fill(0);
  const way = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array<number>(n + 1).fill(Infinity);
    const used = new Array<boolean>(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = cost(i0 - 1, j - 1) - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }
  const out: [number, number][] = [];
  for (let j = 1; j <= n; j++) {
    const i = p[j] - 1;
    const t = j - 1;
    if (i < rows && t < cols && value[i][t] !== null && value[i][t] !== undefined) out.push([i, t]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}
