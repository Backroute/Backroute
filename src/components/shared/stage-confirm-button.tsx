"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { STAGE_CONFIRM } from "@/lib/stage-confirm";
import type { LoadStage } from "@/lib/types";

/** The stage-confirm action, with a brief "capturing" state on the document-bearing stages (at_pickup,
 *  at_delivery) — a short spinner + relabel before the card advances, instead of an instant silent
 *  jump, so tapping "Capture BOL" reads like it actually took a photo before the card updates. */
export function StageConfirmButton({
  loadId,
  stage,
  onConfirm,
}: {
  loadId: string;
  stage: LoadStage;
  onConfirm: (loadId: string) => void;
}) {
  const [capturing, setCapturing] = useState(false);
  const step = STAGE_CONFIRM[stage];
  if (!step) return null;
  const Icon = capturing ? Loader2 : step.icon;

  async function handleClick() {
    if (capturing) return;
    if (step!.doc) {
      setCapturing(true);
      await new Promise((resolve) => setTimeout(resolve, 700));
      setCapturing(false);
    }
    onConfirm(loadId);
  }

  return (
    <button
      onClick={handleClick}
      disabled={capturing}
      className={cn(
        "flex items-center justify-center gap-2 rounded-full bg-white py-3 text-sm font-semibold text-ink-950 transition-opacity",
        capturing && "opacity-70",
      )}
    >
      <Icon className={cn("h-4 w-4", capturing && "animate-spin")} />
      {capturing ? `Capturing ${step.doc === "bol" ? "BOL" : "POD"}…` : step.label}
    </button>
  );
}
