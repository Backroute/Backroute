import type { Load } from "./types";

/** Average retail diesel by state this week, $/gal (demo data; live it comes from the fuel card's price feed). */
export const DIESEL_PRICE: Record<string, number> = {
  TX: 3.39, OK: 3.29, AR: 3.45, LA: 3.49, MS: 3.42, AL: 3.55, GA: 3.59, TN: 3.49, KY: 3.62, IL: 4.05, IN: 3.95,
  OH: 3.89, WV: 3.99, PA: 4.49, NJ: 3.95, NC: 3.69, SC: 3.55, FL: 3.75, MO: 3.39, CO: 3.79, WY: 3.59, UT: 3.89,
  NM: 3.65, AZ: 4.09, CA: 5.49, WA: 4.75, OR: 4.49,
};

const STATE_NAME: Record<string, string> = {
  TX: "Texas", OK: "Oklahoma", AR: "Arkansas", LA: "Louisiana", MS: "Mississippi", AL: "Alabama", GA: "Georgia", TN: "Tennessee",
  KY: "Kentucky", IL: "Illinois", IN: "Indiana", OH: "Ohio", WV: "West Virginia", PA: "Pennsylvania", NJ: "New Jersey",
  NC: "North Carolina", SC: "South Carolina", FL: "Florida", MO: "Missouri", CO: "Colorado", WY: "Wyoming", UT: "Utah",
  NM: "New Mexico", AZ: "Arizona", CA: "California", WA: "Washington", OR: "Oregon",
};

/** The states each lane's interstate route runs through, in order. */
const ROUTE_STATES: Record<string, string[]> = {
  "Dallas|Atlanta": ["TX", "LA", "MS", "AL", "GA"],
  "Chicago|Memphis": ["IL", "MO", "AR", "TN"],
  "Los Angeles|Phoenix": ["CA", "AZ"],
  "Columbus|Newark": ["OH", "WV", "PA", "NJ"],
  "Houston|Oklahoma City": ["TX", "OK"],
  "Charlotte|Orlando": ["NC", "SC", "GA", "FL"],
  "Denver|Salt Lake City": ["CO", "WY", "UT"],
  "Kansas City|Indianapolis": ["MO", "IL", "IN"],
  "Atlanta|Nashville": ["GA", "TN"],
  "Phoenix|Dallas": ["AZ", "NM", "TX"],
  "Seattle|Portland": ["WA", "OR"],
  "Memphis|Chicago": ["TN", "AR", "MO", "IL"],
  "Newark|Columbus": ["NJ", "PA", "WV", "OH"],
  "Nashville|Dallas": ["TN", "AR", "TX"],
  "Indianapolis|Kansas City": ["IN", "IL", "MO"],
  "Orlando|Charlotte": ["FL", "GA", "SC", "NC"],
  "Salt Lake City|Denver": ["UT", "WY", "CO"],
  "Oklahoma City|Houston": ["OK", "TX"],
};

/** Two 100-gallon saddle tanks; the plan never lets the truck run below a quarter tank. */
export const TANK_GALLONS = 200;
const RESERVE_GALLONS = 50;
/** In-network fuel card discount off the pump price. It varies by chain and location; this is a typical figure. */
export const CARD_DISCOUNT = 0.25;
const CHAINS = ["Pilot Flying J", "Love's"];

export interface FuelStop {
  state: string;
  stateName: string;
  chain: string;
  milesAhead: number;
  gallons: number;
  pricePerGal: number;
  cost: number;
}

export interface FuelPlan {
  startPct: number;
  milesLeft: number;
  gallonsNeeded: number;
  stops: FuelStop[];
  /** Against filling up at pump price wherever the tank hits a quarter. */
  savings: number;
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** Tank level for the demo, steady per load; live it's read from the engine through the ELD. */
export function startingTankPct(load: Load): number {
  return 40 + (hash(load.id) % 46);
}

/**
 * Where to buy fuel on the loaded run: at each state line, buy only enough to reach a cheaper state ahead, or fill
 * for the rest of the trip when nothing ahead is cheaper — always keeping a quarter tank in reserve. Fuel tax is
 * reconciled on the IFTA return by miles driven per state, so buying in a low-tax state doesn't cut tax; the
 * savings are pump price and card discount only.
 */
export function planFuel(load: Load, mpg: number, milesDone: number): FuelPlan | null {
  const states = ROUTE_STATES[`${load.lane.origin}|${load.lane.destination}`];
  if (!states) return null;
  const total = load.lane.miles;
  const segment = total / states.length;
  const milesLeft = Math.max(0, Math.round(total - milesDone));
  const startPct = startingTankPct(load);
  let fuel = (TANK_GALLONS * startPct) / 100;
  const gallonsNeeded = Math.round(milesLeft / mpg);

  // One in-network stop just past each state line still ahead; in the state the truck is in now, the next one on the road.
  const stations = states
    .map((st, i) => {
      const lineAt = i * segment + 15;
      const inThisState = milesDone >= lineAt && milesDone < (i + 1) * segment;
      return { state: st, i, price: (DIESEL_PRICE[st] ?? 3.9) - CARD_DISCOUNT, pos: inThisState ? milesDone + 5 : lineAt };
    })
    .filter((s) => s.pos > milesDone && s.pos < total - 20);
  const stops: FuelStop[] = [];
  const range = (TANK_GALLONS - RESERVE_GALLONS) * mpg;
  let pos = milesDone;
  for (let i = 0; i < stations.length; i++) {
    const st = stations[i];
    fuel -= (st.pos - pos) / mpg;
    pos = st.pos;
    const cheaper = stations.slice(i + 1).find((o) => o.price < st.price && o.pos - pos <= range);
    const target = cheaper ? cheaper.pos : total;
    const need = (target - pos) / mpg + RESERVE_GALLONS - fuel;
    const buy = Math.min(TANK_GALLONS - fuel, Math.max(0, need));
    const gallons = Math.round(buy / 5) * 5;
    if (gallons >= 10) {
      fuel += gallons;
      stops.push({
        state: st.state, stateName: STATE_NAME[st.state] ?? st.state, chain: CHAINS[(hash(load.id) + st.i) % CHAINS.length],
        milesAhead: Math.round(st.pos - milesDone), gallons, pricePerGal: st.price, cost: Math.round(gallons * st.price),
      });
    }
  }

  // The usual habit: drive until the tank hits a quarter, then fill up at pump price wherever that is.
  let habitFuel = (TANK_GALLONS * startPct) / 100;
  let habitGallons = 0;
  let habitCost = 0;
  for (let m = milesDone; m < total; m += 10) {
    habitFuel -= 10 / mpg;
    if (habitFuel <= RESERVE_GALLONS) {
      const st = states[Math.min(states.length - 1, Math.floor(m / segment))];
      const g = TANK_GALLONS - habitFuel;
      habitGallons += g;
      habitCost += g * (DIESEL_PRICE[st] ?? 3.9);
      habitFuel = TANK_GALLONS;
    }
  }
  const planGallons = stops.reduce((s, x) => s + x.gallons, 0);
  const planAvg = planGallons ? stops.reduce((s, x) => s + x.cost, 0) / planGallons : 0;
  const habitAvg = habitGallons ? habitCost / habitGallons : states.reduce((s, st) => s + (DIESEL_PRICE[st] ?? 3.9), 0) / states.length;
  const savings = planGallons ? Math.max(0, Math.round(planGallons * (habitAvg - planAvg))) : 0;

  return { startPct, milesLeft, gallonsNeeded, stops, savings };
}
