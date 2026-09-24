export interface IntegrationItem {
  id: string;
  name: string;
  connected: boolean;
  /** What this specific provider does — distinct per item, not a repeated category description. */
  detail: string;
}

export interface IntegrationCategory {
  name: string;
  items: IntegrationItem[];
}

/** The real categories of tools a freight AI dispatcher has to plug into to actually source, book, and track loads. */
export const INTEGRATION_CATEGORIES: IntegrationCategory[] = [
  {
    name: "Load boards",
    items: [
      { id: "dat-one", name: "DAT One", connected: true, detail: "Largest spot-market board, primary source" },
      { id: "truckstop", name: "Truckstop.com", connected: true, detail: "Secondary board coverage + rate insight" },
      { id: "123loadboard", name: "123Loadboard", connected: false, detail: "Additional regional board coverage" },
    ],
  },
  {
    name: "ELD & tracking",
    items: [
      { id: "samsara", name: "Samsara", connected: true, detail: "GPS, HOS, and dash cam data" },
      { id: "motive", name: "Motive", connected: false, detail: "GPS and HOS data" },
      { id: "geotab", name: "Geotab", connected: false, detail: "Fleet telematics and HOS data" },
    ],
  },
  {
    name: "Factoring & payments",
    items: [
      { id: "triumph", name: "Triumph Business Capital", connected: true, detail: "Same-day invoice factoring" },
      { id: "rts-financial", name: "RTS Financial", connected: false, detail: "Next-day invoice factoring" },
    ],
  },
  {
    name: "Rate intelligence",
    items: [
      { id: "greenscreens", name: "Greenscreens.ai", connected: true, detail: "AI-powered lane rate benchmarking" },
      { id: "dat-rateview", name: "DAT RateView", connected: false, detail: "Historical rate benchmarking" },
    ],
  },
  {
    name: "Compliance & verification",
    items: [
      { id: "fmcsa-safer", name: "FMCSA SAFER", connected: true, detail: "Federal carrier & broker safety records" },
      { id: "highway", name: "Highway", connected: false, detail: "Automated broker fraud screening" },
    ],
  },
  {
    name: "Phone & text",
    items: [
      { id: "twilio", name: "Twilio", connected: false, detail: "Real calls and texts to drivers on the dispatch line" },
      { id: "telnyx", name: "Telnyx", connected: false, detail: "Carrier-grade voice and SMS for the dispatch line" },
    ],
  },
];
