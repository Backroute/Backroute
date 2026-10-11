import "server-only";
import { open, seal } from "../portal/vault";
import { EldError, type EldVehicle } from "./eld";

/**
 * Geotab (MyGeotab), the third ELD: its API is JSON-RPC over one address. Authenticate with the database name, a
 * user and password (best a service user the owner makes for Backroute, read-only), which returns a session and, for
 * many fleets, the server their database lives on; then Get DeviceStatusInfo for where each vehicle is and Get Device
 * for their names. Hours of service come through Geotab's own HOS add-in and aren't read here yet; positions,
 * IFTA miles and arrivals work as with the other ELDs.
 */

const DEFAULT = () => (process.env.GEOTAB_API_BASE ?? "https://my.geotab.com").replace(/\/$/, "");

export interface GeotabConfig {
  database: string;
  userName: string;
  /** The password, sealed with the vault key; it's only opened to sign in. */
  password: string;
  /** The server Geotab said the database is on, kept after the first sign-in. */
  server?: string;
}

type Credentials = { database: string; userName: string; sessionId: string };

async function rpc<T>(base: string, method: string, params: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${base}/apiv1`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ method, params }), signal: AbortSignal.timeout(20000), cache: "no-store" });
  const body = (await res.json().catch(() => ({}))) as { result?: T; error?: { message?: string; errors?: { name?: string; message?: string }[] } };
  if (!res.ok) throw new EldError(`Geotab answered ${res.status}`);
  if (body.error) {
    const name = body.error.errors?.[0]?.name ?? "";
    throw new EldError(/InvalidUser|Authentication/i.test(name + (body.error.message ?? "")) ? "Geotab didn't accept that database, user or password." : `Geotab: ${body.error.message ?? "error"}`);
  }
  return body.result as T;
}

const bind = (carrierId: string, c: Pick<GeotabConfig, "database" | "userName">) => `${carrierId}|geotab|${c.database}|${c.userName}`;

export function sealGeotab(carrierId: string, input: { database: string; userName: string; password: string }): GeotabConfig {
  return { database: input.database, userName: input.userName, password: seal(input.password, bind(carrierId, input)) };
}

/** Signs in and reads every vehicle's last position. Returns the server to keep for next time. */
export async function readGeotab(carrierId: string, config: GeotabConfig): Promise<{ vehicles: EldVehicle[]; server?: string }> {
  const password = open(config.password, bind(carrierId, config))?.value;
  if (!password) throw new EldError("The Geotab password can't be read. Enter it again.");
  const first = config.server ? `https://${config.server}` : DEFAULT();
  const auth = await rpc<{ credentials: Credentials; path?: string }>(first, "Authenticate", { database: config.database, userName: config.userName, password });
  // "ThisServer" means stay; otherwise the database lives on the server named.
  const server = auth.path && auth.path !== "ThisServer" ? auth.path : config.server;
  const base = server ? (process.env.GEOTAB_API_BASE ? DEFAULT() : `https://${server}`) : first;
  const [statuses, devices] = await Promise.all([
    rpc<{ device?: { id?: string }; latitude?: number; longitude?: number; dateTime?: string }[]>(base, "Get", { typeName: "DeviceStatusInfo", credentials: auth.credentials }),
    rpc<{ id?: string; name?: string }[]>(base, "Get", { typeName: "Device", credentials: auth.credentials }),
  ]);
  const names = new Map(devices.filter((d) => d.id && d.name).map((d) => [d.id!, d.name!]));
  const vehicles: EldVehicle[] = [];
  for (const s of statuses) {
    const name = s.device?.id ? names.get(s.device.id) : undefined;
    if (!name || s.latitude == null || s.longitude == null || (s.latitude === 0 && s.longitude === 0)) continue;
    vehicles.push({ unit: name, lat: s.latitude, lon: s.longitude, at: s.dateTime ?? new Date().toISOString() });
  }
  return { vehicles, server };
}
