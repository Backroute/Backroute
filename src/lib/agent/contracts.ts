import "server-only";
import type { Item } from "../cloud/rows";
import { contractLoadsDue } from "../contracts";
import { makeLoad } from "../fleet";
import { formatAtStop } from "../stop-time";
import type { Broker, Load } from "../types";
import { bestTruck } from "./booking";
import { addActivity, claimMark, save, type CarrierContext } from "./db";
import { event, passToOwner } from "./dispatcher";

/**
 * Direct shippers' scheduled freight (lib/contracts): each round, every contract pickup in the next week without a
 * load becomes one, on the truck that can take it with the least empty driving. Already agreed, so it's booked
 * straight away; the shipper is invoiced on its own terms when it delivers. A pickup no truck can take reaches the
 * owner once.
 */
export async function makeContractLoads(ctx: CarrierContext, now: number): Promise<string[]> {
  const done: string[] = [];
  const today = new Date(now).toISOString().slice(0, 10);
  const shippers = ctx.brokers.filter((b) => b.direct && b.lanes?.length);
  const advanced = new Map<string, Broker>();
  for (const plan of contractLoadsDue(shippers, today)) {
    const shipper = advanced.get(plan.shipper.id) ?? plan.shipper;
    const ref = `${shipper.company.split(/\s+/)[0].toUpperCase().slice(0, 6)}-${plan.date.replace(/-/g, "").slice(2)}-${plan.lane.id.slice(-4)}`;
    if (ctx.loads.some((l) => l.brokerId === shipper.id && l.referenceNumber === ref)) continue;
    const fit = bestTruck(ctx, { equipment: plan.lane.equipmentType, originCity: plan.lane.origin, originState: plan.lane.originState, destinationState: plan.lane.destState, pickupAt: Date.parse(plan.pickupAt), miles: plan.lane.miles }, undefined, { planned: true });
    if (!fit) {
      if (await claimMark(ctx.carrier.id, "contracts", `${plan.lane.id}:${plan.date}`))
        await passToOwner(ctx, {
          reason: `No truck with a ${plan.lane.equipmentType.toLowerCase()} is free for ${shipper.company}'s ${plan.lane.origin} → ${plan.lane.destination} pickup on ${plan.date}. Free one up or tell ${shipper.contact || "them"} it'll be covered another way.`,
          label: "Handled",
          source: "app",
          to: "owner",
        });
      continue;
    }
    const base = makeLoad(
      {
        truckId: fit.truck.id,
        brokerId: shipper.id,
        referenceNumber: ref,
        originCity: plan.lane.origin,
        originState: plan.lane.originState,
        destinationCity: plan.lane.destination,
        destinationState: plan.lane.destState,
        miles: plan.lane.miles,
        pickupWindow: formatAtStop(plan.pickupAt, plan.lane.originState),
        deliveryWindow: plan.date,
        pickupAt: plan.pickupAt,
        rate: plan.lane.rate,
        equipment: plan.lane.equipmentType,
      },
      shipper,
      fit.truck,
      "booked",
      fit.deadhead,
    );
    const load: Load = { ...base, carrierId: ctx.carrier.id, source: `Contract · ${shipper.company}`, ...(shipper.email ? { brokerContactEmail: shipper.email } : {}) };
    await save("loads", ctx.carrier.id, load as unknown as Item);
    ctx.loads.unshift(load);
    // The lane remembers how far ahead its loads are made, so each pickup is made once.
    const lanes = (shipper.lanes ?? []).map((l) => (l.id === plan.lane.id && (!l.madeThrough || l.madeThrough < plan.date) ? { ...l, madeThrough: plan.date } : l));
    advanced.set(shipper.id, { ...shipper, lanes });
    done.push(`${shipper.company} ${plan.date}`);
  }
  for (const b of advanced.values()) {
    await save("records", ctx.carrier.id, b as unknown as Item, "broker");
    ctx.brokers = ctx.brokers.map((x) => (x.id === b.id ? b : x));
  }
  if (done.length)
    await addActivity(ctx.carrier.id, event({ type: "booked", message: `${done.length} contract load${done.length === 1 ? "" : "s"} set up for next week`, detail: done.slice(0, 4).join(" · "), severity: "success" }));
  return done.length ? [`${done.length} contract loads made`] : [];
}
