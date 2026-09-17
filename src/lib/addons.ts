export interface Addon {
  id: string;
  name: string;
  tagline: string;
  /** $/month */
  price: number;
}

/** The extra AI agents beyond dispatch — each one a real back-office job a human dispatcher doesn't do. */
export const ADDONS: Addon[] = [
  { id: "broker-shield", name: "Broker Shield AI", tagline: "Screens every broker for FMCSA authority and fraud risk before the AI will negotiate with them", price: 29 },
  { id: "factoring-ai", name: "Factoring AI", tagline: "Auto-submits invoices on delivery, tracks funding status, flags slow-paying brokers", price: 49 },
  { id: "driver-settlement-ai", name: "Driver Settlement AI", tagline: "Calculates driver pay per load and generates weekly settlement statements", price: 19 },
  { id: "maintenance-ai", name: "Maintenance AI", tagline: "Predicts service intervals and inspection deadlines from live mileage", price: 39 },
  { id: "insights-ai", name: "Insights AI", tagline: "Weekly coaching on your best lanes, brokers, and where to raise your rate floor", price: 25 },
  { id: "compliance-ai", name: "Compliance & IFTA AI", tagline: "Auto-assembles quarterly IFTA filings and tracks renewal deadlines", price: 59 },
  { id: "insurance-ai", name: "Insurance AI", tagline: "Tracks coverage and renewal dates, assists filing claims after an incident", price: 35 },
];

export const DEFAULT_ENABLED_ADDONS = ["broker-shield", "factoring-ai", "driver-settlement-ai", "maintenance-ai", "insights-ai"];

export function addonById(id: string): Addon | undefined {
  return ADDONS.find((a) => a.id === id);
}
