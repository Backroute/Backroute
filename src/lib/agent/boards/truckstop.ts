import "server-only";
import type { EquipmentType } from "../../types";
import { BoardError, type Board, type BoardLoad, type BoardQuery, type TruckPosting } from "./types";

/**
 * Truckstop's web services (SOAP), from their public developer reference (developer.truckstop.com):
 * - Load search: POST {base}/v13/Searching/LoadSearch.svc, action GetLoadSearchResults.
 * - Truck posting: POST {base}/v13/Posting/TruckPosting.svc, action PostTrucks.
 * Backroute signs in with the partner web-service login Truckstop issues under a Systems Integration Agreement
 * (TRUCKSTOP_WS_USERNAME / TRUCKSTOP_WS_PASSWORD); each carrier links their own Truckstop account with its
 * Integration ID. TRUCKSTOP_WS_BASE is the address Truckstop gives with the login (their test one is
 * https://testws.truckstop.com).
 */

export const truckstopConfigured = () => Boolean(process.env.TRUCKSTOP_WS_USERNAME && process.env.TRUCKSTOP_WS_PASSWORD && process.env.TRUCKSTOP_WS_BASE);

const EQUIPMENT: Record<EquipmentType, string | null> = { "Dry Van": "V", Reefer: "R", Flatbed: "F", Container: null };
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const base = () => process.env.TRUCKSTOP_WS_BASE!.replace(/\/$/, "");

function login(integrationId: string) {
  return `<web:IntegrationId>${esc(integrationId)}</web:IntegrationId><web:Password>${esc(process.env.TRUCKSTOP_WS_PASSWORD!)}</web:Password><web:UserName>${esc(process.env.TRUCKSTOP_WS_USERNAME!)}</web:UserName>`;
}

