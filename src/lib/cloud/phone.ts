/**
 * Phone numbers as people type them, "(214) 555-0148" or "214.555.0148", to the +12145550148 form SMS sign-in
 * needs. A bare 10-digit number is taken as US/Canada; anything else needs its country code.
 */
export function toE164(input: string): string | null {
  const plus = input.trim().startsWith("+");
  const digits = input.replace(/\D/g, "");
  if (!plus && digits.length === 10) return `+1${digits}`;
  if (!plus && digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (plus && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return null;
}

/** +12145550148 → (214) 555-0148; other countries stay as typed. */
export function formatPhone(e164: string): string {
  const d = e164.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  return e164;
}
