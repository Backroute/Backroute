"use client";

import { useStore } from "./store";
import { authHeader } from "./ai/client";
import { PRIMARY_CARRIER_ID } from "./mock-data";
import type { ActivityEvent, Expense } from "./types";

/**
 * Lumper money at the dock, the way it really goes: the driver says how much the lumper service wants, the owner
 * approves it and sends a payment code (an express code from Comdata or EFS, or a card's one-time number), and the
 * code shows big on the driver's phone to read out. It's on the load's invoice to the broker afterwards like any
 * lumper receipt.
 */

const uid = (p: string) => `${p}_${Math.random().toString(36).slice(2, 10)}`;

export function requestLumper(driverId: string, loadId: string | null, amount: number, facility: string, note = ""): Expense {
  const s = useStore.getState();
  const driver = s.drivers.find((d) => d.id === driverId);
  const ask: Expense = {
    id: uid("lumper"),
    driverId,
    carrierId: driver?.carrierId ?? PRIMARY_CARRIER_ID,
    loadId,
    category: "lumper",
    amount: Math.round(amount * 100) / 100,
    note: note.trim(),
    status: "pending",
    createdAt: new Date().toISOString(),
    upfront: true,
    facility: facility.trim(),
  };
  const event: ActivityEvent = {
    id: uid("act"),
    timestamp: ask.createdAt,
    type: "expense",
    message: `${driver?.name ?? "A driver"} needs $${ask.amount.toLocaleString()} for a lumper`,
    detail: facility ? `At ${facility}` : undefined,
    loadId: loadId ?? undefined,
    carrierId: ask.carrierId,
    severity: "warning",
  };
  useStore.setState((st) => ({ expenses: [ask, ...st.expenses], activity: [event, ...st.activity].slice(0, 80) }));
  notify({ op: "lumper_ask", amount: ask.amount, facility: ask.facility || undefined });
  return ask;
}

/** Approved with the code to pay, or turned down. */
export function answerLumper(id: string, code: string | null) {
  const respondedAt = new Date().toISOString();
  const ask = useStore.getState().expenses.find((e) => e.id === id);
  if (ask && code) notify({ op: "lumper_code", driverId: ask.driverId });
  useStore.setState((s) => ({
    expenses: s.expenses.map((e) => (e.id === id ? { ...e, status: code ? ("approved" as const) : ("denied" as const), payCode: code?.trim() || undefined, respondedAt } : e)),
  }));
}

/** In the demo there's no fuel card to issue a real one from: a made-up code in the usual shape. */
export function sampleExpressCode(): string {
  return Array.from({ length: 10 }, () => Math.floor(Math.random() * 10)).join("").replace(/(\d{4})(\d{3})(\d{3})/, "$1 $2 $3");
}

/** A phone buzz on the other side, in a real account (the app shows it either way). */
function notify(body: Record<string, unknown>) {
  if (useStore.getState().session.mode === "demo") return;
  void authHeader()
    .then((h) => fetch("/api/push", { method: "POST", headers: { "content-type": "application/json", ...h }, body: JSON.stringify(body) }))
    .catch(() => {});
}
