import { Camera, CheckCircle2, MapPin } from "lucide-react";

/** Stages where confirming is also the moment a document gets captured — shared between the Home
 *  card and the load detail page so both surfaces agree on what each stage's action does. */
export const STAGE_CONFIRM: Partial<Record<string, { label: string; icon: typeof CheckCircle2; doc?: "bol" | "pod" }>> = {
  dispatched: { label: "Confirm arrived at pickup", icon: MapPin },
  at_pickup: { label: "Capture BOL & confirm loaded", icon: Camera, doc: "bol" },
  in_transit: { label: "Confirm arrived at delivery", icon: MapPin },
  at_delivery: { label: "Capture POD & confirm delivered", icon: Camera, doc: "pod" },
};
