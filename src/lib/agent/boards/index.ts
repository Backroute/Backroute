import "server-only";
import type { Truck } from "../../types";
import { claimMark, type CarrierContext } from "../db";
import { pullFeed } from "../feeds";
import type { CustomBoardConfig, DatConfig, IntegrationRow, TruckstopConfig } from "../integrations";
import { customBoard } from "./custom";
import { datBoard, datConfigured } from "./dat";
import { truckstopBoard, truckstopConfigured } from "./truckstop";
import type { Board, BoardQuery } from "./types";

/**
 * Load boards, the way a dispatcher works them: for every truck that's empty or will be within a day and a half,
 * search near where it will be (so the reload is lined up before it delivers), and post it as available. Loads found
 * go through the same matching, broker check, pricing and booking as everything else; a poster with only a phone
 * number gets a call from the AI.
 */

const HOUR = 3600_000;
const SEARCH_EVERY = 30 * 60_000;
const RADIUS = 150;

export const isBoard = (kind: string) => kind === "truckstop" || kind === "dat" || kind.startsWith("board:");

/** The board a carrier connected, or null when Backroute's side of it isn't set up. */
export function boardFor(row: IntegrationRow): Board | null {
  if (row.kind === "truckstop") return truckstopConfigured() ? truckstopBoard((row.config as TruckstopConfig).integrationId) : null;
  if (row.kind === "dat") return datConfigured() ? datBoard((row.config as DatConfig).userEmail) : null;
  if (row.kind.startsWith("board:")) return customBoard(row.config as CustomBoardConfig);
  return null;
}

/** Where and when each truck will next be free, for trucks that have nothing lined up after that. */
export function whereTrucksFree(ctx: Pick<CarrierContext, "trucks" | "loads" | "drivers">, now: number): { truck: Truck; q: BoardQuery }[] {
  const out: { truck: Truck; q: BoardQuery }[] = [];
  for (const truck of ctx.trucks) {
    if (!truck.driverId || truck.status === "maintenance" || truck.nextLoadId) continue;
    if (ctx.loads.some((l) => l.truckId === truck.id && (l.stage === "negotiating" || l.stage === "booked"))) continue;
    const driver = ctx.drivers.find((d) => d.id === truck.driverId);
    const home = driver?.homeBase?.split(",").map((s) => s.trim());
    const busy = ctx.loads.find((l) => l.id === truck.currentLoadId && ["dispatched", "at_pickup", "in_transit", "at_delivery"].includes(l.stage));
    let q: BoardQuery;
    if (!busy) q = { originCity: truck.currentCity, originState: truck.currentState, radius: RADIUS, availableFrom: new Date(now).toISOString(), equipment: truck.equipmentType, towardState: home?.[1] };
    else {
      // Loaded: line up the reload near the delivery, for after it's done (if it delivers within a day and a half).
      const done = busy.deliveryAt ? Date.parse(busy.deliveryAt) + 2 * HOUR : null;
      if (!done || done > now + 36 * HOUR) continue;
      q = { originCity: busy.lane.destination, originState: busy.lane.destState, radius: RADIUS, availableFrom: new Date(Math.max(done, now)).toISOString(), equipment: truck.equipmentType, towardState: home?.[1] };
    }
    if (q.originCity && q.originState) out.push({ truck, q });
  }
  return out;
}

/** One round on the carrier's boards: search for each free truck (every 30 minutes), post trucks (once a day). */
export async function runBoards(ctx: CarrierContext, rows: IntegrationRow[], now: number, onStatus: (row: IntegrationRow, status: string) => Promise<void>): Promise<string[]> {
  const done: string[] = [];
  const slot = Math.floor(now / SEARCH_EVERY);
  const day = new Date(now).toISOString().slice(0, 10);
  for (const row of rows) {
    const board = boardFor(row);
    if (!board) {
      await onStatus(row, "Waiting on Backroute's agreement with this board");
      continue;
    }
    try {
      let found = 0;
      let added = 0;
      for (const { truck, q } of whereTrucksFree(ctx, now)) {
        if (!(await claimMark(ctx.carrier.id, `truck:${truck.id}`, `board_search:${row.kind}:${slot}`))) continue;
        // A post with no phone or email has no one to book it with.
        const loads = (await board.search(q)).filter((l) => l.brokerEmail || l.brokerPhone);
        found += loads.length;
        // Loads heading toward the driver's home first, then by pay.
        loads.sort((a, b) => Number(b.destinationState === q.towardState) - Number(a.destinationState === q.towardState) || (b.rate ?? 0) / (b.miles || 1) - (a.rate ?? 0) / (a.miles || 1));
        added += await pullFeed(ctx, loads.slice(0, 25), board.name);
        const wantsPosting = (row.config as TruckstopConfig | DatConfig).postTrucks;
        if (wantsPosting && board.postTruck && (await claimMark(ctx.carrier.id, `truck:${truck.id}`, `board_post:${row.kind}:${day}`)))
          await board.postTruck({ unitNumber: truck.unitNumber, equipment: truck.equipmentType, originCity: q.originCity, originState: q.originState, availableAt: q.availableFrom, destinationState: q.towardState, ratePerMile: ctx.settings.minRpm });
      }
      if (added) done.push(`${added} load${added === 1 ? "" : "s"} from ${board.name}`);
      await onStatus(row, `Connected · last search ${new Date(now).toISOString().slice(11, 16)} UTC, ${found} load${found === 1 ? "" : "s"} seen`);
    } catch (e) {
      await onStatus(row, `Not working: ${e instanceof Error ? e.message : "error"}`);
    }
  }
  return done;
}
