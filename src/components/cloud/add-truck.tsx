"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useStore } from "@/lib/store";
import { FleetForm } from "./fleet-form";

/** Fleet page, real accounts: add trucks and the drivers who run them. */
export function AddTruckButton() {
  const [open, setOpen] = useState(false);
  const addToFleet = useStore((s) => s.actions.addToFleet);
  return (
    <>
      <Button size="sm" variant="primary" onClick={() => setOpen(true)}>
        <Plus className="h-3.5 w-3.5" /> Add a truck
      </Button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink-950/30 px-4 py-10" role="dialog" aria-modal="true" aria-label="Add a truck">
          <div className="w-full max-w-xl rounded-3xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-xl text-ink-950">Add a truck</h2>
                <p className="mt-0.5 text-sm text-ink-500">Then let the driver sign in from Settings → Billing &amp; Team.</p>
              </div>
              <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="rounded-full p-1.5 text-ink-400 hover:bg-ink-100">
                <X className="h-4 w-4" />
              </button>
            </div>
            <FleetForm
              solo={false}
              submitLabel="Add to my fleet"
              onSubmit={(entries) => {
                addToFleet(entries);
                setOpen(false);
              }}
            />
          </div>
        </div>
      )}
    </>
  );
}
