import Link from "next/link";
import { ArrowUpRight, Mail, MessageCircle, MessageSquare, Phone, Radar, Truck } from "lucide-react";
import { Logo } from "@/components/shared/logo";
import { Button } from "@/components/ui/button";
import { LiveDot } from "@/components/shared/live-dot";
import { LiveTicker } from "@/components/landing/live-ticker";
import { DashboardPreview } from "@/components/landing/dashboard-preview";

const STATS = [
  { v: "$961", l: "Saved per truck, every month" },
  { v: "24/7", l: "Negotiation coverage" },
  { v: "0", l: "Minutes on hold with brokers" },
];

const FEATURES = [
  { title: "Finds every load", body: "Scans every board and inbox, scored on true profit after fuel, tolls, and deadhead.", icon: Radar },
  { title: "Negotiates everywhere", body: "Email, SMS, and voice, holding your rate floor all day on every channel.", icon: MessageSquare },
  { title: "Books the next one", body: "Confirms, tracks, and documents automatically, then rebooks before this load lands.", icon: Truck },
];

const REACH_YOU = [
  { icon: Phone, label: "Phone call" },
  { icon: MessageCircle, label: "In-app message" },
];

const REACH_BROKERS = [
  { icon: Phone, label: "Phone call" },
  { icon: MessageSquare, label: "Text (SMS)" },
  { icon: Mail, label: "Email" },
];

const PLANS = [
  { name: "Starter", price: "$99", desc: "Owner-operator. 1 truck.", featured: false },
  { name: "Growth", price: "$499", desc: "2–5 trucks.", featured: true },
  { name: "Fleet", price: "$999", desc: "6+ trucks.", featured: false },
];

export default function Home() {
  return (
    <div className="flex-1 bg-white">
      <header className="sticky top-0 z-30 border-b border-line bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Logo />
          <nav className="hidden items-center gap-8 text-sm font-medium text-ink-600 sm:flex">
            <a href="#product" className="hover:text-ink-950">Product</a>
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
        <div className="relative mx-auto max-w-6xl px-6 pt-24 pb-0 sm:pt-32">
          <div className="flex flex-col items-center text-center">
            <LiveDot label="Live" className="opacity-70" />
            <h1 className="mt-8 max-w-4xl font-display text-6xl leading-[0.95] tracking-tighter text-white sm:text-7xl lg:text-8xl">
              <span className="font-normal text-white/45">Freight dispatch,</span><br />fully automated.
            </h1>
            <p className="mt-8 max-w-xl text-lg text-white/55">
              Sources loads, negotiates rate, and books the next one automatically. A full-time dispatcher, without the headcount.
            </p>
            <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
              <Button href="/carrier" size="lg" variant="secondary" className="!bg-white !text-ink-950 hover:!bg-white/90">
                Get started <ArrowUpRight className="h-4 w-4" />
              </Button>
              <Button href="/driver" size="lg" variant="outline" className="!border-white/25 !text-white hover:!border-white">
                For drivers
              </Button>
            </div>
          </div>

          <div className="relative mt-20 px-4 pb-24 sm:mt-24">
            <DashboardPreview />
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="border-b border-line">
        <div className="mx-auto grid max-w-5xl grid-cols-1 gap-16 px-6 py-24 text-center sm:grid-cols-3 sm:py-32">
          {STATS.map((s) => (
            <div key={s.l}>
              <p className="font-display text-7xl tabular tracking-tighter text-ink-950">{s.v}</p>
              <p className="mt-3 text-sm text-ink-500">{s.l}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Product */}
      <section id="product" className="border-b border-line bg-ink-950">
        <div className="mx-auto max-w-5xl px-6 py-24 sm:py-32">
          <h2 className="text-center font-display text-5xl tracking-tighter text-white sm:text-6xl">Built to run itself.</h2>

          <div className="mt-20 grid gap-16 sm:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="text-center sm:text-left">
                <f.icon className="mx-auto h-6 w-6 text-white sm:mx-0" strokeWidth={1.75} />
                <p className="mt-5 font-display text-xl tracking-tight text-white">{f.title}</p>
                <p className="mt-2 text-sm leading-relaxed text-white/50">{f.body}</p>
              </div>
            ))}
          </div>

          <div className="mt-20">
            <LiveTicker />
          </div>
        </div>
      </section>

      {/* Reach */}
      <section className="border-b border-line">
        <div className="mx-auto max-w-3xl px-6 py-24 text-center sm:py-32">
          <h2 className="font-display text-4xl tracking-tighter text-ink-950 sm:text-5xl">Every channel. One dispatcher.</h2>
          <p className="mx-auto mt-5 max-w-xl text-lg text-ink-500">
            Call or send a message any hour and nothing goes to voicemail. The same AI dispatcher is already on the phone, texting, and emailing brokers, all day, every day.
          </p>
          <div className="mx-auto mt-12 flex max-w-md flex-col gap-5">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wider text-ink-300">You &harr; AI dispatcher</p>
              <div className="mt-2.5 flex flex-wrap items-center justify-center gap-2.5">
                {REACH_YOU.map((r) => (
                  <ChannelPill key={r.label} icon={r.icon} label={r.label} />
                ))}
              </div>
            </div>
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wider text-ink-300">AI dispatcher &harr; brokers</p>
              <div className="mt-2.5 flex flex-wrap items-center justify-center gap-2.5">
                {REACH_BROKERS.map((r) => (
                  <ChannelPill key={r.label} icon={r.icon} label={r.label} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Savings */}
      <section className="bg-ink-50/60">
        <div className="mx-auto max-w-5xl px-6 py-24 text-center sm:py-32">
          <h2 className="mx-auto max-w-xl font-display text-4xl tracking-tighter text-ink-950 sm:text-5xl">
            $1,000 less per truck, every month.
          </h2>
          <div className="mx-auto mt-14 flex w-fit items-end gap-10">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-ink-400">Human dispatcher</p>
              <p className="mt-2 font-display text-6xl tracking-tighter text-ink-300 line-through decoration-2">$1,500</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-ink-400">Backroute</p>
              <p className="mt-2 font-display text-6xl tracking-tighter text-ink-950">$539</p>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="border-t border-line">
        <div className="mx-auto max-w-5xl px-6 py-24 sm:py-32">
          <h2 className="text-center font-display text-4xl tracking-tighter text-ink-950 sm:text-5xl">Flat 2% on every plan.</h2>
          <div className="mt-16 grid gap-5 sm:grid-cols-3">
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

      {/* Final CTA */}
      <section className="grain-overlay relative overflow-hidden bg-ink-950">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,_rgba(255,255,255,0.08),_transparent_60%)]" />
        <div className="relative mx-auto flex max-w-6xl flex-col items-center px-6 py-24 text-center sm:py-32">
          <h2 className="font-display text-4xl tracking-tighter text-white sm:text-5xl">Stop dispatching by hand.</h2>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
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
            <FooterColumn title="Product" links={[{ label: "Carrier Dashboard", href: "/carrier" }, { label: "Driver App", href: "/driver" }, { label: "Pricing", href: "#pricing" }]} />
            <FooterColumn title="Company" links={[{ label: "About", href: "#" }, { label: "Careers", href: "#" }]} />
            <FooterColumn title="Resources" links={[{ label: "Help Center", href: "#" }, { label: "Privacy", href: "#" }, { label: "Terms", href: "#" }]} />
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

function ChannelPill({ icon: Icon, label }: { icon: typeof Phone; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line px-3.5 py-2 text-xs font-medium text-ink-700">
      <Icon className="h-3.5 w-3.5 text-ink-400" /> {label}
    </span>
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
