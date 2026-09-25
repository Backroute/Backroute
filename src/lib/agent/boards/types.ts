import type { EquipmentType } from "../../types";
import type { FeedRow } from "../feeds";

/** What the AI looks for: loads near where a truck is (or will be empty), from a date, for its equipment. */
export interface BoardQuery {
  originCity: string;
  originState: string;
  /** Miles around the origin. */
  radius: number;
  /** When the truck is free: loads picking up from this day. */
  availableFrom: string;
  equipment: EquipmentType;
  /** Where the driver's home is, to prefer loads heading that way (a board may not filter on it). */
  towardState?: string;
}

/** A load a board found. Board loads often come with a phone number but no email: the AI books those by phone. */
export type BoardLoad = FeedRow & { boardId?: string };

export interface TruckPosting {
  unitNumber: string;
  equipment: EquipmentType;
  originCity: string;
  originState: string;
  availableAt: string;
  destinationState?: string;
  ratePerMile?: number;
}

export class BoardError extends Error {}

export interface Board {
  /** Shown in the log and on offers ("Truckstop · Reliable Freight"). */
  name: string;
  search(q: BoardQuery): Promise<BoardLoad[]>;
  postTruck?(t: TruckPosting): Promise<string | null>;
}
