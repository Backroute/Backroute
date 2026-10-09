import Link from "next/link";
import { ArrowRight, Check, Moon } from "lucide-react";
import { demoAllowed } from "@/lib/cloud/demo";
import { Logo } from "@/components/shared/logo";
import { Button } from "@/components/ui/button";
import { PhonePreview } from "@/components/landing/phone-preview";
import { LoadStory } from "@/components/landing/load-story";
import { LoadMath } from "@/components/landing/load-math";
import { Reveal } from "@/components/landing/motion";

/** A sample day, labelled as one: what the product does, without made-up totals. */
const DAY = [
  { time: "5:40", text: "Marcus is two hours from delivery in Indianapolis. Backroute starts looking for his next load." },
  { time: "6:15", text: "It calls Coastal Freight about Indianapolis to Kansas City. They offer $1,000; it asks for $1,180." },
  { time: "6:22", text: "They settle at $1,107, above the $1,050 floor. It checks the broker's authority and credit." },
  { time: "6:23", text: "The owner gets one text: “Book Marcus to Kansas City for $1,107?” They reply yes.", you: true },
  { time: "6:30", text: "The rate con is signed and sent back. Marcus gets a call with the pickup address and the dock hours." },
  { time: "14:05", text: "Delivered. The proof of delivery goes to the broker with the invoice." },
];

const PLANS = [
  { name: "Starter", price: "$99", desc: "One truck, for owner-operators.", featured: false },
  { name: "Growth", price: "$499", desc: "Two to five trucks.", featured: true },
  { name: "Fleet", price: "$999", desc: "Six trucks or more.", featured: false },
];

/** What every plan does; the plans differ only by fleet size. */
const INCLUDED = [
  "Load search on every board you connect",
  "Broker calls, emails and counter-offers",
  "Rate cons signed, invoices sent, payments chased",
  "Driver app and calls in seven languages",
  "Plans of several loads, timed to legal hours",
  "One switch to pause it all",
];

const QUESTIONS = [
  { q: "Can I turn it off?", a: "Yes. One switch pauses everything Backroute does, and you can take over any load yourself at any time." },
  { q: "Who talks to the brokers?", a: "Backroute does, by phone, email and text, as your company's dispatcher. On calls it says it's an AI dispatcher and that the call is transcribed." },
  { q: "What if it gets something wrong?", a: "On “Ask me first” nothing is booked without your OK, and it never goes under your floor. For a breakdown or an emergency, a person on our team steps in." },
  { q: "What does it cost?", a: "A monthly plan for your fleet size, plus 2% of booked freight. Plans start at $99 a month for one truck." },
  { q: "What do I connect?", a: "Your email, your ELD (Samsara or Motive), your load boards (DAT, Truckstop) and QuickBooks Online if you use it. Setup takes about five minutes." },
  { q: "Who can see my data?", a: "Only your company. Each carrier's data is walled off from every other, and logins to broker websites are encrypted." },
];

const H2 = "text-[clamp(2rem,4.2vw,3.25rem)] font-medium leading-[1.06] tracking-[-0.035em] text-balance";

