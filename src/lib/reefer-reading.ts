/**
 * The temperature in a reefer photo's caption, in °F: a number with a degree mark or F/C ("34F", "-10°", "2 C"), or
 * right after a word for the reading ("reads 34", "temp 34", "set at -10", "pulp 36"). A number naming something
 * else ("unit 12", "trailer 5301", "door 4", "#88") is never taken for it, and neither is one no reefer runs at.
 */
export function readingIn(text: string): number | null {
  const clean = text.replace(/\b(?:unit|truck|trailer|trl|door|dock|seal|load|ref|po|bol|appt|#)\s*#?\s*-?\d+(?:\.\d+)?/gi, " ");
  const unit = clean.match(/(-?\d{1,3}(?:\.\d)?)\s*(?:°\s*([FC])?|deg(?:rees)?\s*([FC])?\b|([FC])\b)/i);
  const worded = unit ? null : clean.match(/\b(?:reefer|reads?|reading|temp(?:erature)?|set(?: at)?|at|is|pulp|box|showing|shows)\s*(?:is|at|of|:)?\s*(-?\d{1,3}(?:\.\d)?)\b/i);
  if (!unit && !worded) return null;
  const n = Number(unit ? unit[1] : worded![1]);
  const scale = (unit?.[2] ?? unit?.[3] ?? unit?.[4])?.toUpperCase();
  const f = scale === "C" ? Math.round((n * 9) / 5 + 32) : n;
  // Reefers run from about -30°F (frozen) to 70°F (produce kept cool); anything else is a misread.
  return Number.isFinite(f) && f >= -40 && f <= 80 ? f : null;
}
