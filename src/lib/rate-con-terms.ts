import { DETENTION_FREE_MIN, DETENTION_RATE_HR } from "./detention";
import type { Broker, Load } from "./types";

/** What the load says was agreed, for checking the broker's rate con against. Used in the browser and on the server. */
export function agreedTerms(load: Load, broker: Broker | undefined) {
  return {
    broker: broker?.company ?? "Unknown broker",
    // A change the broker agreed to pay for (an added stop, a reroute) is part of the rate now.
    rate: (load.bookedRate ?? load.targetRate) + (load.change?.status === "agreed" ? load.change.extra : 0),
    origin: `${load.lane.origin}, ${load.lane.originState}`,
    destination: `${load.lane.destination}, ${load.lane.destState}`,
    pickup: load.pickupWindow,
    delivery: load.deliveryWindow,
    equipment: load.equipmentType,
    detention: `${DETENTION_FREE_MIN / 60} hrs free, then $${DETENTION_RATE_HR}/hr`,
    paymentTerms: "Net 30",
  };
}