export default function Home() {
  return (
    <div className="flex-1 bg-white text-ink-950">
      <header className="theme-ink sticky top-0 z-30 bg-black text-white">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-5 sm:px-8">
          <Logo dark className="text-[22px]" />
          <nav className="hidden items-center gap-1 text-[15px] font-medium md:flex">
            {[["#product", "Product"], ["#drivers", "Drivers"], ["#pricing", "Pricing"], ["#questions", "Questions"]].map(([href, label]) => (
              <a key={href} href={href} className="rounded-full px-3.5 py-2 text-white/85 transition-colors hover:bg-white/10 hover:text-white">
                {label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <Link href="/login" className="rounded-full px-3.5 py-2 text-[15px] font-medium text-white/85 transition-colors hover:bg-white/10 hover:text-white">
              Log in
            </Link>
            <Link href="/signup" className="rounded-full bg-white px-4 py-2 text-[15px] font-semibold text-black transition-colors hover:bg-[#e2e2e2]">
              Get started
            </Link>
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 pb-16 pt-12 sm:px-8 sm:pb-20 md:pt-20 lg:grid-cols-[1.35fr_1fr] lg:gap-10 lg:pb-28">
          <Reveal>
            <p className="text-[15px] font-medium text-ink-500">The AI dispatcher for small fleets</p>
            <h1 className="mt-5 text-[clamp(2.75rem,6.4vw,5.25rem)] font-medium leading-[1] tracking-[-0.04em] text-balance">
              Your next load
              <br />
              is already booked.
            </h1>
            <p className="mt-6 max-w-xl text-[clamp(1.125rem,1.5vw,1.3125rem)] leading-[1.45] text-ink-600">
              Backroute finds the load, calls the broker, books at your rate and keeps your drivers in the loop. You answer the few things that need you, from your phone.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Button href="/signup" size="lg" className="w-full !px-7 sm:w-auto">
                Get started <ArrowRight className="h-4 w-4" />
              </Button>
              {demoAllowed && (
                <Button href="/demo" size="lg" variant="secondary" className="w-full !px-7 sm:w-auto">
                  See a sample fleet
                </Button>
              )}
            </div>
            <p className="mt-10 text-sm text-ink-500">
              Works with DAT, Truckstop, Samsara, Motive and QuickBooks Online.
            </p>
          </Reveal>
          <Reveal delay={0.12}>
            <PhonePreview />
          </Reveal>
        </div>
      </section>

      <section id="product" className="scroll-mt-16 bg-ink-100">
        <div className="mx-auto max-w-6xl px-5 pt-14 sm:px-8 sm:pt-20 md:pt-28">
          <Reveal>
            <h2 className={`${H2} max-w-3xl`}>From load board to paid invoice.</h2>
            <p className="mt-4 max-w-2xl text-lg leading-relaxed text-ink-600">The whole job a dispatcher does, every day, for every truck. Scroll through one load.</p>
          </Reveal>
          <LoadStory />
          <div className="h-14 sm:h-20 md:h-16" />
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl items-center gap-12 px-5 py-14 sm:px-8 sm:py-20 md:py-28 lg:grid-cols-2 lg:gap-16">
        <Reveal>
          <h2 className={H2}>Every load, the real numbers.</h2>
          <p className="mt-5 max-w-lg text-lg leading-relaxed text-ink-600">
            What the load pays, every cost, what&apos;s left, and how long it really takes. Drive time is planned on the hours-of-service rules: 11 hours a day solo, around the clock for a team truck.
          </p>
          <ul className="mt-8 flex flex-col gap-3 text-[16px]">
            {["Back-to-back loads and partials sharing a trailer, offered as one plan", "Each night's rest marked on the road", "Pickup and delivery in each dock's own time"].map((t) => (
              <li key={t} className="flex gap-3">
                <Check className="mt-0.5 h-5 w-5 shrink-0" strokeWidth={2.5} />
                {t}
              </li>
            ))}
          </ul>
        </Reveal>
        <div className="mx-auto w-full max-w-md">
          <SampleLoad />
        </div>
      </section>

      <section className="border-t border-line">
        <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8 sm:py-20 md:py-28">
          <Reveal>
            <p className="text-sm font-semibold text-ink-500">Try it</p>
            <h2 className={`${H2} mt-2 max-w-3xl`}>What does that load really pay?</h2>
            <p className="mt-4 max-w-2xl text-lg leading-relaxed text-ink-600">The math Backroute does on every load before it calls a broker. Move the sliders.</p>
          </Reveal>
          <div className="mt-10">
            <LoadMath />
          </div>
        </div>
      </section>

      <section className="border-t border-line">
        <div className="mx-auto grid max-w-6xl gap-12 px-5 py-14 sm:px-8 sm:py-20 md:py-28 lg:grid-cols-[1fr_1.3fr] lg:gap-16">
          <div>
            <p className="text-sm font-semibold text-ink-500">A sample day</p>
            <h2 className={`${H2} mt-2`}>A Tuesday, handled.</h2>
            <p className="mt-5 max-w-sm text-lg leading-relaxed text-ink-600">One truck, one morning. The owner&apos;s part is a single text.</p>
          </div>
          <ol className="flex flex-col">
            {DAY.map((d, i) => (
              <li key={d.time}>
                <Reveal delay={i * 0.05} className={`grid gap-1 rounded-xl px-4 py-3.5 sm:grid-cols-[4.25rem_1fr] sm:gap-4 sm:py-4 ${d.you ? "bg-black text-white" : ""}`}>
                  <span className={`pt-0.5 text-sm font-semibold tabular ${d.you ? "text-white" : "text-ink-500"}`}>{d.time}</span>
                  <p className={`text-[17px] leading-relaxed ${d.you ? "font-semibold" : "text-ink-700"}`}>{d.text}</p>
                </Reveal>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="drivers" className="theme-ink scroll-mt-16 bg-black text-white">
        <div className="mx-auto grid max-w-6xl gap-12 px-5 py-14 sm:px-8 sm:py-20 md:py-28 lg:grid-cols-2">
          <Reveal>
            <p className="text-sm font-semibold text-white/60">For drivers</p>
            <h2 className={`${H2} mt-2`}>One dispatcher. In their language.</h2>
            <p className="mt-5 max-w-md text-lg leading-relaxed text-white/70">
              It calls when something changes, calls back when they miss it, and texts when they&apos;re off duty.
            </p>
          </Reveal>
          <ul className="grid gap-3 sm:grid-cols-2">
            {[
              { t: "Calls and texts in seven languages", b: "English, Spanish, Punjabi, Hindi, Russian, Ukrainian and French." },
              { t: "Hands-free while driving", b: "Big buttons and voice: “I've arrived,” “running late,” “call dispatch.”" },
              { t: "Told when plans change", b: "A moved appointment, a new load lined up, a delay: a call, not a surprise at the dock." },
              { t: "Pay and home time on one screen", b: "No more calling the office to ask." },
            ].map((x, i) => (
              <li key={x.t}>
                <Reveal delay={i * 0.06} className="h-full rounded-2xl bg-white/[0.08] p-5">
                  <p className="text-[17px] font-semibold">{x.t}</p>
                  <p className="mt-1.5 text-[15px] leading-relaxed text-white/70">{x.b}</p>
                </Reveal>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section id="pricing" className="scroll-mt-16 mx-auto max-w-6xl px-5 py-14 sm:px-8 sm:py-20 md:py-28">
        <Reveal>
          <h2 className={H2}>Simple pricing.</h2>
          <p className="mt-4 max-w-xl text-lg leading-relaxed text-ink-600">A monthly plan for your fleet size, plus 2% of booked freight.</p>
        </Reveal>
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {PLANS.map((p) => (
            <div key={p.name} className={`flex flex-col rounded-2xl p-6 transition-transform duration-300 hover:-translate-y-1 sm:p-7 ${p.featured ? "theme-invert bg-black" : "bg-ink-100"}`}>
              <div className="flex items-center justify-between">
                <p className="text-lg font-semibold">{p.name}</p>
                {p.featured && <span className="rounded-full bg-ink-950 px-2.5 py-1 text-xs font-semibold text-ink-0">Most fleets</span>}
              </div>
              <p className="mt-6 text-5xl font-semibold tracking-[-0.04em] tabular">
                {p.price}
                <span className="text-base font-medium tracking-normal text-ink-500"> /month</span>
              </p>
              <p className="mt-2 text-[15px] text-ink-600">{p.desc}</p>
              <Button href="/signup" size="lg" className="mt-8 w-full">
                Get started
              </Button>
            </div>
          ))}
        </div>
        <div className="mt-10 rounded-2xl border border-line p-7">
          <p className="text-lg font-semibold">Every plan includes</p>
          <ul className="mt-5 grid gap-x-8 gap-y-3 text-[16px] sm:grid-cols-2 lg:grid-cols-3">
            {INCLUDED.map((t) => (
              <li key={t} className="flex gap-3">
                <Check className="mt-0.5 h-5 w-5 shrink-0" strokeWidth={2.5} />
                {t}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section id="questions" className="scroll-mt-16 bg-ink-100">
        <div className="mx-auto max-w-3xl px-5 py-14 sm:px-8 sm:py-20 md:py-28">
          <h2 className={H2}>Questions.</h2>
          <div className="mt-10 flex flex-col">
            {QUESTIONS.map((x) => (
              <details key={x.q} className="group border-b border-line-strong py-5 first:border-t">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-lg font-semibold [&::-webkit-details-marker]:hidden">
                  {x.q}
                  <span aria-hidden className="text-2xl font-normal leading-none transition-transform group-open:rotate-45">+</span>
                </summary>
                <p className="mt-3 max-w-2xl text-[17px] leading-relaxed text-ink-600">{x.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-16 text-center sm:px-8 sm:py-24 md:py-32">
        <h2 className="mx-auto max-w-3xl text-[clamp(2.25rem,5vw,4rem)] font-medium leading-[1.04] tracking-[-0.04em] text-balance">
          Spend tomorrow driving, not dialing brokers.
        </h2>
        <div className="mx-auto mt-9 flex max-w-sm flex-col gap-3 sm:max-w-none sm:flex-row sm:justify-center">
          <Button href="/signup" size="lg" className="w-full !px-7 sm:w-auto">
            Get started <ArrowRight className="h-4 w-4" />
          </Button>
          {demoAllowed && (
            <Button href="/demo" size="lg" variant="secondary" className="w-full !px-7 sm:w-auto">
              See a sample fleet
            </Button>
          )}
        </div>
      </section>

      <footer className="theme-ink bg-black text-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-8 px-5 py-14 sm:flex-row sm:items-start sm:justify-between sm:px-8">
          <div>
            <Logo dark className="text-[22px]" />
            <p className="mt-2 text-[15px] text-white/70">The dispatcher for owner-operators and small fleets.</p>
          </div>
          <nav className="flex flex-wrap gap-x-8 gap-y-3 text-[15px] text-white/85">
            <a href="#product" className="hover:text-white">Product</a>
            <a href="#pricing" className="hover:text-white">Pricing</a>
            <Link href="/login" className="hover:text-white">Log in</Link>
            <a href="mailto:hello@backroute.pro" className="hover:text-white">hello@backroute.pro</a>
          </nav>
        </div>
        <p className="mx-auto max-w-6xl px-5 pb-10 text-sm text-white/50 sm:px-8">© 2026 Backroute, Inc.</p>
      </footer>
    </div>
  );
}

/** A load card as the app shows it, drawn with sample numbers (labelled as a sample). */
function SampleLoad() {
  return (
    <div aria-label="A sample load card" className="theme-invert w-full rounded-3xl bg-black p-6 text-white shadow-[0_30px_60px_-30px_rgb(0_0_0/0.5)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[13px] font-semibold text-[var(--link)]">Long run · 4 days</p>
          <p className="mt-1 text-lg font-semibold">Sample broker</p>
          <p className="text-sm text-ink-500">Dry van · 38k lb</p>
        </div>
        <span className="flex h-14 w-14 items-center justify-center rounded-full border-[3px] border-ink-950 text-xl font-semibold tabular">91</span>
      </div>
      <ol className="mt-6 flex flex-col gap-3 text-[15px]">
        <li className="flex justify-between gap-3">
          <span><span className="font-semibold">Chicago,</span> <span className="text-ink-500">IL</span></span>
          <span className="text-right text-ink-500">Mon · 8–11 am CDT</span>
        </li>
        <li className="flex items-center gap-2 pl-1 text-[13px] text-ink-500">
          <Moon className="h-3.5 w-3.5" /> Rests near Lincoln, Colorado Springs, Phoenix
        </li>
        <li className="flex justify-between gap-3">
          <span><span className="font-semibold">Los Angeles,</span> <span className="text-ink-500">CA</span></span>
          <span className="text-right text-ink-500">Thu · 6–9 am PDT</span>
        </li>
      </ol>
      <div className="mt-6 grid grid-cols-3 border-y border-line py-4 text-sm">
        <div><p className="text-ink-500">You drive</p><p className="mt-0.5 text-base font-semibold tabular">2,015 mi</p></div>
        <div><p className="text-ink-500">Days out</p><p className="mt-0.5 text-base font-semibold tabular">4 days</p></div>
        <div><p className="text-ink-500">Reload</p><p className="mt-0.5 text-base font-semibold">Easy</p></div>
      </div>
      <div className="mt-4 flex items-end justify-between rounded-2xl bg-ink-100 p-4">
        <div>
          <p className="text-sm text-ink-500">Load pays</p>
          <p className="text-[34px] font-semibold leading-none tracking-[-0.04em] tabular">$4,190</p>
        </div>
        <p className="text-right text-sm text-ink-500">
          <span className="font-semibold text-ink-950">$2.08</span>/mi
          <br />
          <span className="font-semibold text-ink-950">$2,604</span> after costs
        </p>
      </div>
      <p className="mt-4 rounded-xl bg-[var(--action)] py-3.5 text-center text-[15px] font-semibold text-[var(--action-ink)]">Book it</p>
      <p className="mt-3 text-center text-xs text-ink-500">Sample numbers</p>
    </div>
  );
}
