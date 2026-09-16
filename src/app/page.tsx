import Link from "next/link";
import { ArrowUpRight, ChevronDown, Mail, MessageSquare, Phone, Radar, ShieldCheck, Truck } from "lucide-react";
import { Logo } from "@/components/shared/logo";
import { Button } from "@/components/ui/button";
import { LiveDot } from "@/components/shared/live-dot";
import { LiveTicker } from "@/components/landing/live-ticker";
import { DashboardPreview } from "@/components/landing/dashboard-preview";

const TRUST_STATS = [
  { v: "18,400+", l: "Loads booked monthly" },
  { v: "$240M+", l: "Freight under management" },
  { v: "4.9/5", l: "Average carrier rating" },
  { v: "24/7", l: "Voice, SMS & email coverage" },
];

const CARRIER_LOGOS = ["Redhawk Trucking", "Sundown Haulers", "Ironclad Freight", "Cedarline Transport", "Prairie Gold Carriers", "Westgate Logistics"];

const OUTCOME_STATS = [
  { v: "$961", l: "Saved per truck, per month" },
  { v: "0", l: "Minutes on hold with brokers" },
  { v: "100%", l: "Of loads scored before you see them" },
  { v: "24/7", l: "Negotiation coverage, every channel" },
];

const HOW_IT_WORKS = [
  { n: "01", title: "Find & score", body: "Scans every connected board and inbox continuously, and scores each load on true net profit after deadhead, fuel, and tolls.", icon: Radar },
  { n: "02", title: "Negotiate", body: "Email, SMS, and voice agents work every channel in parallel, holding your rate floor without tipping your hand.", icon: MessageSquare },
  { n: "03", title: "Book & confirm", body: "Validates the rate confirmation line by line and writes a clean record straight into your TMS.", icon: ShieldCheck },
  { n: "04", title: "Execute & chain", body: "Handles check calls, documents, and exceptions, then books the next load before this one even delivers.", icon: Truck },
];

const CHANNELS = [
  { icon: Mail, title: "Email", points: ["Reads and extracts rate offers", "Drafts market-backed counters", "Validates rate confirmations", "Creates audit-ready records"] },
  { icon: MessageSquare, title: "SMS", points: ["Instant rate checks", "Quick counters and holds", "Driver and broker short loops", "Works while on the road"] },
  { icon: Phone, title: "Voice", points: ["Real negotiation calls", "Holds hard rate floors", "Builds urgency and rapport", "Available 24/7"] },
];

const TESTIMONIALS = [
  { quote: "We cut dispatch cost by more than half and our trucks run fewer empty miles. It just works.", name: "Renee Ortiz", role: "Fleet Owner, Sundown Haulers" },
  { quote: "I used to spend two hours a day on the phone with brokers. Now I just drive.", name: "Marcus Bell", role: "Owner-Operator" },
  { quote: "The AI negotiates harder than any dispatcher I've hired, and rates are consistently better.", name: "Devon Cole", role: "Fleet Owner, Ironclad Freight" },
];

const PLANS = [
  { name: "Starter", price: "$99", desc: "Owner-operator. 1 truck.", featured: false },
  { name: "Growth", price: "$499", desc: "2–5 trucks.", featured: true },
  { name: "Fleet", price: "$999", desc: "6+ trucks.", featured: false },
];

const FAQS = [
  { q: "Do I still need a dispatcher?", a: "No. Backroute sources, negotiates, books, tracks, and documents every load end to end. You keep final say on rate floors and any load you want to review yourself." },
  { q: "What happens when the AI can't handle something?", a: "Rate-floor exceptions, detention approvals, and real emergencies like breakdowns or accidents route straight to you, or to a live safety specialist. Everything else runs automatically." },
  { q: "Which load boards does it work with?", a: "Backroute scans DAT One, Truckstop, Numeo, Loadsmart, and direct broker email inboxes continuously, 24 hours a day." },
  { q: "Can drivers choose their own loads?", a: "Yes. When the AI finds several strong options, your driver picks — or Backroute books its top-scored pick automatically if nobody responds in time." },
  { q: "How does pricing work?", a: "A flat monthly fee by fleet size, plus 2% of booked freight. No commission games, no per-load fees." },
  { q: "Is carrier data secure?", a: "Yes. All carrier, load, and payment data is encrypted in transit and at rest, and access is scoped per account." },
];

