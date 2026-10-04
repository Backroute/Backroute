import Link from "next/link";
import { demoAllowed } from "@/lib/cloud/demo";
import { Logo } from "@/components/shared/logo";
import { Button } from "@/components/ui/button";
import { PhonePreview } from "@/components/landing/phone-preview";

/** What it does, in the order a load goes: found, priced, moved, and the owner's say over all of it. */
const STEPS = [
  { label: "Find", title: "Finds the load.", body: "Every board and every broker email, checked all day. Ranked by what you keep after fuel, tolls and empty miles." },
  { label: "Negotiate", title: "Gets your rate.", body: "It calls and emails brokers the way a good dispatcher does, and never goes below the floor you set." },
  { label: "Run", title: "Keeps the truck moving.", body: "Check calls, appointments, paperwork and invoices, with the next load lined up before this one delivers." },
  { label: "Decide", title: "You stay in charge.", body: "Choose how much it decides alone. Everything else waits for one tap on your phone." },
];

/** A sample day, labelled as one: what the product does, without made-up totals. */
const DAY = [
  { time: "5:40", text: "Marcus is two hours from delivery in Indianapolis. Backroute starts looking for his next load." },
  { time: "6:15", text: "It calls Coastal Freight about Indianapolis to Kansas City. They offer $1,000; it asks for $1,180." },
  { time: "6:22", text: "They settle at $1,107, above the $1,050 floor. It checks the broker's authority and credit." },
  { time: "6:23", text: "The owner gets one text: “Book Marcus to Kansas City for $1,107?” They reply yes.", you: true },
  { time: "6:30", text: "The rate con is signed and sent back. Marcus gets the pickup address and the dock hours." },
  { time: "14:05", text: "Delivered. The proof of delivery goes to the broker with the invoice." },
];

const PLANS = [
  { name: "Starter", price: "$99", desc: "One truck, for owner-operators.", featured: false },
  { name: "Growth", price: "$499", desc: "Two to five trucks.", featured: true },
  { name: "Fleet", price: "$999", desc: "Six trucks or more.", featured: false },
];

const QUESTIONS = [
  { q: "Can I turn it off?", a: "Yes. One switch pauses everything Backroute does, and you can take over any load yourself at any time." },
  { q: "Who talks to the brokers?", a: "Backroute does, by phone, email and text, as your company's dispatcher. On calls it says it's an AI dispatcher and that the call is transcribed." },
  { q: "What if it gets something wrong?", a: "On “Ask me first” nothing is booked without your OK, and it never goes under your floor. For a breakdown or an emergency, a person on our team steps in." },
  { q: "What does it cost?", a: "A monthly plan for your fleet size, plus 2% of booked freight. Plans start at $99 a month for one truck." },
  { q: "What do I connect?", a: "Your email, your ELD (Samsara or Motive), your load boards (DAT, Truckstop) and QuickBooks Online if you use it. Setup takes about five minutes." },
  { q: "Who can see my data?", a: "Only your company. Each carrier's data is walled off from every other, and logins to broker websites are encrypted." },
];

