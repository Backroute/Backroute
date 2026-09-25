/**
 * How an app object becomes a database row: a few indexed columns the access rules and queries read, and the whole
 * object in `data`. Shared by the browser's sync and the server-side AI dispatcher so both write rows the same way.
 */

export type Item = { id: string } & Record<string, unknown>;
export type RecordKind = "incident" | "maintenance" | "dvir" | "time_off" | "expense" | "carrier_message" | "broker";
export type Table = "drivers" | "trucks" | "loads" | "escalations" | "dispatch_calls" | "driver_messages" | "activity" | "records";

const str = (v: unknown) => (typeof v === "string" ? v : null);

/** The indexed columns for each table (and each kind of record). */
export const COLUMNS: Record<Exclude<Table, "records"> | RecordKind, (i: Item) => Record<string, unknown>> = {
  drivers: (i) => ({ name: i.name, phone: str(i.phone) }),
  trucks: (i) => ({ unit_number: str(i.unitNumber), driver_id: str(i.driverId), second_driver_id: str(i.secondDriverId) }),
  loads: (i) => ({ truck_id: str(i.truckId), stage: i.stage }),
  escalations: (i) => ({ load_id: str(i.loadId), status: i.status }),
  dispatch_calls: (i) => ({ driver_id: i.driverId, status: i.status }),
  driver_messages: (i) => ({ driver_id: i.driverId, created_at: i.timestamp }),
  activity: (i) => ({ load_id: str(i.loadId), created_at: i.timestamp }),
  incident: (i) => ({ driver_id: str(i.driverId) }),
  maintenance: () => ({ driver_id: null }),
  dvir: (i) => ({ driver_id: str(i.driverId) }),
  time_off: (i) => ({ driver_id: str(i.driverId) }),
  expense: (i) => ({ driver_id: str(i.driverId) }),
  carrier_message: () => ({ driver_id: null }),
  broker: () => ({ driver_id: null }),
};

/** Tables whose rows carry a creation time instead of an update time. */
export const CREATED_ONLY = new Set<Table>(["driver_messages", "activity"]);

export function rowFor(table: Table, kind: RecordKind | undefined, carrierId: string, item: Item, now = new Date().toISOString()) {
  return {
    id: item.id,
    carrier_id: carrierId,
    ...(kind ? { kind } : {}),
    ...COLUMNS[kind ?? (table as Exclude<Table, "records">)](item),
    ...(CREATED_ONLY.has(table) ? {} : { updated_at: now }),
    data: item,
  };
}

export const conflictKey = (kind?: RecordKind) => (kind ? "carrier_id,kind,id" : "carrier_id,id");
