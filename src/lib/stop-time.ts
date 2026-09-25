/**
 * Appointment times are written in the stop's own local time. The state gives the time zone; a few states span two
 * (the western parts of Texas, Florida's panhandle, most of Indiana and so on), and the zone most of the freight is in
 * is used for those.
 */
const STATE_TZ: Record<string, string> = {
  AL: "America/Chicago", AK: "America/Anchorage", AZ: "America/Phoenix", AR: "America/Chicago", CA: "America/Los_Angeles",
  CO: "America/Denver", CT: "America/New_York", DE: "America/New_York", DC: "America/New_York", FL: "America/New_York",
  GA: "America/New_York", HI: "Pacific/Honolulu", ID: "America/Boise", IL: "America/Chicago", IN: "America/Indiana/Indianapolis",
  IA: "America/Chicago", KS: "America/Chicago", KY: "America/New_York", LA: "America/Chicago", ME: "America/New_York",
  MD: "America/New_York", MA: "America/New_York", MI: "America/Detroit", MN: "America/Chicago", MS: "America/Chicago",
  MO: "America/Chicago", MT: "America/Denver", NE: "America/Chicago", NV: "America/Los_Angeles", NH: "America/New_York",
  NJ: "America/New_York", NM: "America/Denver", NY: "America/New_York", NC: "America/New_York", ND: "America/Chicago",
  OH: "America/New_York", OK: "America/Chicago", OR: "America/Los_Angeles", PA: "America/New_York", RI: "America/New_York",
  SC: "America/New_York", SD: "America/Chicago", TN: "America/Chicago", TX: "America/Chicago", UT: "America/Denver",
  VT: "America/New_York", VA: "America/New_York", WA: "America/Los_Angeles", WV: "America/New_York", WI: "America/Chicago",
  WY: "America/Denver",
  // Canada, for cross-border runs.
  ON: "America/Toronto", QC: "America/Toronto", BC: "America/Vancouver", AB: "America/Edmonton", MB: "America/Winnipeg", SK: "America/Regina",
};

export const zoneFor = (state: string) => STATE_TZ[state.trim().toUpperCase()] ?? "America/Chicago";

/** Minutes the zone is ahead of UTC at that instant. */
function offsetMinutes(utc: number, zone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
      .formatToParts(new Date(utc))
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  return Math.round((asUtc - Math.floor(utc / 60000) * 60000) / 60000);
}

/** "2026-09-30T08:00" at a stop in `state` → an ISO instant, or null when it isn't a date and time. */
export function stopLocalToIso(local: string | null | undefined, state: string): string | null {
  const m = local?.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  const zone = zoneFor(state);
  // Two passes settle it on the right side of a daylight-saving change.
  let utc = wall - offsetMinutes(wall, zone) * 60000;
  utc = wall - offsetMinutes(utc, zone) * 60000;
  return new Date(utc).toISOString();
}

/** An ISO instant → "2026-09-30T08:00" at the stop, for a date-time input. */
export function isoToStopLocal(iso: string | undefined, state: string): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  return new Date(t + offsetMinutes(t, zoneFor(state)) * 60000).toISOString().slice(0, 16);
}

/** "Tue, Sep 30, 8:00 AM CDT" in the stop's local time, in the reader's language (a BCP-47 tag). */
export function formatAtStop(iso: string, state: string, locale = "en-US"): string {
  return new Intl.DateTimeFormat(locale, { timeZone: zoneFor(state), weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(iso));
}

/** The hour of the day (0–23) at the stop right now. */
export function hourAtStop(state: string, at = Date.now()): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: zoneFor(state), hour: "numeric", hourCycle: "h23" }).format(new Date(at)));
}
