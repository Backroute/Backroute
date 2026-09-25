import "server-only";
import type { CustomBoardConfig } from "../integrations";
import { toRow } from "../feeds";
import { BoardError, type Board, type BoardLoad, type BoardQuery } from "./types";

/**
 * Any other load board with an API (123Loadboard, Direct Freight, Trucker Path, a broker's own portal), described
 * instead of coded: where to search, what to send, where the list of loads is in the answer, and which field is which.
 * When a board's API docs arrive with the agreement, Backroute support fills this in; no new code is needed.
 *
 * In searchUrl, body and header values, these are replaced: {{originCity}} {{originState}} {{radius}} {{date}}
 * {{equipment}} (Dry Van / Reefer / Flatbed) {{equipmentCode}} (V / R / F).
 * fields maps our field names (see lib/agent/feeds) to paths in each load, like "origin.city" or "contact.phone".
 */

const CODE = { "Dry Van": "V", Reefer: "R", Flatbed: "F", Container: "C" } as const;

export function fill(template: string, q: BoardQuery, encode: (s: string) => string = (s) => s): string {
  const values: Record<string, string> = {
    originCity: q.originCity,
    originState: q.originState,
    radius: String(q.radius),
    date: q.availableFrom.slice(0, 10),
    equipment: q.equipment,
    equipmentCode: CODE[q.equipment],
  };
  return template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => encode(values[k] ?? ""));
}

export function at(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);
}

export function customBoard(cfg: CustomBoardConfig): Board {
  return {
    name: cfg.name,
    async search(q: BoardQuery) {
      const url = fill(cfg.searchUrl, q, encodeURIComponent);
      let res: Response;
      try {
        res = await fetch(url, {
          method: cfg.method,
          headers: { accept: "application/json", ...(cfg.body ? { "content-type": "application/json" } : {}), ...Object.fromEntries(Object.entries(cfg.headers ?? {}).map(([k, v]) => [k, fill(v, q)])) },
          body: cfg.method === "POST" && cfg.body ? fill(cfg.body, q) : undefined,
          signal: AbortSignal.timeout(20000),
          cache: "no-store",
        });
      } catch {
        throw new BoardError(`Couldn't reach ${cfg.name}.`);
      }
      if (!res.ok) throw new BoardError(`${cfg.name} answered ${res.status}.`);
      const body = await res.json().catch(() => null);
      const list = cfg.listPath ? at(body, cfg.listPath) : body;
      if (!Array.isArray(list)) throw new BoardError(`${cfg.name}: no list of loads at "${cfg.listPath}".`);
      return list
        .map((item) => {
          const flat = Object.fromEntries(Object.entries(cfg.fields).map(([ours, path]) => [ours, at(item, path)]));
          const row = toRow(flat);
          return row ? ({ ...row, boardId: flat.loadNumber ? String(flat.loadNumber) : undefined } as BoardLoad) : null;
        })
        .filter((l): l is BoardLoad => l !== null);
    },
  };
}
