import { authHeader } from "@/lib/ai/client";
import { zip, type ZipEntry } from "@/lib/zip";

/**
 * A carrier leaving: everything they have on Backroute as one .zip (api/account, a table at a time, then each file),
 * and deleting the account.
 */

interface Index {
  carrier: { name: string } & Record<string, unknown>;
  billing: Record<string, unknown> | null;
  tables: string[];
}
interface FileRow {
  id: string;
  kind: string;
  name: string;
  created_at: string;
}
type Row = Record<string, unknown> & { data?: Record<string, unknown> };

const enc = new TextEncoder();
const json = (v: unknown) => enc.encode(JSON.stringify(v, null, 1));
const safe = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").slice(0, 120) || "file";
const cell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

async function get<T>(query: string, head: Record<string, string>): Promise<T> {
  const res = await fetch(`/api/account${query}`, { headers: head });
  if (!res.ok) throw new Error(`export ${res.status}`);
  return (await res.json()) as T;
}

/** The loads as a spreadsheet, for anyone who doesn't want to read JSON. */
function loadsCsv(loads: Row[], brokers: Map<string, string>): Uint8Array {
  const head = ["Load", "Broker", "From", "To", "Miles", "Pickup", "Delivery", "Status", "Rate", "Invoice", "Invoice amount", "Paid"];
  const lines = loads.map(({ data: l = {} }) => {
    const lane = (l.lane ?? {}) as Record<string, unknown>;
    const inv = (l.invoice ?? {}) as Record<string, unknown>;
    return [l.referenceNumber, brokers.get(String(l.brokerId)) ?? "", lane.origin, lane.destination, lane.miles, l.pickupAt, l.deliveryAt, l.stage, l.bookedRate ?? l.listedRate, inv.number, inv.amount, inv.paidAt ?? ""].map(cell).join(",");
  });
  return enc.encode([head.join(","), ...lines].join("\r\n") + "\r\n");
}

export async function downloadEverything(onProgress: (what: string) => void): Promise<{ files: number; missed: string[] }> {
  const head = await authHeader();
  const index = await get<Index>("", head);
  const entries: ZipEntry[] = [{ name: "data/carrier.json", data: json({ ...index.carrier, billing: index.billing }) }];
  const tables: Record<string, Row[]> = {};
  for (const table of index.tables) {
    onProgress(`Copying ${table.replace(/_/g, " ")}…`);
    const rows: Row[] = [];
    for (let page = 0; ; page++) {
      const r = await get<{ rows: Row[]; more: boolean }>(`?table=${table}&page=${page}`, head);
      rows.push(...r.rows);
      if (!r.more) break;
    }
    tables[table] = rows;
    entries.push({ name: `data/${table}.json`, data: json(rows) });
  }
  const brokers = new Map((tables.records ?? []).filter((r) => r.kind === "broker").map((r) => [String(r.id), String(r.data?.company ?? "")]));
  entries.push({ name: "loads.csv", data: loadsCsv(tables.loads ?? [], brokers) });

  const files = (tables.carrier_files ?? []) as unknown as FileRow[];
  const missed: string[] = [];
  const names = new Set<string>();
  for (const [i, f] of files.entries()) {
    onProgress(`Copying files (${i + 1} of ${files.length})…`);
    let name = `files/${safe(f.kind)}/${f.created_at.slice(0, 10)} ${safe(f.name)}`;
    for (let n = 2; names.has(name); n++) name = name.replace(/( \(\d+\))?(\.[^.]*)?$/, (_m, _d, ext = "") => ` (${n})${ext}`);
    names.add(name);
    try {
      const res = await fetch(`/api/files/${f.id}`, { headers: head });
      if (!res.ok) throw new Error(String(res.status));
      entries.push({ name, data: new Uint8Array(await res.arrayBuffer()), date: new Date(f.created_at) });
    } catch {
      missed.push(f.name);
    }
  }

  entries.unshift({
    name: "README.txt",
    data: enc.encode(
      [
        `${index.carrier.name}: everything on Backroute, ${new Date().toLocaleString()}.`,
        "",
        "loads.csv     every load, one row each (opens in Excel or Google Sheets)",
        "files/        every file: rate cons, BOLs, PODs, invoices, your papers, by kind",
        "data/         everything else as JSON: drivers, trucks, loads, messages, calls, alerts, consent records, settings",
        "",
        "Saved website passwords and connection keys aren't included.",
        ...(missed.length ? ["", `These files couldn't be copied (try again, or ask support): ${missed.join(", ")}`] : []),
      ].join("\r\n") + "\r\n",
    ),
  });

  onProgress("Making the .zip…");
  const blob = new Blob([zip(entries)], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: `backroute-${safe(index.carrier.name).toLowerCase().replace(/\s+/g, "-")}-${new Date().toISOString().slice(0, 10)}.zip` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return { files: files.length - missed.length, missed };
}

/** Deletes the account for good. `confirm` is the company name as the owner typed it. */
export async function deleteAccount(confirm: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const res = await fetch("/api/account", { method: "DELETE", headers: { ...(await authHeader()), "content-type": "application/json" }, body: JSON.stringify({ confirm }) });
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return res.ok ? { ok: true } : { ok: false, reason: body.error ?? "failed" };
}
