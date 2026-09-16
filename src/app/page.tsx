import Link from "next/link";
import { ArrowUpRight, Mail, MessageSquare, Phone, Radar, ShieldCheck, Truck, Users } from "lucide-react";
import { Logo } from "@/components/shared/logo";
import { Button } from "@/components/ui/button";
import { LiveTicker } from "@/components/landing/live-ticker";

const PROBLEM_STATS = [
  { value: "$1,500", label: "Avg. paid dispatch, per truck / month" },
  { value: "15–30", label: "Broker calls just to book one load" },
  { value: "1 in 5", label: "Miles run empty — no next load planned" },
  { value: "Zero", label: "Learning from past rate calls & emails" },
];

const SOLUTION_STEPS = [
  {
    n: "01",
    title: "Find & Score",
    body: "Scans 15+ boards plus email inboxes continuously. Scores true net profit after deadhead, fuel, and tolls — not just headline rate.",
    icon: Radar,
  },
  {
    n: "02",
    title: "Negotiate",
    body: "Email, SMS, and voice agents work every channel in parallel, holding your rate floor without ever tipping your hand.",
    icon: MessageSquare,
  },
  {
    n: "03",
    title: "Book & Confirm",
    body: "Accepts the load, validates the rate confirmation line by line, and writes a clean record into your TMS automatically.",
    icon: ShieldCheck,
  },
  {
    n: "04",
    title: "Execute & Chain",
    body: "Handles check calls, documents, and exceptions — then pre-negotiates the next load before this one even delivers.",
    icon: Truck,
  },
];

const CHANNELS = [
  {
    icon: Mail,
    title: "Email AI",
    points: ["Reads and extracts rate offers", "Drafts market-backed counters", "Validates rate confirmations", "Creates audit-ready records"],
  },
  {
    icon: MessageSquare,
    title: "SMS Agents",
    points: ["Instant rate checks", "Quick counters and holds", "Driver and broker short loops", "Works while on the road"],
  },
  {
    icon: Phone,
    title: "Voice Agents",
    points: ["Real negotiation calls", "Holds hard rate floors", "Builds urgency and rapport", "Available 24/7"],
  },
];

const PLANS = [
  { name: "Starter", price: "$99", desc: "Owner-operator. 1 truck.", featured: false },
  { name: "Growth", price: "$499", desc: "2–5 trucks.", featured: true },
  { name: "Fleet", price: "$999", desc: "6+ trucks.", featured: false },
];

const PORTALS = [
  {
    href: "/carrier",
    eyebrow: "For carriers",
    title: "Carrier Dashboard",
    body: "Watch the AI source, negotiate, and book loads for your whole fleet — and see exactly what you're saving vs. a human dispatcher.",
    icon: Truck,
  },
  {
    href: "/driver",
    eyebrow: "For drivers",
    title: "Driver App",
    body: "Current load, next load already chained, documents, and a direct line to your AI dispatcher — in your pocket.",
    icon: Users,
  },
  {
    href: "/ops",
    eyebrow: "Internal",
    title: "Backroute Ops",
    body: "Mission control for the agent fleet — every carrier, every call, every broker scorecard, across the platform.",
    icon: Radar,
  },
];

