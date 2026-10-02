"use client";

import { Sheet } from "@/components/ui/sheet";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { authHeader } from "@/lib/ai/client";
import { OWNER_ATTESTS } from "@/lib/consent-words";
import { usePrimaryCarrier } from "@/lib/selectors";
import { useStore } from "@/lib/store";
import { FleetForm } from "./fleet-form";

/** Fleet page, real accounts: add trucks and the drivers who run them. */
export function AddTruckButton() {
  const [open, setOpen] = useState(false);
  const addToFleet = useStore((s) => s.actions.addToFleet);
  const carrier = usePrimaryCarrier();
  // The owner says each driver agreed to texts and calls (docs/legal/driver-text-consent.md); it's recorded.
  const [agreed, setAgreed] = useState(false);
  const [needAgree, setNeedAgree] = useState(false);
  return (
    <>
      <Button size="sm" variant="primary" onClick={() => setOpen(true)}>
        <Plus className="h-3.5 w-3.5" /> Add a truck
      </Button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Add a truck" description="Then let the driver sign in from Settings → Billing & Team." size="lg">
          <div>
            <label className="mb-3 flex items-start gap-2 rounded-2xl bg-ink-50 p-3 text-xs text-ink-700">
              <input type="checkbox" className="mt-0.5" checked={agreed} onChange={(e) => (setAgreed(e.target.checked), setNeedAgree(false))} />
              <span>{OWNER_ATTESTS(carrier.name)}</span>
            </label>
            {needAgree && <p className="-mt-1 mb-3 text-xs text-[var(--accent-danger)]">Check this first: the AI texts and calls each driver.</p>}
            <FleetForm
              solo={false}
              submitLabel="Add to my fleet"
              onSubmit={(entries) => {
                if (!agreed) return setNeedAgree(true);
                addToFleet(entries);
                const phones = entries.map((e) => e.phone);
                void authHeader().then((h) => fetch("/api/consent", { method: "POST", headers: { "content-type": "application/json", ...h }, body: JSON.stringify({ op: "attest", phones }) }).catch(() => null));
                setOpen(false);
                setAgreed(false);
              }}
            />
          </div>
      </Sheet>
    </>
  );
}
