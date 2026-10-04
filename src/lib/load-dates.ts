/**
 * Pickup and delivery as dates a person can plan around ("Tue, Oct 6"), from the free-text windows loads carry
 * ("tomorrow, 9:00–17:00", "Next day", "2 day transit", "Tue, Oct 6, 2:00 PM CDT"). Words like "tomorrow" were written
 * when the load came in, so they count from then, not from now.
 */
export interface StopWhen {
  /** "Tue, Oct 6", or null when the window has no date in it (then `raw` is all there is). */
  date: string | null;
  /** "Today", "Tomorrow" or "Yesterday", counted from now; null for other days. */
  relative: string | null;
  /** "9 am–5 pm", "By appointment", or null. */
  time: string | null;
  raw: string;
}

const DAY = 86_400_000;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function dayStart(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function addDays(day: number, n: number): number {
  const d = new Date(day);
  d.setDate(d.getDate() + n);
  return d.getTime();
}

/** "17:00" → "5 pm", "9:30 AM" → "9:30 am", in any window text. */
export function friendlyClock(text: string): string {
  return text.replace(/\b(\d{1,2}):(\d{2})(\s?([AaPp])[Mm])?\b/g, (_, h: string, m: string, _ap, ap?: string) => {
    let hour = Number(h);
    const pm = ap ? ap.toLowerCase() === "p" : hour >= 12;
    if (!ap) hour = hour % 12 || 12;
    return `${hour}${m === "00" ? "" : `:${m}`} ${pm ? "pm" : "am"}`;
  });
}

/** The day a window starts on, and what's left of the text after the date part. */
function parseDay(window: string, base: number, now: number): { day: number; rest: string } | null {
  const w = window.trim();
  const rel = /^(today|tomorrow)\b,?\s*/i.exec(w);
  if (rel) return { day: addDays(dayStart(base), rel[1].toLowerCase() === "tomorrow" ? 1 : 0), rest: w.slice(rel[0].length) };
  const iso = /^(\d{4})-(\d{2})-(\d{2})\b[T ,]*/.exec(w);
  if (iso) return { day: new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])).getTime(), rest: w.slice(iso[0].length) };
  // "Tue, Oct 6, 2:00 PM CDT" or "Oct 6": no year, so the nearest one.
  const md = /^(?:[A-Za-z]{3},?\s+)?([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})\b,?\s*/.exec(w);
  const month = md ? MONTHS.indexOf(md[1].toLowerCase()) : -1;
  if (md && month >= 0) {
    const year = new Date(now).getFullYear();
    const candidates = [year - 1, year, year + 1].map((y) => new Date(y, month, Number(md[2])).getTime());
    const day = candidates.reduce((a, b) => (Math.abs(b - now) < Math.abs(a - now) ? b : a));
    return { day, rest: w.slice(md[0].length) };
  }
  return null;
}

function describe(day: number | null, rest: string, raw: string, now: number): StopWhen {
  const time = rest.trim() ? friendlyClock(rest.trim().replace(/^by appointment$/i, "By appointment").replace(/^appointment\s+/i, "")) : null;
  if (day === null) return { date: null, relative: null, time: null, raw };
  const diff = Math.round((day - dayStart(now)) / DAY);
  const relative = diff === 0 ? "Today" : diff === 1 ? "Tomorrow" : diff === -1 ? "Yesterday" : null;
  const date = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" }).format(new Date(day));
  return { date, relative, time, raw };
}

export function stopDates(
  load: { pickupWindow: string; deliveryWindow: string; createdAt: string; pickupAt?: string; deliveryAt?: string },
  now = Date.now(),
): { pickup: StopWhen; delivery: StopWhen } {
  const base = Date.parse(load.createdAt) || now;
  const p = load.pickupAt ? { day: dayStart(Date.parse(load.pickupAt)), rest: "" } : parseDay(load.pickupWindow, base, now);
  const pickupTime = load.pickupAt ? new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(load.pickupAt)) : "";
  const pickup = describe(p?.day ?? null, p ? p.rest || pickupTime : "", load.pickupWindow, now);

  let d: { day: number; rest: string } | null = null;
  const dw = load.deliveryWindow.trim();
  if (load.deliveryAt) d = { day: dayStart(Date.parse(load.deliveryAt)), rest: "" };
  else if (p) {
    const same = /^same day\b,?\s*/i.exec(dw);
    const next = /^next day\b,?\s*/i.exec(dw);
    const transit = /^(\d+)\s*day transit\b,?\s*/i.exec(dw);
    if (same) d = { day: p.day, rest: dw.slice(same[0].length) };
    else if (next) d = { day: addDays(p.day, 1), rest: dw.slice(next[0].length) };
    else if (transit) d = { day: addDays(p.day, Number(transit[1])), rest: dw.slice(transit[0].length) };
  }
  d ??= parseDay(dw, base, now);
  const deliveryTime = load.deliveryAt ? new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(load.deliveryAt)) : "";
  const delivery = describe(d?.day ?? null, d ? d.rest || deliveryTime : "", load.deliveryWindow, now);
  return { pickup, delivery };
}