export default function Home() {
  return (
    <div className="flex-1 bg-white">
      <header className="sticky top-0 z-30 border-b border-line bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Logo />
          <nav className="hidden items-center gap-8 text-sm font-medium text-ink-600 sm:flex">
            <a href="#solution" className="hover:text-ink-950">Product</a>
            <a href="#channels" className="hover:text-ink-950">Agents</a>
            <a href="#pricing" className="hover:text-ink-950">Pricing</a>
          </nav>
          <div className="flex items-center gap-2">
            <Button href="/carrier" variant="secondary" size="sm">Carrier login</Button>
            <Button href="/ops" variant="primary" size="sm">Backroute Ops</Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="grain-overlay relative overflow-hidden bg-ink-950">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(255,255,255,0.08),_transparent_60%)]" />
        <div className="relative mx-auto max-w-6xl px-6 pt-20 pb-16 sm:pt-28 sm:pb-24">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/15 px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-white/60">
            Pre-seed · raising $700K SAFE
          </div>
          <h1 className="mt-6 max-w-3xl font-display text-5xl leading-[1.05] text-white sm:text-6xl">
            The fully autonomous <span className="italic">AI dispatcher</span> for carriers.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-white/60">
            You drive. We find, negotiate, book, track, document, and chain the next load — across email, SMS, and voice. No human dispatcher required.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Button href="/carrier" size="lg" variant="secondary" className="!bg-white !text-ink-950 hover:!bg-white/90">
              Enter Carrier Dashboard <ArrowUpRight className="h-4 w-4" />
            </Button>
            <Button href="/driver" size="lg" variant="outline" className="!border-white/25 !text-white hover:!border-white">
              Open Driver App
            </Button>
          </div>

          <div className="mt-16 grid grid-cols-2 gap-6 border-t border-white/10 pt-8 sm:grid-cols-4">
            {[
              { v: "$20B", l: "Serviceable addressable market" },
              { v: "91.5%", l: "Of carriers run fleets under 10 trucks" },
              { v: "$99+2%", l: "Flat pricing, every plan" },
              { v: "24/7", l: "Voice, SMS & email coverage" },
            ].map((s) => (
              <div key={s.l}>
                <p className="font-display text-2xl text-white">{s.v}</p>
                <p className="mt-1 text-xs text-white/45">{s.l}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Portal picker */}
      <section className="mx-auto max-w-6xl px-6 py-16 sm:py-20">
        <p className="text-[11px] font-medium uppercase tracking-wider text-ink-400">One platform, three experiences</p>
        <h2 className="mt-2 font-display text-3xl text-ink-950">Built for everyone the load touches.</h2>
        <div className="mt-8 grid gap-5 sm:grid-cols-3">
          {PORTALS.map((p) => (
            <Link
              key={p.href}
              href={p.href}
              className="group flex flex-col justify-between rounded-3xl border border-line bg-white p-7 transition-all hover:-translate-y-0.5 hover:border-ink-950 hover:shadow-[0_20px_40px_-25px_rgba(0,0,0,0.35)]"
            >
              <div>
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-ink-950 text-white">
                  <p.icon className="h-5 w-5" strokeWidth={1.75} />
                </div>
                <p className="mt-5 text-[11px] font-medium uppercase tracking-wider text-ink-400">{p.eyebrow}</p>
                <p className="mt-1 font-display text-2xl text-ink-950">{p.title}</p>
                <p className="mt-3 text-sm leading-relaxed text-ink-500">{p.body}</p>
              </div>
              <div className="mt-8 flex items-center gap-1.5 text-sm font-medium text-ink-950">
                Enter <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Problem */}
      <section className="border-y border-line bg-ink-50/60">
        <div className="mx-auto max-w-6xl px-6 py-16 sm:py-20">
          <p className="text-[11px] font-medium uppercase tracking-wider text-ink-400">The problem</p>
          <h2 className="mt-2 max-w-2xl font-display text-3xl text-ink-950">
            Average paid dispatch: about $1,500 a month per truck. For that, carriers get a person on the phone — and nothing improves.
          </h2>
          <div className="mt-10 grid grid-cols-2 gap-8 sm:grid-cols-4">
            {PROBLEM_STATS.map((s) => (
              <div key={s.label}>
                <p className="font-display text-3xl text-ink-950">{s.value}</p>
                <p className="mt-2 text-xs leading-relaxed text-ink-500">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Solution */}
      <section id="solution" className="mx-auto max-w-6xl px-6 py-16 sm:py-20">
        <p className="text-[11px] font-medium uppercase tracking-wider text-ink-400">The solution</p>
        <h2 className="mt-2 max-w-2xl font-display text-3xl text-ink-950">A fully autonomous AI dispatcher that works only for the carrier.</h2>
        <div className="mt-10 grid gap-px overflow-hidden rounded-3xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
          {SOLUTION_STEPS.map((s) => (
            <div key={s.n} className="flex flex-col gap-4 bg-white p-7">
              <div className="flex items-center justify-between">
                <span className="font-display text-2xl text-ink-300">{s.n}</span>
                <s.icon className="h-5 w-5 text-ink-950" strokeWidth={1.75} />
              </div>
              <p className="font-display text-xl text-ink-950">{s.title}</p>
              <p className="text-sm leading-relaxed text-ink-500">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Channels */}
      <section id="channels" className="border-y border-line bg-ink-950">
        <div className="mx-auto max-w-6xl px-6 py-16 sm:py-20">
          <p className="text-[11px] font-medium uppercase tracking-wider text-white/40">Multi-channel by design</p>
          <h2 className="mt-2 max-w-2xl font-display text-3xl text-white">Brokers live in email, SMS, and phone. So does the AI.</h2>
          <div className="mt-10 grid gap-5 sm:grid-cols-3">
            {CHANNELS.map((c) => (
              <div key={c.title} className="rounded-3xl border border-white/10 bg-white/[0.03] p-7">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-ink-950">
                  <c.icon className="h-5 w-5" strokeWidth={1.75} />
                </div>
                <p className="mt-5 font-display text-xl text-white">{c.title}</p>
                <ul className="mt-4 flex flex-col gap-2">
                  {c.points.map((pt) => (
                    <li key={pt} className="flex items-start gap-2 text-sm text-white/55">
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-white/40" />
                      {pt}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="mt-8">
            <LiveTicker />
          </div>
        </div>
      </section>

      {/* Savings */}
      <section className="mx-auto max-w-6xl px-6 py-16 sm:py-20">
        <div className="grid items-center gap-10 sm:grid-cols-2">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-ink-400">What one truck pays every month</p>
            <h2 className="mt-2 font-display text-3xl text-ink-950">About $1,000 less per truck — with better rates and fewer empty miles.</h2>
            <p className="mt-4 text-sm leading-relaxed text-ink-500">
              Flat 2% on every plan. No commission games, no flat salary for a dispatcher who only works one lane at a time.
            </p>
          </div>
          <div className="flex items-end gap-6 rounded-3xl border border-line p-8">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-ink-400">They pay today</p>
              <p className="mt-2 font-display text-5xl text-ink-300 line-through decoration-2">$1,500</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-ink-400">Backroute</p>
              <p className="mt-2 font-display text-5xl text-ink-950">$539</p>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="border-t border-line bg-ink-50/60">
        <div className="mx-auto max-w-6xl px-6 py-16 sm:py-20">
          <p className="text-[11px] font-medium uppercase tracking-wider text-ink-400">Business model</p>
          <h2 className="mt-2 font-display text-3xl text-ink-950">Flat 2% on every plan.</h2>
          <div className="mt-10 grid gap-5 sm:grid-cols-3">
            {PLANS.map((p) => (
              <div
                key={p.name}
                className={
                  p.featured
                    ? "flex flex-col rounded-3xl bg-ink-950 p-8 text-white ring-1 ring-ink-950"
                    : "flex flex-col rounded-3xl border border-line bg-white p-8"
                }
              >
                <p className={p.featured ? "text-sm font-medium text-white/60" : "text-sm font-medium text-ink-500"}>{p.name}</p>
                <p className="mt-3 font-display text-4xl">
                  {p.price}
                  <span className="text-base font-normal opacity-60">/mo + 2%</span>
                </p>
                <p className={p.featured ? "mt-2 text-sm text-white/60" : "mt-2 text-sm text-ink-500"}>{p.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-10">
        <Logo />
        <p className="text-xs text-ink-400">hello@backroute.pro · © 2026 Backroute, Inc.</p>
      </footer>
    </div>
  );
}
