"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, FolderOpen, X } from "lucide-react";
import { useDriverUi } from "@/lib/lang/use-driver-ui";
import { frameHint, type FrameHint } from "@/lib/photo-check";
import { cn } from "@/lib/utils";

/** How often a frame is looked at, and how small: quick enough to follow the driver's hand, light on the battery. */
const EVERY_MS = 350;
const LOOK_W = 240;

/**
 * The camera, with a hint that changes as the driver lines up the page: too dark, glare, hold still, get the whole
 * page in, then "looks good" and the button lights up. Catches the bad photo at the dock instead of at billing.
 * No camera (a laptop, permission said no): straight to choosing a file instead.
 */
export function LiveScanner({ label, onPhoto, onFile, onClose }: { label: string; onPhoto: (file: File) => void; onFile: () => void; onClose: () => void }) {
  const { t } = useDriverUi();
  const video = useRef<HTMLVideoElement>(null);
  const [hint, setHint] = useState<FrameHint | null | "starting">("starting");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let off = false;
    const look = document.createElement("canvas");
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false })
      .then(async (s) => {
        if (off) return s.getTracks().forEach((tr) => tr.stop());
        stream = s;
        const v = video.current!;
        v.srcObject = s;
        await v.play().catch(() => {});
        timer = setInterval(() => {
          if (!v.videoWidth) return;
          const h = Math.max(1, Math.round((v.videoHeight / v.videoWidth) * LOOK_W));
          look.width = LOOK_W;
          look.height = h;
          const ctx = look.getContext("2d", { willReadFrequently: true });
          if (!ctx) return;
          ctx.drawImage(v, 0, 0, LOOK_W, h);
          const { data } = ctx.getImageData(0, 0, LOOK_W, h);
          const gray = new Uint8ClampedArray(LOOK_W * h);
          for (let i = 0; i < gray.length; i++) gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
          setHint(frameHint(gray, LOOK_W, h));
        }, EVERY_MS);
      })
      .catch(() => !off && setFailed(true));
    return () => {
      off = true;
      if (timer) clearInterval(timer);
      stream?.getTracks().forEach((tr) => tr.stop());
    };
  }, []);

  function take() {
    const v = video.current;
    if (!v?.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")?.drawImage(v, 0, 0);
    c.toBlob((b) => b && onPhoto(new File([b], `${label.replace(/\W+/g, "-").toLowerCase()}-${Date.now()}.jpg`, { type: "image/jpeg" })), "image/jpeg", 0.9);
  }

  const words = hint === "starting" ? "" : hint === "dark" ? t.scanDark : hint === "bright" ? t.scanBright : hint === "blurry" ? t.scanBlurry : hint === "far" ? t.scanFar : t.scanGood;
  const good = hint === null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-white" role="dialog" aria-modal="true" aria-label={label}>
      <div className="flex items-center justify-between px-4 pb-2 pt-[max(env(safe-area-inset-top),12px)]">
        <p className="text-sm font-semibold">{label}</p>
        <button type="button" onClick={onClose} aria-label={t.scanClose} className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10">
          <X className="h-5 w-5" />
        </button>
      </div>
      {failed ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
          <p className="text-sm text-white/80">{t.scanNoCamera}</p>
          <button type="button" onClick={onFile} className="inline-flex min-h-12 items-center gap-2 rounded-full bg-white px-5 text-sm font-semibold text-ink-950">
            <FolderOpen className="h-4 w-4" /> {t.scanFile}
          </button>
        </div>
      ) : (
        <>
          <div className="relative flex-1 overflow-hidden">
            <video ref={video} playsInline muted className="h-full w-full object-cover" />
            {/* The page goes inside the frame; it turns solid when the picture is good. */}
            <div aria-hidden className={cn("pointer-events-none absolute inset-x-6 inset-y-10 rounded-2xl border-2 transition-colors", good ? "border-[var(--accent-live)]" : "border-dashed border-white/60")} />
            {words && (
              <p role="status" aria-live="polite" className={cn("absolute inset-x-0 bottom-4 mx-auto w-fit max-w-[90%] rounded-full px-4 py-2 text-center text-sm font-semibold", good ? "bg-[var(--accent-live)] text-white" : "bg-black/70 text-white")}>
                {words}
              </p>
            )}
          </div>
          <div className="flex items-center justify-between gap-4 px-6 pb-[max(env(safe-area-inset-bottom),20px)] pt-4">
            <button type="button" onClick={onFile} className="inline-flex min-h-11 items-center gap-1.5 text-xs font-medium text-white/80">
              <FolderOpen className="h-4 w-4" /> {t.scanFile}
            </button>
            <button type="button" onClick={take} aria-label={t.scanTake} className={cn("flex h-18 w-18 items-center justify-center rounded-full border-4", good ? "border-[var(--accent-live)] bg-white" : "border-white/50 bg-white/80")}>
              <Camera className="h-7 w-7 text-ink-950" />
            </button>
            <span className="w-24" aria-hidden />
          </div>
        </>
      )}
    </div>
  );
}