export default function Home() {
  return (
    <div className="flex-1 bg-white">
      <header className="sticky top-0 z-30 border-b border-line bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Logo />
          <nav className="hidden items-center gap-8 text-sm font-medium text-ink-600 sm:flex">
            <a href="#how-it-works" className="hover:text-ink-950">Product</a>
            <a href="#channels" className="hover:text-ink-950">Agents</a>
            <a href="#pricing" className="hover:text-ink-950">Pricing</a>
            <Link href="/driver" className="hover:text-ink-950">Drivers</Link>
          </nav>
          <div className="flex items-center gap-2">
            <Button href="/carrier" variant="ghost" size="sm">Log in</Button>
            <Button href="/carrier" variant="primary" size="sm">Get started</Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="grain-overlay relative overflow-hidden bg-ink-950">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(255,255,255,0.08),_transparent_60%)]" />
        <div className="relative mx-auto max-w-6xl px-6 pt-20 pb-0 sm:pt-24">
          <div className="flex flex-col items-center text-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 px-3 py-1">
              <LiveDot label="Dispatching freight right now" />
            </div>
            <h1 className="mt-6 max-w-3xl font-display text-5xl leading-[1.05] tracking-tighter text-white sm:text-6xl">
              <span className="font-normal text-white/50">Freight dispatch,</span> fully automated.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-white/60">
              Backroute sources, negotiates, books, and rebooks every load — so your trucks stay loaded without a human on the phone.
            </p>
            <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
              <Button href="/carrier" size="lg" variant="secondary" className="!bg-white !text-ink-950 hover:!bg-white/90">
                Get started <ArrowUpRight className="h-4 w-4" />
              </Button>
              <Button href="/driver" size="lg" variant="outline" className="!border-white/25 !text-white hover:!border-white">
                For drivers
              </Button>
            </div>
          </div>

          <div className="relative mt-16 px-4 pb-20 sm:mt-20">
            <DashboardPreview />
          </div>
        </div>
      </section>

      {/* Trust stats */}
      <section className="border-b border-line">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-6 px-6 py-10 sm:grid-cols-4">
          {TRUST_STATS.map((s) => (
            <div key={s.l} className="text-center sm:text-left">
              <p className="font-display text-2xl tabular text-ink-950">{s.v}</p>
              <p className="mt-1 text-xs text-ink-500">{s.l}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Logo strip */}
      <section className="border-b border-line bg-ink-50/40">
        <div className="mx-auto max-w-6xl px-6 py-10">
          <p className="text-center text-[11px] font-medium uppercase tracking-wider text-ink-400 sm:text-left">Dispatching for carriers nationwide</p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-10 gap-y-4 sm:justify-start">
            {CARRIER_LOGOS.map((name) => (
              <span key={name} className="font-display text-sm font-semibold text-ink-300">{name}</span>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="mx-auto max-w-6xl px-6 py-16 sm:py-20">
        <p className="text-[11px] font-medium uppercase tracking-wider text-ink-400">How it works</p>
        <h2 className="mt-2 max-w-2xl font-display text-3xl tracking-tight text-ink-950">Every step of dispatch, handled automatically.</h2>
        <div className="mt-10 grid gap-px overflow-hidden rounded-3xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
          {HOW_IT_WORKS.map((s) => (
            <div key={s.n} className="flex flex-col gap-4 bg-white p-7">
              <div className="flex items-center justify-between">
                <span className="font-display text-2xl text-ink-300">{s.n}</span>
                <s.icon className="h-5 w-5 text-ink-950" strokeWidth={1.75} />
              </div>
              <p className="font-display text-xl tracking-tight text-ink-950">{s.title}</p>
              <p className="text-sm leading-relaxed text-ink-500">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Outcomes */}
      <section className="border-y border-line bg-ink-50/60">
        <div className="mx-auto max-w-6xl px-6 py-16 sm:py-20">
          <p className="text-[11px] font-medium uppercase tracking-wider text-ink-400">What changes</p>
          <h2 className="mt-2 max-w-2xl font-display text-3xl tracking-tight text-ink-950">What changes when AI dispatches your fleet.</h2>
          <div className="mt-10 grid grid-cols-2 gap-8 sm:grid-cols-4">
            {OUTCOME_STATS.map((s) => (
              <div key={s.l}>
                <p className="font-display text-3xl tracking-tight text-ink-950">{s.v}</p>
                <p className="mt-2 text-xs leading-relaxed text-ink-500">{s.l}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Channels */}
      <section id="channels" className="border-b border-line bg-ink-950">
        <div className="mx-auto max-w-6xl px-6 py-16 sm:py-20">
          <p className="text-[11px] font-medium uppercase tracking-wider text-white/40">Multi-channel by design</p>
          <h2 className="mt-2 max-w-2xl font-display text-3xl tracking-tight text-white">Brokers live in email, SMS, and phone. So does the AI.</h2>
          <div className="mt-10 grid gap-5 sm:grid-cols-3">
            {CHANNELS.map((c) => (
              <div key={c.title} className="rounded-3xl border border-white/10 bg-white/[0.03] p-7">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-ink-950">
                  <c.icon className="h-5 w-5" strokeWidth={1.75} />
                </div>
                <p className="mt-5 font-display text-xl tracking-tight text-white">{c.title}</p>
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

      {/* Testimonials */}
      <section className="mx-auto max-w-6xl px-6 py-16 sm:py-20">
        <p className="text-[11px] font-medium uppercase tracking-wider text-ink-400">From carriers running on Backroute</p>
        <div className="mt-8 grid gap-5 sm:grid-cols-3">
          {TESTIMONIALS.map((t) => (
            <div key={t.name} className="flex flex-col justify-between rounded-3xl border border-line p-7">
              <p className="font-display text-lg leading-snug tracking-tight text-ink-950">&ldquo;{t.quote}&rdquo;</p>
              <div className="mt-6">
                <p className="text-sm font-semibold text-ink-900">{t.name}</p>
                <p className="text-xs text-ink-500">{t.role}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Savings */}
      <section className="border-t border-line bg-ink-50/60">
        <div className="mx-auto max-w-6xl px-6 py-16 sm:py-20">
          <div className="grid items-center gap-10 sm:grid-cols-2">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wider text-ink-400">Cost per truck, per month</p>
              <h2 className="mt-2 font-display text-3xl tracking-tight text-ink-950">About $1,000 less per truck, with better rates and fewer empty miles.</h2>
            </div>
            <div className="flex items-end gap-6 rounded-3xl border border-line bg-white p-8">
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-ink-400">Human dispatcher</p>
                <p className="mt-2 font-display text-5xl tracking-tight text-ink-300 line-through decoration-2">$1,500</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-ink-400">Backroute</p>
                <p className="mt-2 font-display text-5xl tracking-tight text-ink-950">$539</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="border-b border-line">
        <div className="mx-auto max-w-6xl px-6 py-16 sm:py-20">
          <p className="text-[11px] font-medium uppercase tracking-wider text-ink-400">Pricing</p>
          <h2 className="mt-2 font-display text-3xl tracking-tight text-ink-950">Flat 2% on every plan.</h2>
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
                <p className="mt-3 font-display text-4xl tracking-tight">
                  {p.price}
                  <span className="text-base font-normal opacity-60">/mo + 2%</span>
                </p>
                <p className={p.featured ? "mt-2 text-sm text-white/60" : "mt-2 text-sm text-ink-500"}>{p.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="mx-auto max-w-4xl px-6 py-16 sm:py-20">
        <p className="text-[11px] font-medium uppercase tracking-wider text-ink-400">Questions</p>
        <h2 className="mt-2 font-display text-3xl tracking-tight text-ink-950">Frequently asked.</h2>
        <div className="mt-10 flex flex-col divide-y divide-line border-t border-line">
          {FAQS.map((f) => (
            <details key={f.q} className="group py-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-medium text-ink-950">
                {f.q}
                <ChevronDown className="h-4 w-4 shrink-0 text-ink-400 transition-transform group-open:rotate-180" />
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-ink-500">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="grain-overlay relative overflow-hidden bg-ink-950">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,_rgba(255,255,255,0.08),_transparent_60%)]" />
        <div className="relative mx-auto flex max-w-6xl flex-col items-center px-6 py-20 text-center sm:py-24">
          <h2 className="max-w-xl font-display text-3xl tracking-tight text-white sm:text-4xl">Stop dispatching by hand.</h2>
          <p className="mt-4 max-w-md text-sm text-white/60">Get set up in minutes. Your first load is sourced automatically.</p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button href="/carrier" size="lg" variant="secondary" className="!bg-white !text-ink-950 hover:!bg-white/90">
              Get started <ArrowUpRight className="h-4 w-4" />
            </Button>
            <Button href="/driver" size="lg" variant="outline" className="!border-white/25 !text-white hover:!border-white">
              For drivers
            </Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-line">
        <div className="mx-auto max-w-6xl px-6 py-14">
          <div className="grid grid-cols-2 gap-8 sm:grid-cols-5">
            <div className="col-span-2">
              <Logo />
              <p className="mt-3 max-w-[200px] text-xs leading-relaxed text-ink-400">Autonomous freight dispatch for modern carriers.</p>
            </div>
            <FooterColumn title="Product" links={[{ label: "Carrier Dashboard", href: "/carrier" }, { label: "Driver App", href: "/driver" }, { label: "Pricing", href: "#pricing" }, { label: "Security", href: "#" }]} />
            <FooterColumn title="Company" links={[{ label: "About", href: "#" }, { label: "Careers", href: "#" }, { label: "Blog", href: "#" }]} />
            <FooterColumn title="Resources" links={[{ label: "Help Center", href: "#" }, { label: "API Docs", href: "#" }, { label: "Status", href: "#" }, { label: "Privacy", href: "#" }, { label: "Terms", href: "#" }]} />
          </div>
          <div className="mt-12 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-6">
            <p className="text-xs text-ink-400">© 2026 Backroute, Inc.</p>
            <p className="text-xs text-ink-400">hello@backroute.com</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

function FooterColumn({ title, links }: { title: string; links: { label: string; href: string }[] }) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wider text-ink-400">{title}</p>
      <ul className="mt-3 flex flex-col gap-2.5">
        {links.map((l) => (
          <li key={l.label}>
            <Link href={l.href} className="text-sm text-ink-600 hover:text-ink-950">{l.label}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
