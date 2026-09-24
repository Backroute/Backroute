import { placeCoords, roadMiles } from "./trip-geo";
import type { Lane, MoveKind, RunType } from "./types";

export const RUN_TYPES: RunType[] = ["intown", "local", "regional", "otr"];

export const RUN_TYPE_LABEL: Record<RunType, string> = { intown: "In town", local: "Local", regional: "Regional", otr: "Long haul" };

export const RUN_TYPE_DETAIL: Record<RunType, string> = {
  intown: "Home every night, several short moves a day inside the metro",
  local: "Home every night, loads within about 150 miles",
  regional: "Home on weekends, loads within about 550 miles",
  otr: "Out one to three weeks at a time, loads anywhere",
};

/** How far from home each kind of driver works, by road. */
const RADIUS_MILES: Record<RunType, number> = { intown: 40, local: 150, regional: 550, otr: Infinity };

export const MOVE_LABEL: Record<MoveKind, string> = {
  container_pickup: "Container pickup",
  empty_return: "Empty return",
  warehouse_transfer: "Warehouse transfer",
  store_delivery: "Store delivery",
};

/** Home-time choices that make sense for each kind of run. */
export const HOME_TIME_OPTIONS: Record<RunType, string[]> = {
  intown: ["Home every night"],
  local: ["Home every night"],
  regional: ["Home by Friday", "Home by Saturday", "Home by Sunday"],
  otr: ["Home in 1 week", "Home in 2 weeks", "Home in 3 weeks"],
};

/** Whether a lane is work this driver would actually take: the right kind of work, both ends inside their radius, and
 *  for a local driver a run short enough to still get home the same night. */
export function laneFits(lane: Lane, runType: RunType, homeBase: string): boolean {
  // In-town moves need a day cab and a container chassis: they're in-town drivers' work and nobody else's.
  if (!!lane.moveKind !== (runType === "intown")) return false;
  if (runType === "otr") return true;
  const [city, state] = homeBase.split(", ");
  const home = placeCoords(city, state);
  const from = placeCoords(lane.origin, lane.originState);
  const to = placeCoords(lane.destination, lane.destState);
  if (!home || !from || !to) return false;
  const radius = RADIUS_MILES[runType];
  if (runType === "local" && lane.miles > 200) return false;
  return roadMiles(home, from) <= radius && roadMiles(home, to) <= radius;
}