export default function Home() {
  return (
    <div className="flex-1 bg-white text-ink-950">
      <header className="sticky top-0 z-30 border-b border-line bg-white/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3.5 sm:px-8">
          <Logo className="text-lg" />
          <nav className="hidden items-center gap-7 text-sm text-ink-600 md:flex">
            <a href="#product" className="hover:text-ink-950">Product</a>
            <a href="#drivers" className="hover:text-ink-950">Drivers</a>
            <a href="#pricing" className="hover:text-ink-950">Pricing</a>
            <a href="#questions" className="hover:text-ink-950">Questions</a>
          </nav>
          <div className="flex items-center gap-4">
            <Link href="/login" className="text-sm text-ink-600 hover:text-ink-950">Log in</Link>
            <Button href="/signup" size="sm">Get started</Button>
          </div>
        </div>
      </header>

      <section className="mx-auto grid max-w-6xl items-center gap-14 px-5 pb-20 pt-16 sm:px-8 md:pt-24 lg:grid-cols-[1.7fr_1fr] lg:gap-10 lg:pb-28">
        <div>
          <h1 className="text-[clamp(3rem,6.6vw,5.75rem)] font-medium leading-[0.95] tracking-[-0.045em] text-balance">
            Your next load
            <br />
            <span className="text-ink-400">is already booked.</span>
          </h1>
          <p className="mt-7 max-w-xl text-[clamp(1.125rem,1.6vw,1.375rem)] leading-snug text-ink-500">
            Backroute finds the load, calls the broker, books at your rate and gets you paid. You answer the few things that need you, from your phone.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-6">
            <Button href="/signup" size="lg" className="!px-7 !text-base">Get started</Button>
            {demoAllowed && (
              <Link href="/demo" className="text-base font-medium text-[var(--action)] hover:underline">
                See a sample fleet ›
              </Link>
            )}
          </div>
          <p className="mt-6 text-sm text-ink-400">For owner-operators and small fleets.</p>
        </div>
        <PhonePreview />
      </section>

      <section id="product" className="scroll-mt-16 border-t border-line bg-ink-100">
        <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 md:py-28">
          <p className="t-label text-ink-500">How it works</p>
          <h2 className="mt-3 max-w-3xl text-[clamp(2.125rem,4.4vw,3.5rem)] font-medium leading-[1.02] tracking-[-0.035em] text-balance">
            From load board to paid invoice.
          </h2>
          <ol className="mt-14 grid gap-x-10 gap-y-12 sm:grid-cols-2">
            {STEPS.map((s) => (
              <li key={s.label} className="flex flex-col gap-3 border-t border-line-strong pt-5">
                <p className="t-label text-ink-500">{s.label}</p>
                <h3 className="text-2xl font-medium tracking-tight">{s.title}</h3>
                <p className="max-w-md text-[17px] leading-relaxed text-ink-500">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-20 sm:px-8 md:py-28">
        <div className="grid gap-12 lg:grid-cols-[1fr_1.3fr] lg:gap-16">
          <div>
            <p className="t-label text-ink-500">A sample day</p>
            <h2 className="mt-3 text-[clamp(2.125rem,4.4vw,3.5rem)] font-medium leading-[1.02] tracking-[-0.035em] text-balance">A Tuesday, handled.</h2>
            <p className="mt-5 max-w-sm text-[17px] leading-relaxed text-ink-500">
              One truck, one morning. The owner&apos;s part is a single text.
            </p>
          </div>
          <ol className="flex flex-col">
            {DAY.map((d) => (
              <li key={d.time} className="grid grid-cols-[4.5rem_1fr] gap-4 border-t border-line py-4 first:border-t-0 first:pt-0">
                <span className={`font-mono text-sm tabular ${d.you ? "font-semibold text-[var(--action)]" : "text-ink-400"}`}>{d.time}</span>
                <p className={`text-[17px] leading-relaxed ${d.you ? "font-medium text-ink-950" : "text-ink-600"}`}>{d.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="drivers" className="theme-ink scroll-mt-16 bg-ink-950 text-white">
        <div className="mx-auto grid max-w-6xl gap-12 px-5 py-20 sm:px-8 md:py-28 lg:grid-cols-2">
          <div>
            <p className="t-label text-white/50">For drivers</p>
            <h2 className="mt-3 text-[clamp(2.125rem,4.4vw,3.5rem)] font-medium leading-[1.02] tracking-[-0.035em] text-balance">
              One voice. In their language.
            </h2>
          </div>
          <ul className="flex flex-col gap-6 text-[17px] leading-relaxed text-white/70">
            <li>
              <span className="font-medium text-white">Calls and texts in seven languages.</span> English, Spanish, Punjabi, Hindi, Russian, Ukrainian and French.
            </li>
            <li>
              <span className="font-medium text-white">Hands-free while driving.</span> Big buttons and voice: “I&apos;ve arrived,” “running late,” “call dispatch.”
            </li>
            <li>
              <span className="font-medium text-white">Pay and home time on one screen.</span> No more calling the office to ask.
            </li>
          </ul>
        </div>
      </section>

      <section id="pricing" className="scroll-mt-16 mx-auto max-w-6xl px-5 py-20 sm:px-8 md:py-28">
        <p className="t-label text-ink-500">Pricing</p>
        <h2 className="mt-3 text-[clamp(2.125rem,4.4vw,3.5rem)] font-medium leading-[1.02] tracking-[-0.035em]">Simple pricing.</h2>
        <p className="mt-4 max-w-xl text-[17px] leading-relaxed text-ink-500">A monthly plan, plus 2% of booked freight.</p>
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {PLANS.map((p) => (
            <div key={p.name} className={`flex flex-col gap-2 rounded-3xl p-7 ${p.featured ? "border-2 border-ink-950" : "border border-line"}`}>
              <p className="text-sm font-medium text-ink-500">{p.name}</p>
              <p className="text-5xl font-medium tracking-[-0.04em] tabular">
                {p.price}
                <span className="text-base font-normal tracking-normal text-ink-400"> /month</span>
              </p>
              <p className="text-[15px] text-ink-600">{p.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="questions" className="scroll-mt-16 border-t border-line bg-ink-100">
        <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 md:py-28">
          <h2 className="text-[clamp(2.125rem,4.4vw,3.5rem)] font-medium leading-[1.02] tracking-[-0.035em]">Questions.</h2>
          <dl className="mt-12 grid gap-x-12 gap-y-10 md:grid-cols-2">
            {QUESTIONS.map((x) => (
              <div key={x.q}>
                <dt className="text-[17px] font-semibold">{x.q}</dt>
                <dd className="mt-2 text-[17px] leading-relaxed text-ink-500">{x.a}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-24 text-center sm:px-8 md:py-32">
        <h2 className="mx-auto max-w-3xl text-[clamp(2.25rem,5vw,4rem)] font-medium leading-[1] tracking-[-0.04em] text-balance">
          Spend tomorrow driving, not dialing brokers.
        </h2>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-6">
          <Button href="/signup" size="lg" className="!px-7 !text-base">Get started</Button>
          {demoAllowed && (
            <Link href="/demo" className="text-base font-medium text-[var(--action)] hover:underline">
              See a sample fleet ›
            </Link>
          )}
        </div>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-10 text-sm text-ink-500 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <div>
            <Logo className="text-base" />
            <p className="mt-1">The dispatcher for owner-operators and small fleets.</p>
          </div>
          <nav className="flex flex-wrap gap-x-6 gap-y-2">
            <a href="#product" className="hover:text-ink-950">Product</a>
            <a href="#pricing" className="hover:text-ink-950">Pricing</a>
            <Link href="/login" className="hover:text-ink-950">Log in</Link>
            <span className="select-all">hello@backroute.com</span>
          </nav>
        </div>
        <p className="mx-auto max-w-6xl px-5 pb-10 text-xs text-ink-400 sm:px-8">© 2026 Backroute, Inc.</p>
      </footer>
    </div>
  );
}