async function soap(path: string, action: string, envelope: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${base()}${path}`, { method: "POST", headers: { "content-type": "text/xml; charset=utf-8", SOAPAction: action }, body: envelope, signal: AbortSignal.timeout(20000), cache: "no-store" });
  } catch {
    throw new BoardError("Couldn't reach Truckstop.");
  }
  const text = await res.text();
  if (!res.ok) throw new BoardError(`Truckstop answered ${res.status}.`);
  // Truckstop reports problems in an Errors list inside a normal answer.
  const err = text.match(/<(?:\w+:)?ErrorMessage>([^<]+)</);
  if (err) throw new BoardError(`Truckstop: ${err[1]}`);
  return text;
}

/** Every <a:Tag>value</a:Tag> in a block, whatever the prefix. */
function fields(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/<(?:\w+:)?(\w+)>([^<]*)<\/(?:\w+:)?\1>/g)) out[m[1]] = m[2].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
  return out;
}

/** "11/11/24" → "2024-11-11". */
function isoDay(d: string): string | null {
  const m = d.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  const y = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

export function parseLoadSearch(xml: string): BoardLoad[] {
  const items = [...xml.matchAll(/<(?:\w+:)?LoadSearchItem>([\s\S]*?)<\/(?:\w+:)?LoadSearchItem>/g)].map((m) => fields(m[1]));
  return items
    .filter((f) => f.OriginCity && f.OriginState && f.DestinationCity && f.DestinationState)
    .map((f) => {
      const day = f.PickUpDate ? isoDay(f.PickUpDate) : null;
      const rate = Number((f.Payment ?? "").replace(/[$,]/g, ""));
      return {
        boardId: f.ID,
        loadNumber: f.ID ? `TS-${f.ID}` : null,
        originCity: f.OriginCity,
        originState: f.OriginState.toUpperCase(),
        destinationCity: f.DestinationCity,
        destinationState: f.DestinationState.toUpperCase(),
        pickup: f.PickUpDate ? `${f.PickUpDate} (time not posted)` : null,
        delivery: null,
        // Truckstop posts the pickup day, not the hour: morning is assumed for planning, and the rate con sets the real time.
        pickupLocal: day ? `${day}T08:00` : null,
        deliveryLocal: null,
        equipment: f.Equipment === "R" ? "Reefer" : f.Equipment === "F" ? "Flatbed" : "Dry Van",
        rate: rate > 0 ? rate : null,
        miles: Number(f.Miles) > 0 ? Number(f.Miles) : null,
        weight: Number(f.Weight) > 0 ? Number(f.Weight) : null,
        notes: f.Days2Pay && f.Days2Pay !== "----" ? `Pays in about ${f.Days2Pay} days (Truckstop)` : null,
        brokerName: f.CompanyName || "Truckstop poster",
        brokerEmail: null,
        brokerPhone: f.PointOfContactPhone || null,
        brokerMc: null,
      } satisfies BoardLoad;
    });
}

export function truckstopBoard(integrationId: string): Board {
  return {
    name: "Truckstop",
    async search(q: BoardQuery) {
      const eq = EQUIPMENT[q.equipment];
      if (!eq) return [];
      const envelope = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:v12="http://webservices.truckstop.com/v12" xmlns:web="http://schemas.datacontract.org/2004/07/WebServices" xmlns:web1="http://schemas.datacontract.org/2004/07/WebServices.Searching" xmlns:arr="http://schemas.microsoft.com/2003/10/Serialization/Arrays"><soapenv:Header/><soapenv:Body><v12:GetLoadSearchResults><v12:searchRequest>${login(integrationId)}<web1:Criteria><web1:EquipmentType>${eq}</web1:EquipmentType><web1:HoursOld>4</web1:HoursOld><web1:LoadType>Full</web1:LoadType><web1:OriginCity>${esc(q.originCity.toLowerCase())}</web1:OriginCity><web1:OriginCountry>usa</web1:OriginCountry><web1:OriginRange>${q.radius}</web1:OriginRange><web1:OriginState>${esc(q.originState.toLowerCase())}</web1:OriginState><web1:PageNumber>1</web1:PageNumber><web1:PageSize>100</web1:PageSize><web1:PickupDates><arr:dateTime>${q.availableFrom.slice(0, 10)}</arr:dateTime></web1:PickupDates><web1:SortDescending>true</web1:SortDescending></web1:Criteria></v12:searchRequest></v12:GetLoadSearchResults></soapenv:Body></soapenv:Envelope>`;
      return parseLoadSearch(await soap("/v13/Searching/LoadSearch.svc", "http://webservices.truckstop.com/v12/ILoadSearch/GetLoadSearchResults", envelope));
    },
    async postTruck(t: TruckPosting) {
      const eq = EQUIPMENT[t.equipment];
      if (!eq) return null;
      const envelope = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:v11="http://webservices.truckstop.com/v11" xmlns:web="http://schemas.datacontract.org/2004/07/WebServices" xmlns:web1="http://schemas.datacontract.org/2004/07/WebServices.Posting" xmlns:web2="http://schemas.datacontract.org/2004/07/WebServices.Objects"><soapenv:Header/><soapenv:Body><v11:PostTrucks><v11:trucks>${login(integrationId)}<web1:Trucks><web2:Truck><web2:DateAvailable>${esc(t.availableAt)}</web2:DateAvailable><web2:DestinationCity></web2:DestinationCity><web2:DestinationCountry>usa</web2:DestinationCountry><web2:DestinationState>${esc((t.destinationState ?? "").toLowerCase())}</web2:DestinationState><web2:EquipmentType>${eq.toLowerCase()}</web2:EquipmentType><web2:IsDaily>false</web2:IsDaily><web2:IsLoadFull>false</web2:IsLoadFull><web2:OriginCity>${esc(t.originCity.toLowerCase())}</web2:OriginCity><web2:OriginCountry>usa</web2:OriginCountry><web2:OriginState>${esc(t.originState.toLowerCase())}</web2:OriginState><web2:Quantity>1</web2:Quantity>${t.ratePerMile ? `<web2:RatePerMile>${t.ratePerMile}</web2:RatePerMile>` : ""}<web2:TruckID>0</web2:TruckID><web2:TruckNumber>${esc(t.unitNumber)}</web2:TruckNumber></web2:Truck></web1:Trucks></v11:trucks></v11:PostTrucks></soapenv:Body></soapenv:Envelope>`;
      const xml = await soap("/v13/Posting/TruckPosting.svc", "http://webservices.truckstop.com/v11/ITruckPosting/PostTrucks", envelope);
      return xml.match(/<(?:\w+:)?TruckIds[^>]*>\s*<(?:\w+:)?int>(\d+)</)?.[1] ?? null;
    },
  };
}
