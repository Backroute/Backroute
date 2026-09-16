export interface IntegrationItem {
  id: string;
  name: string;
  connected: boolean;
}

export interface IntegrationCategory {
  name: string;
  blurb: string;
  items: IntegrationItem[];
}

/** The real categories of tools a freight AI dispatcher has to plug into to actually source, book, and track loads. */
export const INTEGRATION_CATEGORIES: IntegrationCategory[] = [
  {
    name: "Load boards",
    blurb: "Where the AI sources and posts for freight",
    items: [
      { id: "dat-one", name: "DAT One", connected: true },
      { id: "truckstop", name: "Truckstop.com", connected: true },
      { id: "123loadboard", name: "123Loadboard", connected: false },
    ],
  },
  {
    name: "ELD & tracking",
    blurb: "Live location, HOS, and check calls",
    items: [
      { id: "samsara", name: "Samsara", connected: true },
      { id: "motive", name: "Motive", connected: false },
      { id: "geotab", name: "Geotab", connected: false },
    ],
  },
  {
    name: "Factoring & payments",
    blurb: "Get paid on delivered loads faster than net-30",
    items: [
      { id: "triumph", name: "Triumph Business Capital", connected: true },
      { id: "rts-financial", name: "RTS Financial", connected: false },
    ],
  },
  {
    name: "Rate intelligence",
    blurb: "Live lane pricing the AI negotiates against",
    items: [
      { id: "greenscreens", name: "Greenscreens.ai", connected: true },
      { id: "dat-rateview", name: "DAT RateView", connected: false },
    ],
  },
  {
    name: "Compliance & verification",
    blurb: "Broker and carrier vetting before every booking",
    items: [
      { id: "fmcsa-safer", name: "FMCSA SAFER", connected: true },
      { id: "highway", name: "Highway", connected: false },
    ],
  },
];
