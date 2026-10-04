import { zoneFor } from "./stop-time";

/**
 * Pickup and delivery as dates a person can plan around ("Tue, Oct 6"), from the free-text windows loads carry
 * ("tomorrow, 9:00–17:00", "Next day", "2 day transit", "Tue, Oct 6, 2:00 PM CDT"). Every day and time is the stop's
 * own, with its zone named, the way airlines print departures: a dock's hours are local to the dock. Words like
 * "tomorrow" were written when the load came in, so they count from then, not from now.
 */
export interface StopWhen {
  /** "Tue, Oct 6", or null when the window has no date in it (then `raw` is all there is). */
  date: string | null;
  /** "Today", "Tomorrow" or "Yesterday" at the stop, counted from now; null for other days. */
  relative: string | null;
  /** "9 am–5 pm CDT", "By appointment", or null. */
  time: string | null;
  raw: string;
}

const DAY = 86_400_000;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** The calendar day a moment falls on in a zone, as that date's UTC midnight (so days add as plain numbers). */
function dayIn(t: number, zone: string): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(new Date(t)).map((x) => [x.type, x.value]),
  );
  return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day));
}

/** "CDT", "EST": the zone's short name on that day (daylight time or not). */
function zoneName(day: number, zone: string): string {
  const part = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "short" }).formatToParts(new Date(day + 17 * 3600_000));
  return part.find((x) => x.type === "timeZoneName")?.value ?? "";
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
function parseDay(window: string, baseDay: number, today: number): { day: number; rest: string } | null {
  const w = window.trim();
  const rel = /^(today|tomorrow)\b,?\s*/i.exec(w);
  if (rel) return { day: baseDay + (rel[1].toLowerCase() === "tomorrow" ? DAY : 0), rest: w.slice(rel[0].length) };
  const iso = /^(\d{4})-(\d{2})-(\d{2})\b[T ,]*/.exec(w);
  if (iso) return { day: Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])), rest: w.slice(iso[0].length) };
  // "Tue, Oct 6, 2:00 PM CDT" or "Oct 6": no year, so the nearest one.
  const md = /^(?:[A-Za-z]{3},?\s+)?([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})\b,?\s*/.exec(w);
  const month = md ? MONTHS.indexOf(md[1].toLowerCase()) : -1;
  if (md && month >= 0) {
    const year = new Date(today).getUTCFullYear();
    const day = [year - 1, year, year + 1].map((y) => Date.UTC(y, month, Number(md[2]))).reduce((a, b) => (Math.abs(b - today) < Math.abs(a - today) ? b : a));
    return { day, rest: w.slice(md[0].length) };
  }
  return null;
}

function describe(day: number | null, rest: string, raw: string, zone: string, now: number): StopWhen {
  if (day === null) return { date: null, relative: null, time: null, raw };
  let time = rest.trim() ? friendlyClock(rest.trim().replace(/^by appointment$/i, "By appointment").replace(/^appointment\s+/i, "")) : null;
  // A clock time without a zone is the dock's own: say which zone that is.
  if (time && /\d (am|pm)/.test(time) && !/\b([A-Z]{1,2}[SD]?T|GMT[+-]?\d*)\b/.test(time)) time = `${time} ${zoneName(day, zone)}`;
  const diff = Math.round((day - dayIn(now, zone)) / DAY);
  const relative = diff === 0 ? "Today" : diff === 1 ? "Tomorrow" : diff === -1 ? "Yesterday" : null;
  const date = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).format(new Date(day));
  return { date, relative, time, raw };
}

/** An exact appointment: its day and time at the stop. */
function atStop(iso: string, zone: string): { day: number; rest: string } {
  const t = Date.parse(iso);
  return { day: dayIn(t, zone), rest: new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(t)) };
}

export function stopDates(
  load: { pickupWindow: string; deliveryWindow: string; createdAt: string; pickupAt?: string; deliveryAt?: string; lane: { originState: string; destState: string } },
  now = Date.now(),
): { pickup: StopWhen; delivery: StopWhen } {
  const fromZone = zoneFor(load.lane.originState);
  const toZone = zoneFor(load.lane.destState);
  const created = Date.parse(load.createdAt) || now;

  const p = load.pickupAt ? atStop(load.pickupAt, fromZone) : parseDay(load.pickupWindow, dayIn(created, fromZone), dayIn(now, fromZone));
  const pickup = describe(p?.day ?? null, p?.rest ?? "", load.pickupWindow, fromZone, now);

  let d: { day: number; rest: string } | null = null;
  const dw = load.deliveryWindow.trim();
  if (load.deliveryAt) d = atStop(load.deliveryAt, toZone);
  else if (p) {
    const same = /^same day\b,?\s*/i.exec(dw);
    const next = /^next day\b,?\s*/i.exec(dw);
    const transit = /^(\d+)\s*day transit\b,?\s*/i.exec(dw);
    if (same) d = { day: p.day, rest: dw.slice(same[0].length) };
    else if (next) d = { day: p.day + DAY, rest: dw.slice(next[0].length) };
    else if (transit) d = { day: p.day + Number(transit[1]) * DAY, rest: dw.slice(transit[0].length) };
  }
  d ??= parseDay(dw, dayIn(created, toZone), dayIn(now, toZone));
  const delivery = describe(d?.day ?? null, d?.rest ?? "", load.deliveryWindow, toZone, now);
  return { pickup, delivery };
}
