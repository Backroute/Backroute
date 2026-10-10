/** On the road: stage taps, documents, stops, incidents, maintenance, inspections, time off and expenses. */
import { PRIMARY_CARRIER_ID } from "../../mock-data";
import { confirmLoadStage } from "../../engine";
import { dockMinutes, detentionFor, formatDockTime } from "../../detention";
import { nextStop as nextTripStop } from "../../trip-plan";
import { uploadFile } from "../../cloud/files";
import type { ActivityEvent, DvirInspection, Escalation, Expense, TimeOffRequest, Load, LoadDocument, MaintenanceAppointment } from "../../types";
import { DRIVER_DOC_LABEL, EXPENSE_CATEGORY_LABEL, aiMilestoneEvent, autoPickOffer, openIncident, promoteChainedLoad, readDriverDocument, uid } from "../support";
import type { Actions, GetState, SetState } from "../state";

export const tripActions = (set: SetState, get: GetState): Pick<Actions, "driverConfirmStage" | "acknowledgeDelivery" | "setAutoChain" | "confirmTripStep" | "setSealNumber" | "uploadLoadDocument" | "recaptureDocument" | "completeLoadStop" | "reportIncident" | "startClaim" | "scheduleMaintenance" | "completeMaintenance" | "submitDvir" | "requestTimeOff" | "respondTimeOff" | "submitExpense" | "respondExpense"> => ({
  driverConfirmStage: (loadId) =>
    set((state) => {
      const load = state.loads.find((l) => l.id === loadId);
      if (!load) return {};
      const truck = state.trucks.find((t) => t.id === load.truckId);
      const result = confirmLoadStage(load, truck, state.session.mode === "demo");
      if (result.load === load) return {};
      let trucks = state.trucks;
      const aiEvent = aiMilestoneEvent(result.load, state.brokers.find((b) => b.id === load.brokerId)?.company ?? "the broker");
      let events = aiEvent ? [...result.events, aiEvent] : result.events;
      // A multi-load trip (lib/trip-plan): loaded or dropped at one stop, the truck goes on to the load at the next.
      const onTrip = truck?.trip && load.tripId === truck.trip.id ? nextTripStop(truck, state.loads.map((l) => (l.id === result.load.id ? result.load : l))) : null;
      if (truck && onTrip) {
        const moved = result.load.stage === "delivered" ? { currentCity: load.lane.destination, currentState: load.lane.destState } : {};
        trucks = trucks.map((t) => (t.id === truck.id ? { ...t, ...moved, currentLoadId: onTrip.load.id, status: "on_load" as const } : t));
      } else if (result.truckUpdates) {
        // The trip's last drop ends it.
        if (truck?.trip && load.tripId === truck.trip.id) trucks = trucks.map((t) => (t.id === truck.id ? { ...t, trip: undefined } : t));
        const tu = result.truckUpdates;
        trucks = trucks.map((t) => (t.id === tu.id ? { ...t, ...tu } : t));
        if (tu.status === "available" && tu.currentLoadId === null) {
          trucks = trucks.map((t) => (t.id === tu.id ? { ...t, lastDeliveredLoadId: load.id } : t));
          const promoted = promoteChainedLoad(trucks, tu.id, load.carrierId, state.loads.map((l) => (l.id === result.load.id ? result.load : l)));
          trucks = promoted.trucks;
          if (promoted.event) events = [...events, promoted.event];
        }
      }
      return {
        loads: state.loads.map((l) => (l.id === result.load.id ? result.load : l)),
        trucks,
        activity: [...events, ...state.activity].slice(0, 80),
      };
    }),

  acknowledgeDelivery: (truckId) =>
    set((state) => ({
      trucks: state.trucks.map((t) => (t.id === truckId ? { ...t, lastDeliveredLoadId: null } : t)),
    })),

  setAutoChain: (truckId, on) =>
    set((state) => {
      let trucks = state.trucks.map((t) => (t.id === truckId ? { ...t, autoChainNextLoad: on } : t));
      let loads = state.loads;
      let events: ActivityEvent[] = [];
      const waiting = on ? loads.filter((l) => l.truckId === truckId && l.stage === "offered") : [];
      if (waiting.length) {
        const picked = autoPickOffer(loads, trucks, waiting, truckId);
        loads = picked.loads;
        trucks = picked.trucks;
        events = picked.events;
      }
      return { trucks, loads, activity: [...events, ...state.activity].slice(0, 80) };
    }),

  confirmTripStep: (loadId, step) => {
    let claimId: string | null = null;
    set((state) => {
      const load = state.loads.find((l) => l.id === loadId);
      if (!load) return {};
      const now = new Date().toISOString();
      const checklist = step === "loaded" ? { ...load.tripChecklist, loadedAt: now } : { ...load.tripChecklist, unloadedAt: now };
      const where = step === "loaded" ? `${load.lane.origin}, ${load.lane.originState}` : `${load.lane.destination}, ${load.lane.destState}`;
      const stop = step === "loaded" ? "pickup" : "delivery";
      const updated: Load = { ...load, tripChecklist: checklist };
      const minutes = dockMinutes(updated, stop, Date.now()) ?? 0;
      const amount = detentionFor(minutes);
      const events: ActivityEvent[] = [
        {
          id: uid("act"), timestamp: now, type: "check_call",
          message: step === "loaded" ? "Driver confirmed loaded" : "Driver confirmed unloaded",
          detail: `${load.referenceNumber} · ${where} · ${formatDockTime(minutes)} at the dock`, loadId, carrierId: load.carrierId, severity: "info",
        },
      ];
      // Past free time: the AI bills the broker for detention itself, with the check-in and out times as proof —
      // the claim a driver usually never files because nobody has time to chase it.
      if (amount > 0) {
        claimId = uid("acc");
        updated.accessorials = [
          ...(load.accessorials ?? []),
          { id: claimId, type: "detention", stop, minutes, amount, status: "claimed", createdAt: now },
        ];
        const broker = state.brokers.find((b) => b.id === load.brokerId)?.company ?? "the broker";
        events.unshift({
          id: uid("act"), timestamp: now, type: "negotiation_email", channel: "email",
          message: `Backroute billed ${broker} $${amount} detention`, detail: `${load.referenceNumber} · ${formatDockTime(minutes)} at ${where}, 2h free · check-in and out times attached`,
          loadId, carrierId: load.carrierId, severity: "success",
        });
      }
      return {
        loads: state.loads.map((l) => (l.id === loadId ? updated : l)),
        activity: [...events, ...state.activity].slice(0, 80),
      };
    });
    if (!claimId) return;
    const id = claimId;
    setTimeout(() => {
      set((state) => {
        const load = state.loads.find((l) => l.id === loadId);
        const claim = load?.accessorials?.find((a) => a.id === id);
        if (!load || !claim || claim.status !== "claimed") return {};
        const broker = state.brokers.find((b) => b.id === load.brokerId)?.company ?? "The broker";
        return {
          loads: state.loads.map((l) =>
            l.id === loadId
              ? {
                  ...l,
                  netProfit: (l.netProfit ?? 0) + claim.amount,
                  accessorials: l.accessorials?.map((a) => (a.id === id ? { ...a, status: "approved" as const } : a)),
                }
              : l,
          ),
          activity: [
            {
              id: uid("act"), timestamp: new Date().toISOString(), type: "rate_confirmed" as const, channel: "email" as const,
              message: `${broker} approved $${claim.amount} detention`, detail: `${load.referenceNumber} · added to the invoice`,
              loadId, carrierId: load.carrierId, severity: "success" as const,
            },
            ...state.activity,
          ].slice(0, 80),
        };
      });
    }, 5000);
  },

  setSealNumber: (loadId, sealNumber) =>
    set((state) => ({
      loads: state.loads.map((l) => (l.id === loadId ? { ...l, tripChecklist: { ...l.tripChecklist, sealNumber: sealNumber.trim() || undefined } } : l)),
    })),

  uploadLoadDocument: (loadId, type, file) => {
    const docId = uid("doc");
    set((state) => {
      const load = state.loads.find((l) => l.id === loadId);
      if (!load) return {};
      const replaced = load.documents.find((d) => d.type === type);
      if (replaced?.previewUrl) URL.revokeObjectURL(replaced.previewUrl);
      const now = new Date().toISOString();
      const doc: LoadDocument = { id: docId, type, name: file.name, generatedAt: now, status: "pending", uploadedBy: "driver", previewUrl: file.previewUrl };
      return {
        loads: state.loads.map((l) => (l.id === loadId ? { ...l, documents: [...l.documents.filter((d) => d.type !== type), doc] } : l)),
        activity: [
          {
            id: uid("act"), timestamp: now, type: "document_captured" as const,
            message: `Driver uploaded the ${DRIVER_DOC_LABEL[type]}`, detail: `${load.referenceNumber} · Backroute is reading it`,
            loadId, carrierId: load.carrierId, severity: "info" as const,
          },
          ...state.activity,
        ].slice(0, 80),
      };
    });
    if (get().session.mode !== "demo") {
      // A real account: the file is stored on the server, and the AI there checks it (signed, the right document,
      // anything written on it). Nothing is made up if that fails; the driver is asked to retake it.
      const settle = (patch: Partial<LoadDocument>, message: string, detail: string, severity: "success" | "warning") =>
        set((state) => {
          const load = state.loads.find((l) => l.id === loadId);
          if (!load?.documents.some((d) => d.id === docId)) return {};
          return {
            loads: state.loads.map((l) => (l.id === loadId ? { ...l, documents: l.documents.map((d) => (d.id === docId ? { ...d, ...patch } : d)) } : l)),
            activity: [
              { id: uid("act"), timestamp: new Date().toISOString(), type: "document_captured" as const, message, detail: `${load.referenceNumber} · ${detail}`, loadId, carrierId: load.carrierId, severity },
              ...state.activity,
            ].slice(0, 80),
          };
        });
      if (!file.file) return settle({ status: "failed", aiNote: "Didn't upload." }, `The ${DRIVER_DOC_LABEL[type]} didn't upload`, "Retake it", "warning");
      const onQueued = () =>
        set((state) => ({
          loads: state.loads.map((l) => (l.id === loadId ? { ...l, documents: l.documents.map((d) => (d.id === docId ? { ...d, aiNote: "Saved on this phone. It sends when you have signal." } : d)) } : l)),
        }));
      void uploadFile(type, file.file, { loadId, onQueued }).then((r) => {
        if (!r.ok) return settle({ status: "failed", aiNote: r.reason }, `The ${DRIVER_DOC_LABEL[type]} didn't upload`, r.reason, "warning");
        const note = r.note ?? "Saved.";
        settle(
          { status: "verified", fileId: r.id, aiNote: note, flagged: r.status === "check", ...(r.amount ? { amount: r.amount } : {}) },
          r.status === "check" ? `Check the ${DRIVER_DOC_LABEL[type]}` : `${DRIVER_DOC_LABEL[type]} saved`,
          note,
          r.status === "check" ? "warning" : "success",
        );
      });
      return;
    }
    setTimeout(() => {
      set((state) => {
        const load = state.loads.find((l) => l.id === loadId);
        if (!load?.documents.some((d) => d.id === docId)) return {};
        const { note, lumperAmount } = readDriverDocument(load, type);
        const now = new Date().toISOString();
        const driverId = state.trucks.find((t) => t.id === load.truckId)?.driverId;
        const expense: Expense | null =
          lumperAmount && driverId
            ? { id: uid("exp"), driverId, carrierId: load.carrierId, loadId, category: "lumper", amount: lumperAmount, note: "Lumper receipt, read by Backroute", status: "pending", createdAt: now }
            : null;
        return {
          loads: state.loads.map((l) =>
            l.id === loadId ? { ...l, documents: l.documents.map((d) => (d.id === docId ? { ...d, status: "verified" as const, aiNote: note } : d)) } : l,
          ),
          expenses: expense ? [expense, ...state.expenses] : state.expenses,
          activity: [
            {
              id: uid("act"), timestamp: now, type: "document_captured" as const,
              message: `Backroute checked the ${DRIVER_DOC_LABEL[type]}`, detail: `${load.referenceNumber} · ${note}`,
              loadId, carrierId: load.carrierId, severity: "success" as const,
            },
            ...state.activity,
          ].slice(0, 80),
        };
      });
    }, 1400);
  },

  recaptureDocument: (loadId, type) =>
    set((state) => {
      const load = state.loads.find((l) => l.id === loadId);
      if (!load) return {};
      const doc = load.documents.find((d) => d.type === type);
      if (!doc) return {};
      const now = new Date().toISOString();
      return {
        loads: state.loads.map((l) =>
          l.id === loadId
            ? { ...l, documents: l.documents.map((d) => (d.id === doc.id ? { ...d, generatedAt: now, status: "verified" as const } : d)) }
            : l,
        ),
        activity: [
          {
            id: uid("act"), timestamp: now, type: "document_captured" as const,
            message: `${type.toUpperCase()} photo retaken by driver`, detail: `${load.referenceNumber} · re-verified automatically`,
            loadId, carrierId: load.carrierId, severity: "success" as const,
          },
          ...state.activity,
        ].slice(0, 80),
      };
    }),

  completeLoadStop: (loadId, stopId) =>
    set((state) => {
      const load = state.loads.find((l) => l.id === loadId);
      const stop = load?.stops?.find((s) => s.id === stopId);
      if (!load || !stop) return {};
      return {
        loads: state.loads.map((l) =>
          l.id === loadId ? { ...l, stops: l.stops?.map((s) => (s.id === stopId ? { ...s, completed: true } : s)) } : l,
        ),
        activity: [
          {
            id: uid("act"), timestamp: new Date().toISOString(), type: "check_call" as const,
            message: `${stop.kind === "pickup" ? "Extra pickup" : "Partial drop"} completed: ${stop.city}, ${stop.state}`,
            detail: load.referenceNumber,
            loadId, carrierId: load.carrierId, severity: "success" as const,
          },
          ...state.activity,
        ].slice(0, 80),
      };
    }),

  reportIncident: (driverId, truckId, type, note) =>
    set((state) => {
      const { incident, event } = openIncident(state, driverId, truckId, type, note);
      return {
        incidents: [incident, ...state.incidents],
        activity: [event, ...state.activity].slice(0, 80),
      };
    }),

  startClaim: (incidentId) =>
    set((state) => {
      const incident = state.incidents.find((i) => i.id === incidentId);
      if (!incident || incident.claimStartedAt) return {};
      const now = new Date().toISOString();
      return {
        incidents: state.incidents.map((i) => (i.id === incidentId ? { ...i, claimStartedAt: now } : i)),
        activity: [
          {
            id: uid("act"), timestamp: now, type: "incident" as const,
            message: "Insurance claim started",
            detail: "Backroute is preparing the filing with your policy details.",
            carrierId: incident.carrierId, severity: "info" as const,
          },
          ...state.activity,
        ].slice(0, 80),
      };
    }),

  scheduleMaintenance: (truckId, shopName, serviceType, scheduledFor) =>
    set((state) => {
      const truck = state.trucks.find((t) => t.id === truckId);
      if (!truck) return {};
      const appointment: MaintenanceAppointment = {
        id: uid("mnt"), truckId, carrierId: PRIMARY_CARRIER_ID, shopName, serviceType, scheduledFor,
        status: "scheduled", createdAt: new Date().toISOString(),
      };
      return {
        maintenanceAppointments: [appointment, ...state.maintenanceAppointments],
        trucks: state.trucks.map((t) => (t.id === truckId ? { ...t, status: "maintenance" as const } : t)),
        activity: [
          {
            id: uid("act"), timestamp: new Date().toISOString(), type: "maintenance" as const,
            message: `${truck.unitNumber} scheduled at ${shopName}`,
            detail: `${serviceType}. Backroute will hold this truck out of the offer pool until service completes.`,
            carrierId: PRIMARY_CARRIER_ID, severity: "info" as const,
          },
          ...state.activity,
        ].slice(0, 80),
      };
    }),

  completeMaintenance: (truckId) =>
    set((state) => {
      const truck = state.trucks.find((t) => t.id === truckId);
      const appointment = state.maintenanceAppointments.find((a) => a.truckId === truckId && a.status === "scheduled");
      if (!truck) return {};
      return {
        maintenanceAppointments: state.maintenanceAppointments.map((a) =>
          a.id === appointment?.id ? { ...a, status: "completed" as const, completedAt: new Date().toISOString() } : a,
        ),
        trucks: state.trucks.map((t) =>
          t.id === truckId ? { ...t, status: "available" as const, lastServiceMiles: t.odometer } : t,
        ),
        activity: [
          {
            id: uid("act"), timestamp: new Date().toISOString(), type: "maintenance" as const,
            message: `${truck.unitNumber} back in service`,
            detail: appointment ? `${appointment.serviceType} completed at ${appointment.shopName}` : "Service completed",
            carrierId: PRIMARY_CARRIER_ID, severity: "success" as const,
          },
          ...state.activity,
        ].slice(0, 80),
      };
    }),

  submitDvir: (driverId, truckId, kind, items, notes) =>
    set((state) => {
      const truck = state.trucks.find((t) => t.id === truckId);
      const overallStatus: "pass" | "defect" = items.some((i) => i.status === "defect") ? "defect" : "pass";
      const inspection: DvirInspection = {
        id: uid("dvir"), driverId, truckId, carrierId: PRIMARY_CARRIER_ID, kind, items, overallStatus, notes,
        createdAt: new Date().toISOString(),
      };
      const kindLabel = kind === "pre_trip" ? "Pre-trip" : "Post-trip";
      const activityEvent: ActivityEvent = {
        id: uid("act"), timestamp: new Date().toISOString(), type: "dvir" as const,
        message: `${kindLabel} DVIR ${overallStatus === "pass" ? "passed" : "flagged a defect"}: ${truck?.unitNumber ?? truckId}`,
        detail: overallStatus === "defect" ? items.filter((i) => i.status === "defect").map((i) => (i.note ? `${i.label}: ${i.note}` : i.label)).join(", ") : undefined,
        carrierId: PRIMARY_CARRIER_ID, severity: (overallStatus === "pass" ? "success" : "warning") as ActivityEvent["severity"],
      };

      if (overallStatus === "pass") {
        return {
          dvirInspections: [inspection, ...state.dvirInspections],
          activity: [activityEvent, ...state.activity].slice(0, 80),
        };
      }

      const escalation: Escalation = {
        id: uid("esc"), loadId: truck?.currentLoadId ?? "", carrierId: PRIMARY_CARRIER_ID,
        reason: `${kindLabel} DVIR on ${truck?.unitNumber ?? truckId} flagged a defect: ${items.filter((i) => i.status === "defect").map((i) => (i.note ? `${i.label} (${i.note})` : i.label)).join(", ")}.${items.some((i) => i.photoFileId || i.photoPreview) ? " Photo on the inspection." : ""}`,
        createdAt: new Date().toISOString(), status: "open", complexity: "critical",
      };
      return {
        dvirInspections: [inspection, ...state.dvirInspections],
        escalations: [escalation, ...state.escalations],
        activity: [activityEvent, ...state.activity].slice(0, 80),
      };
    }),

  requestTimeOff: (driverId, startDate, endDate, reason) =>
    set((state) => {
      const driver = state.drivers.find((d) => d.id === driverId);
      const request: TimeOffRequest = {
        id: uid("pto"), driverId, carrierId: PRIMARY_CARRIER_ID, startDate, endDate, reason,
        status: "pending", createdAt: new Date().toISOString(),
      };
      return {
        timeOffRequests: [request, ...state.timeOffRequests],
        activity: [
          {
            id: uid("act"), timestamp: new Date().toISOString(), type: "time_off" as const,
            message: `${driver?.name ?? "Driver"} requested time off`,
            detail: `${startDate} – ${endDate} · ${reason}`,
            carrierId: PRIMARY_CARRIER_ID, severity: "info" as const,
          },
          ...state.activity,
        ].slice(0, 80),
      };
    }),

  respondTimeOff: (id, approve) =>
    set((state) => {
      const request = state.timeOffRequests.find((r) => r.id === id);
      if (!request) return {};
      const driver = state.drivers.find((d) => d.id === request.driverId);
      return {
        timeOffRequests: state.timeOffRequests.map((r) =>
          r.id === id ? { ...r, status: (approve ? "approved" : "denied") as "approved" | "denied", respondedAt: new Date().toISOString() } : r,
        ),
        activity: [
          {
            id: uid("act"), timestamp: new Date().toISOString(), type: "time_off" as const,
            message: `Time off ${approve ? "approved" : "denied"}: ${driver?.name ?? "driver"}`,
            detail: `${request.startDate} – ${request.endDate}`,
            carrierId: PRIMARY_CARRIER_ID, severity: (approve ? "success" : "info") as ActivityEvent["severity"],
          },
          ...state.activity,
        ].slice(0, 80),
      };
    }),

  submitExpense: (driverId, loadId, category, amount, note, receipt) =>
    set((state) => {
      if (!Number.isFinite(amount) || amount <= 0) return {};
      const driver = state.drivers.find((d) => d.id === driverId);
      const expense: Expense = {
        id: uid("exp"), driverId, carrierId: PRIMARY_CARRIER_ID, loadId, category, amount: Math.round(amount * 100) / 100, note,
        status: "pending", createdAt: new Date().toISOString(),
        ...(receipt?.fileId ? { receiptFileId: receipt.fileId } : {}),
        ...(receipt?.preview ? { receiptPreview: receipt.preview } : {}),
      };
      return {
        expenses: [expense, ...state.expenses],
        activity: [
          {
            id: uid("act"), timestamp: new Date().toISOString(), type: "expense" as const,
            message: `${driver?.name ?? "Driver"} submitted a ${EXPENSE_CATEGORY_LABEL[category]} expense`,
            detail: `$${expense.amount.toLocaleString()}${note ? ` · ${note}` : ""}`,
            carrierId: PRIMARY_CARRIER_ID, severity: "info" as const,
          },
          ...state.activity,
        ].slice(0, 80),
      };
    }),

  respondExpense: (id, approve) =>
    set((state) => {
      const expense = state.expenses.find((e) => e.id === id);
      if (!expense) return {};
      const driver = state.drivers.find((d) => d.id === expense.driverId);
      return {
        expenses: state.expenses.map((e) =>
          e.id === id ? { ...e, status: (approve ? "approved" : "denied") as "approved" | "denied", respondedAt: new Date().toISOString() } : e,
        ),
        activity: [
          {
            id: uid("act"), timestamp: new Date().toISOString(), type: "expense" as const,
            message: `Expense ${approve ? "approved" : "denied"}: ${driver?.name ?? "driver"}`,
            detail: `$${expense.amount.toLocaleString()} · ${EXPENSE_CATEGORY_LABEL[expense.category]}`,
            carrierId: PRIMARY_CARRIER_ID, severity: (approve ? "success" : "info") as ActivityEvent["severity"],
          },
          ...state.activity,
        ].slice(0, 80),
      };
    }),
});
