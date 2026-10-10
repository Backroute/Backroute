/** "30 minutes", "an hour and a half", "2 hours", "45": how late, in minutes, from what was said. */
export function minutesIn(heard: string): number | null {
  const h = heard.toLowerCase();
  if (/half an hour|half hour/.test(h) && !/hour and a half/.test(h)) return 30;
  if (/hour and a half|1\.5 hours?/.test(h)) return 90;
  if (/\ban hour\b|\bone hour\b/.test(h)) return 60;
  const hours = /(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/.exec(h);
  if (hours) return Math.round(Number(hours[1]) * 60);
  const mins = /(\d+)\s*(?:minutes?|mins?|m)\b/.exec(h) ?? /\b(\d{1,3})\b/.exec(h);
  const n = mins ? Number(mins[1]) : NaN;
  return n > 0 && n <= 600 ? n : null;
}
