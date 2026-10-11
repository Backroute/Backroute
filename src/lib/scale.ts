/**
 * A scale ticket's numbers against the usual limits for a five-axle tractor-trailer on the interstate: 34,000 lbs on
 * each tandem and 80,000 gross (federal), and 12,000 on the steer axle, which is what most steer tires and axles are
 * rated for. States and permits can differ, and the bridge formula can lower the gross for short wheelbases; this is
 * the quick check a driver does at the scale, not a legal ruling.
 */
export interface ScaleWeights {
  steer?: number;
  drives?: number;
  trailer?: number;
  gross: number;
}

export const SCALE_LIMITS = { steer: 12000, drives: 34000, trailer: 34000, gross: 80000 } as const;

export type ScalePart = keyof typeof SCALE_LIMITS;

/** What's over, by how many pounds, worst first. Gross is worked out from the axles when only they were typed. */
export function scaleOver(w: ScaleWeights): { part: ScalePart; over: number }[] {
  const gross = w.gross || (w.steer ?? 0) + (w.drives ?? 0) + (w.trailer ?? 0);
  const parts: [ScalePart, number | undefined][] = [["steer", w.steer], ["drives", w.drives], ["trailer", w.trailer], ["gross", gross]];
  return parts
    .filter((p): p is [ScalePart, number] => typeof p[1] === "number" && p[1] > SCALE_LIMITS[p[0]])
    .map(([part, lbs]) => ({ part, over: lbs - SCALE_LIMITS[part] }))
    .sort((a, b) => b.over - a.over);
}
