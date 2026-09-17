export interface Addon {
  id: string;
  name: string;
  tagline: string;
  /** "included": free, always on, no toggle. "commission": free to the carrier, opt-in — Backroute earns a partner referral commission instead of charging a fee. */
  model: "included" | "commission";
  commissionNote?: string;
}

/** The extra AI agents beyond dispatch — each one a real back-office job a human dispatcher doesn't do. */
export const ADDONS: Addon[] = [
  { id: "broker-shield", name: "Broker Shield AI", tagline: "Screens every broker for FMCSA authority and fraud risk before the AI will negotiate with them", model: "included" },
  { id: "driver-settlement-ai", name: "Driver Settlement AI", tagline: "Calculates driver pay per load and generates weekly settlement statements", model: "included" },
  { id: "maintenance-ai", name: "Maintenance AI", tagline: "Predicts service intervals and inspection deadlines from live mileage", model: "included" },
  { id: "insights-ai", name: "Insights AI", tagline: "Weekly coaching on your best lanes, brokers, and where to raise your rate floor", model: "included" },
  { id: "compliance-ai", name: "Compliance & IFTA AI", tagline: "Free quarterly IFTA mileage/tax estimate — filing is a flat $49/quarter, no subscription", model: "included" },
  {
    id: "factoring-ai",
    name: "Factoring AI",
    tagline: "Auto-submits invoices on delivery and gets you paid in 24 hours instead of 30-45 day broker terms",
    model: "commission",
    commissionNote: "Free to you — Backroute earns a referral commission from our factoring partner, not from your invoice.",
  },
  {
    id: "insurance-ai",
    name: "Insurance AI",
    tagline: "Tracks coverage and renewal dates, assists filing claims after an incident",
    model: "commission",
    commissionNote: "Free to you — Backroute earns a referral fee from the insurer when you bind coverage through this partner.",
  },
];

export const DEFAULT_ENABLED_ADDONS = ["factoring-ai", "insurance-ai"];

export function addonById(id: string): Addon | undefined {
  return ADDONS.find((a) => a.id === id);
}
