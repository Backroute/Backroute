"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Wrench } from "lucide-react";
import { PageHeader } from "@/components/shared/portal-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useCarrierTrucks, useDriverMap } from "@/lib/selectors";
import { useStore } from "@/lib/store";
import { useNow } from "@/lib/hooks";
import { milesUntilService, serviceStatus, inspectionStatus, type ServiceStatus } from "@/lib/maintenance";
import { formatDate, formatNumber } from "@/lib/utils";

const STATUS_TONE: Record<ServiceStatus, "success" | "warning" | "danger"> = {
  ok: "success",
  "due-soon": "warning",
  overdue: "danger",
};

const STATUS_LABEL: Record<ServiceStatus, string> = {
  ok: "On track",
  "due-soon": "Due soon",
  overdue: "Overdue",
};

const STATUS_RANK: Record<ServiceStatus, number> = { ok: 0, "due-soon": 1, overdue: 2 };
const worseStatus = (a: ServiceStatus, b: ServiceStatus): ServiceStatus => (STATUS_RANK[a] >= STATUS_RANK[b] ? a : b);

const SHOPS = ["Love's Truck Care", "TA Truck Service", "Rush Truck Centers", "Freightliner Service Center", "TravelCenters of America"];
const SERVICE_TYPES = ["Full service", "Oil & filter change", "Tire replacement", "Brake service", "DOT inspection"];

