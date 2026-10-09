"use client";

import { useId, useState } from "react";
import { animate, motion, useMotionValue, useTransform } from "framer-motion";
import { useEffect } from "react";

/**
 * "What does this load really pay?": move the sliders and the numbers a dispatcher looks at change as you go. Nothing
 * leaves the page. Backroute's fee is the 2% of the load from the pricing below.
 */

const FEE = 0.02;

export function LoadMath() {
  const [rate, setRate] = useState(2400);
  const [loaded, setLoaded] = useState(820);
  const [empty, setEmpty] = useState(90);
  const [diesel, setDiesel] = useState(3.9);
  const [mpg, setMpg] = useState(6.5);
  const miles = loaded + empty;
  const fuel = (miles / mpg) * diesel;
  const fee = rate * FEE;
  const keep = rate - fuel - fee;
  const all = miles ? keep / miles : 0;

  return (
    <div className="grid gap-6 rounded-3xl bg-ink-100 p-5 sm:p-8 lg:grid-cols-[1.1fr_1fr] lg:gap-10">
      <div className="flex flex-col gap-6">
        <Slider label="The load pays" value={rate} min={300} max={6000} step={25} show={(v) => `$${v.toLocaleString()}`} onChange={setRate} />
        <Slider label="Loaded miles" value={loaded} min={50} max={2500} step={10} show={(v) => `${v.toLocaleString()} mi`} onChange={setLoaded} />
        <Slider label="Empty miles to the pickup" value={empty} min={0} max={400} step={5} show={(v) => `${v} mi`} onChange={setEmpty} />
        <div className="grid gap-6 sm:grid-cols-2">
          <Slider label="Diesel" value={diesel} min={2.5} max={6} step={0.05} show={(v) => `$${v.toFixed(2)}`} onChange={setDiesel} />
          <Slider label="Your truck's mpg" value={mpg} min={4.5} max={9} step={0.1} show={(v) => v.toFixed(1)} onChange={setMpg} />
        </div>
      </div>
      <div className="theme-invert flex flex-col justify-between rounded-2xl bg-black p-6 text-white">
        <div>
          <p className="text-sm text-ink-500">What you keep</p>
          <p className={`mt-1 text-[clamp(2.75rem,6vw,3.75rem)] font-semibold leading-none tracking-[-0.04em] tabular ${keep < 0 ? "text-[#F83446]" : ""}`}>
            <Count value={keep} money />
          </p>
          <p className="mt-2 text-sm text-ink-500">before driver pay, insurance and the truck note</p>
        </div>
        <dl className="mt-8 grid grid-cols-2 gap-x-4 gap-y-4 border-t border-line pt-5 text-sm">
          <Row label="Per loaded mile" value={loaded ? rate / loaded : 0} cents />
          <Row label="You keep per mile driven" value={all} cents />
          <Row label="Fuel" value={-fuel} money />
          <Row label="Backroute (2%)" value={-fee} money />
        </dl>
        {empty / Math.max(1, loaded) > 0.2 && (
          <p className="mt-5 rounded-xl bg-ink-100 px-4 py-3 text-sm">
            {Math.round((empty / loaded) * 100)}% of the miles are empty. A load closer to the truck often pays less and keeps more.
          </p>
        )}
      </div>
    </div>
  );
}

function Slider({ label, value, min, max, step, show, onChange }: { label: string; value: number; min: number; max: number; step: number; show: (v: number) => string; onChange: (v: number) => void }) {
  const id = useId();
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-[15px] font-medium text-ink-700">
          {label}
        </label>
        <span className="text-lg font-semibold tabular">{show(value)}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="range-ink mt-3 w-full"
        style={{ "--pct": `${pct}%` } as React.CSSProperties}
      />
    </div>
  );
}

function Row({ label, value, money, cents }: { label: string; value: number; money?: boolean; cents?: boolean }) {
  return (
    <div>
      <dt className="text-ink-500">{label}</dt>
      <dd className="mt-0.5 text-base font-semibold tabular">
        <Count value={value} money={money} cents={cents} />
      </dd>
    </div>
  );
}

/** A number that rolls to its new value instead of jumping. */
function Count({ value, money, cents }: { value: number; money?: boolean; cents?: boolean }) {
  const mv = useMotionValue(value);
  const text = useTransform(mv, (v) => {
    const sign = v < 0 ? "−" : "";
    const a = Math.abs(v);
    if (cents) return `${sign}$${a.toFixed(2)}`;
    return money ? `${sign}$${Math.round(a).toLocaleString()}` : Math.round(v).toLocaleString();
  });
  useEffect(() => {
    const c = animate(mv, value, { duration: 0.35, ease: "easeOut" });
    return () => c.stop();
  }, [mv, value]);
  return <motion.span>{text}</motion.span>;
}
