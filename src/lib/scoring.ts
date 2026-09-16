import { clamp } from "./utils";

/** Backroute's flat take-rate, applied to every booked load regardless of plan. */
export const COMMISSION_RATE = 0.02;

export interface LoadEconomics {
  deadheadCost: number;
  commission: number;
  netProfit: number;
  rpm: number;
}

/** Real-time expense breakdown for a load at a given rate: fuel, tolls, deadhead, and our commission. */
export function computeEconomics(rate: number, miles: number, deadheadMiles: number, fuelCost: number, tollCost: number): LoadEconomics {
  const deadheadCost = Math.round(deadheadMiles * 0.68);
  const commission = Math.round(rate * COMMISSION_RATE);
  const netProfit = Math.round(rate - fuelCost - tollCost - deadheadCost - commission);
  const rpm = Math.round((rate / Math.max(miles, 1)) * 100) / 100;
  return { deadheadCost, commission, netProfit, rpm };
}

/**
 * Composite 0-100 AI load score — how a real dispatcher would judge the load, not just the dollar figure:
 * net margin after every expense (55%), rate vs. market (20%), deadhead efficiency (15%), broker reliability (10%).
 */
export function computeLoadScore(opts: {
  rate: number;
  netProfit: number;
  miles: number;
  deadheadMiles: number;
  rpm: number;
  marketRpm: number;
  brokerReliability: number;
}): number {
  const { rate, netProfit, miles, deadheadMiles, rpm, marketRpm, brokerReliability } = opts;

  const marginPct = rate > 0 ? netProfit / rate : 0;
  const profitScore = clamp(40 + marginPct * 100, 0, 100);

  const rateScore = clamp(((rpm / marketRpm - 0.85) / 0.35) * 100, 0, 100);

  const deadheadRatio = deadheadMiles / Math.max(miles + deadheadMiles, 1);
  const deadheadScore = clamp(100 - deadheadRatio * 250, 0, 100);

  const brokerScore = clamp(brokerReliability, 0, 100);

  const score = profitScore * 0.55 + rateScore * 0.2 + deadheadScore * 0.15 + brokerScore * 0.1;
  return Math.round(clamp(score, 1, 99));
}

export function scoreTone(score: number): "success" | "warning" | "danger" {
  if (score >= 78) return "success";
  if (score >= 55) return "warning";
  return "danger";
}

/** The one-line reason a dispatcher would give for liking a load — surfaces the dominant factor behind the score. */
export function loadHighlight(opts: {
  rpm: number;
  marketRpm: number;
  deadheadMiles: number;
  miles: number;
  brokerReliability: number;
  brokerTier: "preferred" | "standard" | "watch";
}): string {
  const { rpm, marketRpm, deadheadMiles, miles, brokerReliability, brokerTier } = opts;
  const deadheadRatio = deadheadMiles / Math.max(miles + deadheadMiles, 1);
  if (brokerTier === "preferred" && brokerReliability >= 90) return "Preferred broker — pays reliably";
  if (deadheadRatio < 0.03) return "Almost zero deadhead miles";
  if (rpm >= marketRpm * 1.05) return "Paying above market rate";
  if (brokerReliability >= 85) return "High-reliability broker";
  if (deadheadRatio < 0.1) return "Low deadhead — efficient lane";
  return "Solid overall fit for this truck";
}
