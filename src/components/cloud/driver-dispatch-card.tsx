"use client";

import { useCallback, useEffect, useState } from "react";
import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { authHeader } from "@/lib/ai/client";
import { DRIVER_AGREES } from "@/lib/consent-words";
import { DISPATCH_UI } from "@/lib/lang/dispatch-ui";
import { usePrimaryCarrier, usePrimaryDriver } from "@/lib/selectors";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { PhoneAlerts } from "./phone-alerts";

// The dispatch line's WhatsApp number, for the "message dispatch on WhatsApp" link (set only when WhatsApp is on).
const WHATSAPP = (process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? "").replace(/\D/g, "");

interface Mine {
  granted: boolean;
  at: string;
}

async function myConsent(): Promise<Mine | null> {
  const res = await fetch("/api/consent", { headers: await authHeader() });
  if (!res.ok) throw new Error("load");
  return ((await res.json()) as { mine: Mine | null }).mine;
}

/**
 * The driver's yes to texts and calls from dispatch, asked once, in their app language. Shown on Home until they
 * answer; on Profile it stays, with what they said and when.
 */
export function ConsentCard({ always = false }: { always?: boolean }) {
  const driver = usePrimaryDriver();
  const carrier = usePrimaryCarrier();
  const real = useStore((s) => s.session.mode !== "demo");
  const lang = driver.prefs?.appLanguage ?? "en";
  const t = DISPATCH_UI[lang];
  const [mine, setMine] = useState<Mine | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!real) return;
    myConsent()
      .then(setMine)
      .catch(() => setMine(undefined));
  }, [real]);

  async function answer(granted: boolean) {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/consent", { method: "POST", headers: { "content-type": "application/json", ...(await authHeader()) }, body: JSON.stringify({ op: "agree", granted, lang }) });
      if (!res.ok) throw new Error("save");
      setMine({ granted, at: new Date().toISOString() });
    } catch {
      setNote(t.failed);
    } finally {
      setBusy(false);
    }
  }

  if (!real || mine === undefined) return null;
  if (mine?.granted && !always) return null;
  return (
    <section className="rounded-2xl border border-line p-4" aria-label={t.consentTitle}>
      <p className="text-xs font-semibold uppercase tracking-wider text-ink-400">{t.consentTitle}</p>
      {mine ? (
        <p className="mt-1.5 text-sm text-ink-700">{mine.granted ? t.agreed(new Date(mine.at).toLocaleDateString(lang)) : t.declined}</p>
      ) : (
        <p className="mt-1.5 text-sm font-medium text-ink-900">{t.consentAsk}</p>
      )}
      {(!mine || !mine.granted) && (
        <>
          <p className="mt-2 text-xs leading-relaxed text-ink-500" lang={lang}>
            {DRIVER_AGREES[lang](carrier.name)}
          </p>
          <div className="mt-3 flex gap-2">
            <Button size="sm" disabled={busy} onClick={() => void answer(true)}>
              {busy ? t.saving : t.agree}
            </Button>
            {!mine && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void answer(false)}>
                {t.decline}
              </Button>
            )}
          </div>
        </>
      )}
      {note && <p className="mt-2 text-xs text-[var(--accent-danger)]">{note}</p>}
    </section>
  );
}

/** How dispatch reaches the driver: notifications on this phone, SMS or WhatsApp, the morning text, voice answers. */
export function DriverDispatchCard() {
  const driver = usePrimaryDriver();
  const real = useStore((s) => s.session.mode !== "demo");
  const setDriverPrefs = useStore((s) => s.actions.setDriverPrefs);
  const lang = driver.prefs?.appLanguage ?? "en";
  const t = DISPATCH_UI[lang];
  const prefs = driver.prefs ?? {};
  const by = prefs.textsBy ?? "sms";
  const radio = useCallback((on: boolean) => cn("rounded-full border py-1.5 text-xs font-medium", on ? "border-ink-950 bg-ink-950 text-white" : "border-line text-ink-600"), []);
  if (!real) return null;
  return (
    <section id="dispatch" className="scroll-mt-4 rounded-2xl border border-line p-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-ink-400">{t.title}</p>
      <div className="mt-3">
        <PhoneAlerts words={t.alerts} lang={driver.prefs?.language ?? "en"} />
      </div>
      <div className="mt-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-ink-800">{t.textsToo}</p>
          <p className="text-[11px] text-ink-500">{t.textsTooNote}</p>
        </div>
        <Switch checked={prefs.textsToo !== false} onChange={(on) => setDriverPrefs(driver.id, { textsToo: on })} label={t.textsToo} />
      </div>
      {WHATSAPP && (
        <>
          <p className="mt-4 text-xs font-medium text-ink-800">{t.textsBy}</p>
          <div className="mt-1.5 grid grid-cols-2 gap-1.5" role="radiogroup" aria-label={t.textsBy}>
            {(["sms", "whatsapp"] as const).map((v) => (
              <button key={v} type="button" role="radio" aria-checked={by === v} onClick={() => setDriverPrefs(driver.id, { textsBy: v })} className={radio(by === v)}>
                {v === "sms" ? t.sms : t.whatsapp}
              </button>
            ))}
          </div>
          <a href={`https://wa.me/${WHATSAPP}`} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-ink-950 underline-offset-2 hover:underline">
            <MessageCircle className="h-3.5 w-3.5" /> {t.openWhatsApp}
          </a>
        </>
      )}
      <div className="mt-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-ink-800">{t.autoDrive}</p>
          <p className="text-[11px] text-ink-500">{t.autoDriveNote}</p>
        </div>
        <Switch checked={prefs.handsFreeAuto !== false} onChange={(on) => setDriverPrefs(driver.id, { handsFreeAuto: on })} label={t.autoDrive} />
      </div>
      <p className="mt-2 text-[11px] text-ink-500">{t.locationNote}</p>
      <div className="mt-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-ink-800">{t.hosVoice}</p>
          <p className="text-[11px] text-ink-500">{t.hosVoiceNote}</p>
        </div>
        <Switch checked={prefs.hosVoice !== false} onChange={(on) => setDriverPrefs(driver.id, { hosVoice: on })} label={t.hosVoice} />
      </div>
      <div className="mt-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-ink-800">{t.morning}</p>
          <p className="text-[11px] text-ink-500">{t.morningNote}</p>
        </div>
        <Switch checked={prefs.morningBrief !== false} onChange={(on) => setDriverPrefs(driver.id, { morningBrief: on })} label={t.morning} />
      </div>
      <div className="mt-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-ink-800">{t.voice}</p>
          <p className="text-[11px] text-ink-500">{t.voiceNote}</p>
        </div>
        <Switch checked={prefs.voiceReplies !== false} onChange={(on) => setDriverPrefs(driver.id, { voiceReplies: on })} label={t.voice} />
      </div>
    </section>
  );
}
