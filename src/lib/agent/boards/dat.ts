import "server-only";
import type { EquipmentType } from "../../types";
import { BoardError, type Board, type BoardLoad, type BoardQuery, type TruckPosting } from "./types";

/**
 * DAT (DAT One / DAT Freight & Analytics APIs).
 *
 * TO CONFIRM WHEN DAT ACCESS IS GRANTED: DAT's developer docs (developer.dat.com) are only open to partners, so the
 * addresses and field names below follow DAT's usual two-step sign-in (organization token, then a token for the
 * carrier's DAT user) and freight search as generally documented, and must be checked against the docs DAT provides.
 * Every address can be changed without code (DAT_IDENTITY_BASE, DAT_FREIGHT_BASE); field mapping is in toLoad().
 * The stand-in used for testing implements exactly this shape.
 *
 * Backroute's service account: DAT_SERVICE_EMAIL / DAT_SERVICE_PASSWORD. Each carrier links their DAT user email.
 */

export const datConfigured = () => Boolean(process.env.DAT_SERVICE_EMAIL && process.env.DAT_SERVICE_PASSWORD);

const IDENTITY = () => process.env.DAT_IDENTITY_BASE?.replace(/\/$/, "") ?? "https://identity.api.dat.com";
const FREIGHT = () => process.env.DAT_FREIGHT_BASE?.replace(/\/$/, "") ?? "https://freight.api.dat.com";
const EQUIPMENT: Record<EquipmentType, string | null> = { "Dry Van": "V", Reefer: "R", Flatbed: "F", Container: null };

async function call(url: string, init: RequestInit): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers: { "content-type": "application/json", accept: "application/json", ...(init.headers ?? {}) }, signal: AbortSignal.timeout(20000), cache: "no-store" });
  } catch {
    throw new BoardError("Couldn't reach DAT.");
  }
  if (res.status === 401 || res.status === 403) throw new BoardError("DAT didn't accept the sign-in.");
  if (!res.ok) throw new BoardError(`DAT answered ${res.status}.`);
  return res.json();
}

async function userToken(userEmail: string): Promise<string> {
  const org = (await call(`${IDENTITY()}/access/v1/token/organization`, { method: "POST", body: JSON.stringify({ username: process.env.DAT_SERVICE_EMAIL, password: process.env.DAT_SERVICE_PASSWORD }) })) as { accessToken?: string };
  if (!org.accessToken) throw new BoardError("DAT gave no organization token.");
  const user = (await call(`${IDENTITY()}/access/v1/token/user`, { method: "POST", headers: { authorization: `Bearer ${org.accessToken}` }, body: JSON.stringify({ username: userEmail }) })) as { accessToken?: string };
  if (!user.accessToken) throw new BoardError("DAT gave no user token for that email.");
  return user.accessToken;
}

interface DatMatch {
  matchId?: string;
  matchingAssetInfo?: {
    origin?: { city?: string; stateProv?: string };
    destination?: { place?: { city?: string; stateProv?: string } };
    equipmentType?: string;
    capacity?: { shipment?: { maximumWeightPounds?: number } };
  };
  availability?: { earliestWhen?: string; latestWhen?: string };
  tripLength?: { miles?: number };
  loadBoardRateInfo?: { nonBookable?: { rateUsd?: number } };
  posterInfo?: { companyName?: string; contact?: { phone?: string; email?: string }; mcNumber?: string };
  comments?: string[];
}

function toLoad(m: DatMatch): BoardLoad | null {
  const a = m.matchingAssetInfo;
  const o = a?.origin;
  const d = a?.destination?.place;
  if (!o?.city || !o.stateProv || !d?.city || !d.stateProv) return null;
  const when = m.availability?.earliestWhen;
  return {
    boardId: m.matchId,
    loadNumber: m.matchId ? `DAT-${m.matchId}` : null,
    originCity: o.city,
    originState: o.stateProv.toUpperCase(),
    destinationCity: d.city,
    destinationState: d.stateProv.toUpperCase(),
    pickup: when ? `${when.slice(0, 10)} (see broker)` : null,
    delivery: null,
    pickupLocal: when ? `${when.slice(0, 10)}T08:00` : null,
    deliveryLocal: null,
    equipment: a?.equipmentType === "R" ? "Reefer" : a?.equipmentType === "F" ? "Flatbed" : "Dry Van",
    rate: m.loadBoardRateInfo?.nonBookable?.rateUsd ?? null,
    miles: m.tripLength?.miles ?? null,
    weight: a?.capacity?.shipment?.maximumWeightPounds ?? null,
    notes: m.comments?.join(" ") || null,
    brokerName: m.posterInfo?.companyName ?? "DAT poster",
    brokerEmail: m.posterInfo?.contact?.email?.toLowerCase() ?? null,
    brokerPhone: m.posterInfo?.contact?.phone ?? null,
    brokerMc: m.posterInfo?.mcNumber ?? null,
  };
}

export function datBoard(userEmail: string): Board {
  return {
    name: "DAT",
    async search(q: BoardQuery) {
      const eq = EQUIPMENT[q.equipment];
      if (!eq) return [];
      const token = await userToken(userEmail);
      const auth = { authorization: `Bearer ${token}` };
      const from = new Date(q.availableFrom);
      const query = (await call(`${FREIGHT()}/search/v3/queries`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({
          criteria: {
            lane: { assetType: "SHIPMENT", equipment: { types: [eq] }, origin: { place: { city: q.originCity, stateProv: q.originState } }, destination: { open: {} } },
            maxAgeMinutes: 240,
            maxOriginDeadheadMiles: q.radius,
            availability: { earliestWhen: from.toISOString(), latestWhen: new Date(from.getTime() + 2 * 86400_000).toISOString() },
          },
        }),
      })) as { queryId?: string };
      if (!query.queryId) throw new BoardError("DAT didn't start the search.");
      const found = (await call(`${FREIGHT()}/search/v3/queries/${encodeURIComponent(query.queryId)}/matches`, { method: "GET", headers: auth })) as { matches?: DatMatch[] };
      return (found.matches ?? []).map(toLoad).filter((l): l is BoardLoad => l !== null);
    },
    async postTruck(t: TruckPosting) {
      const eq = EQUIPMENT[t.equipment];
      if (!eq) return null;
      const token = await userToken(userEmail);
      const posted = (await call(`${FREIGHT()}/posting/v2/assets`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: JSON.stringify({
          assetType: "TRUCK",
          equipment: { types: [eq] },
          origin: { place: { city: t.originCity, stateProv: t.originState } },
          destination: t.destinationState ? { area: { states: [t.destinationState] } } : { open: {} },
          availability: { earliestWhen: t.availableAt, latestWhen: new Date(Date.parse(t.availableAt) + 86400_000).toISOString() },
          referenceId: t.unitNumber,
        }),
      })) as { assetId?: string };
      return posted.assetId ?? null;
    },
  };
}
