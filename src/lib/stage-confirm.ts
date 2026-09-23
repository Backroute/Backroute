import { Camera, CheckCircle2, MapPin } from "lucide-react";

/** Stages where confirming is also the moment a document gets captured — shared between the Home
 *  card and the load detail page so both surfaces agree on what each stage's action does. */
export const STAGE_CONFIRM: Partial<Record<string, { label: string; swipe: string; icon: typeof CheckCircle2; doc?: "bol" | "pod" }>> = {
  dispatched: { label: "Confirm arrived at pickup", swipe: "Swipe to arrive at pickup", icon: MapPin },
  at_pickup: { label: "Capture BOL & confirm loaded", swipe: "Swipe when loaded · BOL", icon: Camera, doc: "bol" },
  in_transit: { label: "Confirm arrived at delivery", swipe: "Swipe to arrive at delivery", icon: MapPin },
  at_delivery: { label: "Capture POD & confirm delivered", swipe: "Swipe to complete · POD", icon: Camera, doc: "pod" },
};
