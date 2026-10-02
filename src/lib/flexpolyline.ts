/**
 * Decodes HERE's flexible polyline (the shape of a route in Routing v8 answers) into [lat, lng] points.
 * Format: https://github.com/heremaps/flexible-polyline (an unsigned varint header, then zig-zag varint deltas).
 */

const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const VALUE = new Map([...CHARS].map((c, i) => [c, i]));

function* varints(encoded: string): Generator<number> {
  let result = 0;
  let shift = 0;
  for (const c of encoded) {
    const v = VALUE.get(c);
    if (v === undefined) throw new Error("bad polyline");
    // Multiplication, not <<: values can pass 32 bits.
    result += (v & 0x1f) * 2 ** shift;
    if (v & 0x20) shift += 5;
    else {
      yield result;
      result = 0;
      shift = 0;
    }
  }
  if (shift) throw new Error("bad polyline");
}

const signed = (u: number) => (u % 2 ? -(u + 1) / 2 : u / 2);

export function decodeFlexPolyline(encoded: string): [number, number][] {
  const it = varints(encoded);
  const version = it.next().value;
  if (version !== 1) throw new Error("unsupported polyline version");
  const header = it.next().value as number;
  const factor = 10 ** (header & 15);
  const third = (header >> 4) & 7;
  const out: [number, number][] = [];
  let lat = 0;
  let lng = 0;
  for (;;) {
    const a = it.next();
    if (a.done) break;
    const b = it.next();
    if (b.done) throw new Error("bad polyline");
    lat += signed(a.value);
    lng += signed(b.value);
    if (third) it.next();
    out.push([lat / factor, lng / factor]);
  }
  return out;
}