function tomorrow(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

export default function MaintenancePage() {
  const trucks = useCarrierTrucks();
  const drivers = useDriverMap();
  const now = useNow();
  const appointments = useStore((s) => s.maintenanceAppointments);
  const scheduleMaintenance = useStore((s) => s.actions.scheduleMaintenance);
  const completeMaintenance = useStore((s) => s.actions.completeMaintenance);
  const [schedulingTruckId, setSchedulingTruckId] = useState<string | null>(null);

  const flagged = trucks.filter((t) => serviceStatus(t) !== "ok" || (now !== null && inspectionStatus(t, now) !== "ok"));

  return (
    <div>
      <PageHeader title="Maintenance" description={`${flagged.length} trucks need attention`} />

      <div className="px-4 py-6 sm:px-8">
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {trucks.map((truck) => {
              const remaining = milesUntilService(truck);
              const svcStatus = serviceStatus(truck);
              const pct = Math.max(0, Math.min(100, (remaining / truck.serviceIntervalMiles) * 100));
              const inspStatus = now === null ? "ok" : inspectionStatus(truck, now);
              const overallStatus = worseStatus(svcStatus, inspStatus);
              const driver = drivers.get(truck.driverId ?? "");
              const appointment = appointments.find((a) => a.truckId === truck.id && a.status === "scheduled");

              return (
                <Card key={truck.id}>
                  <CardContent className="flex flex-col gap-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-display text-xl text-ink-950">{truck.unitNumber}</p>
                        <p className="text-xs text-ink-500">{driver?.name ?? "Unassigned"} · {formatNumber(truck.odometer)} mi</p>
                      </div>
                      {truck.status === "maintenance" ? (
                        <Badge tone="neutral"><Wrench className="h-3 w-3" /> In shop</Badge>
                      ) : (
                        <Badge tone={STATUS_TONE[overallStatus]}>{STATUS_LABEL[overallStatus]}</Badge>
                      )}
                    </div>

                    <div>
                      <div className="flex items-center justify-between text-xs text-ink-500">
                        <span>Next service</span>
                        <span className="tabular">{remaining < 0 ? `${formatNumber(Math.abs(remaining))} mi overdue` : `${formatNumber(remaining)} mi left`}</span>
                      </div>
                      <Progress value={pct} className="mt-1.5" />
                    </div>

                    <div className="flex items-center justify-between border-t border-line pt-3.5 text-xs">
                      <span className="text-ink-500">DOT inspection due</span>
                      <span className={inspStatus === "ok" ? "font-medium text-ink-950" : inspStatus === "due-soon" ? "font-medium text-[var(--accent-warn)]" : "font-medium text-[var(--accent-danger)]"}>
                        {formatDate(truck.nextInspectionDue)}
                      </span>
                    </div>

                    {appointment ? (
                      <div className="flex flex-col gap-2 rounded-xl bg-ink-50 px-3 py-2.5 text-xs">
                        <span className="flex items-center gap-2 font-medium text-ink-900">
                          <Wrench className="h-3.5 w-3.5 shrink-0" /> {appointment.serviceType} at {appointment.shopName}
                        </span>
                        <span className="text-ink-500">Scheduled for {formatDate(appointment.scheduledFor)} — held out of the offer pool until complete.</span>
                        <Button size="sm" variant="secondary" className="self-start" onClick={() => completeMaintenance(truck.id)}>
                          <CheckCircle2 className="h-3.5 w-3.5" /> Mark service complete
                        </Button>
                      </div>
                    ) : (
                      <>
                        {svcStatus !== "ok" && (
                          <div className={`flex items-start gap-2 rounded-xl px-3 py-2.5 text-xs ${svcStatus === "overdue" ? "bg-red-50 text-[var(--accent-danger)]" : "bg-amber-50 text-[var(--accent-warn)]"}`}>
                            {svcStatus === "overdue" ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <Wrench className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                            <span>
                              {svcStatus === "overdue"
                                ? "Past service interval — AI will avoid booking a long-haul load on this truck until serviced."
                                : "Approaching service interval — schedule before the next multi-day load."}
                            </span>
                          </div>
                        )}
                        {inspStatus !== "ok" && (
                          <div className={`flex items-start gap-2 rounded-xl px-3 py-2.5 text-xs ${inspStatus === "overdue" ? "bg-red-50 text-[var(--accent-danger)]" : "bg-amber-50 text-[var(--accent-warn)]"}`}>
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            <span>
                              {inspStatus === "overdue"
                                ? "DOT inspection is past due — AI will avoid booking this truck until it's current."
                                : "DOT inspection due soon — schedule it before it lapses."}
                            </span>
                          </div>
                        )}
                        {svcStatus === "ok" && inspStatus === "ok" && (
                          <div className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2.5 text-xs text-[var(--accent-live)]">
                            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> Cleared for any load length
                          </div>
                        )}

                        {schedulingTruckId === truck.id ? (
                          <ScheduleForm
                            onCancel={() => setSchedulingTruckId(null)}
                            onSubmit={(shopName, serviceType, scheduledFor) => {
                              scheduleMaintenance(truck.id, shopName, serviceType, scheduledFor);
                              setSchedulingTruckId(null);
                            }}
                          />
                        ) : (
                          <Button size="sm" variant="outline" onClick={() => setSchedulingTruckId(truck.id)}>
                            <Wrench className="h-3.5 w-3.5" /> Schedule at a shop
                          </Button>
                        )}
                      </>
                    )}
                  </CardContent>
                </Card>
              );
          })}
        </div>
      </div>
    </div>
  );
}

function ScheduleForm({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void;
  onSubmit: (shopName: string, serviceType: string, scheduledFor: string) => void;
}) {
  const [shopName, setShopName] = useState(SHOPS[0]);
  const [serviceType, setServiceType] = useState(SERVICE_TYPES[0]);
  const [scheduledFor, setScheduledFor] = useState(tomorrow());

  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-line-strong p-3">
      <label className="flex flex-col gap-1 text-xs text-ink-500">
        Shop
        <select value={shopName} onChange={(e) => setShopName(e.target.value)} className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-sm text-ink-900">
          {SHOPS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-ink-500">
        Service
        <select value={serviceType} onChange={(e) => setServiceType(e.target.value)} className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-sm text-ink-900">
          {SERVICE_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-ink-500">
        Date
        <input
          type="date"
          value={scheduledFor}
          min={tomorrow()}
          onChange={(e) => setScheduledFor(e.target.value)}
          className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-sm text-ink-900"
        />
      </label>
      <div className="flex items-center gap-2 pt-1">
        <Button size="sm" variant="primary" onClick={() => onSubmit(shopName, serviceType, scheduledFor)}>Confirm</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}
