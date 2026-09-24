"use client";

import { Phone } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useCarrierDrivers } from "@/lib/selectors";
import { DISPATCH_LINE } from "@/lib/dispatch-calls";

/** The carrier's dispatch number: the AI answers it, and calls and texts drivers from it — including drivers who
 *  never install the app. In the demo it isn't connected to a phone provider, and says so. */
export function DispatchLineCard() {
  const drivers = useCarrierDrivers();
  const onPhone = drivers.filter((d) => d.prefs?.reach === "phone");
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Dispatch phone line</CardTitle>
          <CardDescription>Drivers call or text this number any time and the AI answers. It calls and texts drivers from it too.</CardDescription>
        </div>
        <Badge tone="warning">Demo · not connected</Badge>
      </CardHeader>
      <CardContent className="!pt-3 grid gap-4 sm:grid-cols-3">
        <div>
          <p className="text-[11px] uppercase tracking-wider text-ink-400">Number</p>
          <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-ink-950">
            <Phone className="h-3.5 w-3.5" /> {DISPATCH_LINE}
          </p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wider text-ink-400">Drivers on regular phone</p>
          <p className="mt-1 text-sm text-ink-950">
            {onPhone.length ? onPhone.map((d) => d.name.split(" ")[0]).join(", ") : "None. Everyone uses the app"}
          </p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wider text-ink-400">When a driver asks for a person</p>
          <p className="mt-1 text-sm text-ink-950">You get a call-back task in Needs you</p>
        </div>
        <p className="text-xs text-ink-500 sm:col-span-3">
          To go live, connect a phone provider (for example Twilio) under Integrations. Until then calls ring inside the driver app and texts land in its Messages.
        </p>
      </CardContent>
    </Card>
  );
}
