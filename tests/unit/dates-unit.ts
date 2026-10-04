import { friendlyClock, stopDates } from "../../src/lib/load-dates";

// Noon UTC on Sunday, Oct 4 2026 (7 am in Dallas, 8 am in Atlanta); the load came in at 8 am UTC the same day.
const now = Date.UTC(2026, 9, 4, 12);
const createdAt = new Date(Date.UTC(2026, 9, 4, 8)).toISOString();
const lane = { originState: "TX", destState: "GA" };
let bad = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) bad++;
  console.log(ok ? "ok " : "BAD", name, "→", JSON.stringify(got));
};

eq("24-hour window", friendlyClock("9:00–17:00"), "9 am–5 pm");
eq("AM/PM window", friendlyClock("appointment 9:00 AM–10:30 AM"), "appointment 9 am–10:30 am");
eq("noon and midnight", friendlyClock("12:00–0:00"), "12 pm–12 am");

const a = stopDates({ pickupWindow: "tomorrow, 9:00–17:00", deliveryWindow: "Next day", createdAt, lane }, now);
eq("tomorrow pickup, in the dock's own zone", [a.pickup.date, a.pickup.relative, a.pickup.time], ["Mon, Oct 5", "Tomorrow", "9 am–5 pm CDT"]);
eq("next-day delivery counts from pickup", [a.delivery.date, a.delivery.relative, a.delivery.time], ["Tue, Oct 6", null, null]);

const b = stopDates({ pickupWindow: "today, 6:00–15:00", deliveryWindow: "2 day transit", createdAt, lane }, now);
eq("today pickup", [b.pickup.date, b.pickup.relative], ["Sun, Oct 4", "Today"]);
eq("2 day transit", b.delivery.date, "Tue, Oct 6");

const c = stopDates({ pickupWindow: "today, appointment 2:00 PM–3:00 PM", deliveryWindow: "Same day, by appointment", createdAt, lane }, now);
eq("appointment window gets the zone", c.pickup.time, "2 pm–3 pm CDT");
eq("same day by appointment", [c.delivery.date, c.delivery.relative, c.delivery.time], ["Sun, Oct 4", "Today", "By appointment"]);

const d = stopDates({ pickupWindow: "Tue, Oct 6, 2:00 PM CDT", deliveryWindow: "Thu, Oct 8, 8:00 AM EDT", createdAt, lane }, now);
eq("formatted stop times keep their own zone", [d.pickup.date, d.pickup.time, d.delivery.date, d.delivery.time], ["Tue, Oct 6", "2 pm CDT", "Thu, Oct 8", "8 am EDT"]);

const e = stopDates({ pickupWindow: "2026-10-09", deliveryWindow: "2026-10-10", createdAt, lane }, now);
eq("ISO dates", [e.pickup.date, e.delivery.date], ["Fri, Oct 9", "Sat, Oct 10"]);

const f = stopDates({ pickupWindow: "Ask the broker", deliveryWindow: "Ask the broker", createdAt, lane }, now);
eq("no date: keep the words", [f.pickup.date, f.pickup.raw], [null, "Ask the broker"]);

// A load that came in yesterday saying "tomorrow" picks up today.
const g = stopDates({ pickupWindow: "tomorrow, 8:00–12:00", deliveryWindow: "Same day", createdAt: new Date(Date.UTC(2026, 9, 3, 15)).toISOString(), lane }, now);
eq("words count from when the load came in", [g.pickup.date, g.pickup.relative], ["Sun, Oct 4", "Today"]);

// Exact appointments show at the stop: 19:00 UTC is 2 pm in Dallas and 3 pm in Atlanta.
const h = stopDates({ pickupWindow: "x", deliveryWindow: "x", pickupAt: "2026-10-05T19:00:00Z", deliveryAt: "2026-10-06T19:00:00Z", createdAt, lane }, now);
eq("appointments in each stop's zone", [h.pickup.date, h.pickup.time, h.delivery.date, h.delivery.time], ["Mon, Oct 5", "2 pm CDT", "Tue, Oct 6", "3 pm EDT"]);

// Late at night UTC it's still the evening before in Dallas: "today" there, not the UTC date.
const late = Date.UTC(2026, 9, 5, 3);
const i = stopDates({ pickupWindow: "today, 20:00–23:00", deliveryWindow: "Next day", createdAt: new Date(Date.UTC(2026, 9, 5, 2)).toISOString(), lane }, late);
eq("the stop's own calendar day", [i.pickup.date, i.pickup.relative, i.pickup.time], ["Sun, Oct 4", "Today", "8 pm–11 pm CDT"]);

console.log(bad ? `${bad} BAD` : "all ok");
