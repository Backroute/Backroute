# Backroute

**The fully autonomous AI dispatcher for carriers.** You drive. We find, negotiate, book, track, document, and chain the next load — across email, SMS, and voice. No human dispatcher required.

This repo contains a working product prototype: two dashboards and a driver app, all sharing a live, simulated AI-dispatcher engine so the product can be demoed end-to-end without any external services.

## What's inside

- **Landing page** (`/`) — pitch-ready marketing site with a live activity ticker.
- **Carrier Dashboard** (`/carrier`) — overview, load pipeline, live negotiations (email/SMS/voice threads and call transcripts), fleet & HOS, earnings/savings analytics, and agent settings.
- **Backroute Ops** (`/ops`) — internal mission control: platform-wide carriers, AI agent fleet monitor, global load flow, broker scorecards, escalation queue, and revenue/take-rate analytics.
- **Driver App** (`/driver`) — mobile-first PWA-style app: current + next (already-chained) load, load history, AI dispatcher chat, BOL/POD capture, and profile/HOS.

## The simulation engine

`src/lib/engine.ts` and `src/lib/store.ts` implement a client-side "AI dispatcher" that continuously sources loads, scores net profit (rate − fuel − tolls − deadhead), negotiates over email/SMS/voice with converging offers, books and syncs to a TMS, dispatches, tracks in-transit status, captures documents, delivers, and **pre-negotiates the next load before the current one delivers** (load chaining) — all visible live across every screen.

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Visit `/carrier`, `/ops`, or `/driver` directly, or start from the landing page.

## Demo and real version

`/demo` is the link to share: the whole product on a sample fleet, no account, nothing saved or sent. A yellow bar on every demo screen says so. Run it as its own site; on the real site, `NEXT_PUBLIC_DEMO=off` removes the demo completely (DEPLOY.md, "Two sites").

The real version switches on from environment variables:

- **Accounts:** sign-in by phone, and a fleet the owner types in, with no sample data.
- **Loads:** added by hand, read off a rate con PDF, or found in broker emails, load feeds and load boards (Truckstop, DAT and others, once Backroute's agreement with each is signed).
- **The AI:** runs on the server (Claude).
- **Texts and calls:** a dispatch number drivers text and call (Twilio), in 7 languages.
- **Check-ins:** the AI texts or calls drivers before appointments and follows up when they're late or go quiet.
- **Broker email and phone** (Postmark, Twilio):
  - book requests, multi-round counter-offers with reasons, detention and TONU terms, and setup packets
  - calls to brokers who don't answer an email, and to board posters who only list a phone (the MC is checked on the call)
  - invoices with the POD, detention and TONU claims, and payment reminders
  - priced by the owner's lowest rate per mile, which is enforced in code
  - every new broker checked with FMCSA before booking
- **After booking, like a dispatcher:**
  - signs a matching rate con in the name of the person the owner authorized, and sends it back
  - gets the driver on the broker's tracking app (Macropoint, Trucker Tools, FourKites...)
  - phones shippers and receivers to book or move dock appointments
  - prices added stops and reroutes before saying yes
  - claims layover when a truck is held overnight
  - checks each broker's credit before booking
  - signs in DocuSign and brokers' portals, fills carrier setups and books dock appointments on scheduling sites, with a browser worker (`portal-worker/`), once the owner switches it on
  - sends the factoring company the full invoice packet
  - runs cargo claims: acknowledgment, the driver's statement and photos, and a claim file for the insurer
- **Like a veteran dispatcher:** remembers drivers' lives, warns about slow docks using what every carrier on Backroute has learned, shows brokers the carrier's on-time record, asks for reloads, respects brokers who won't talk to an AI, and gets blurry paperwork retaken at the dock.
- **Smarter booking:** asks what the carrier usually gets on a lane, remembers each broker, plans around drivers' home time, and emails brokers when a truck will be free. Each truck has a plan on the Fleet page.
- **Breakdowns:** nearby shops found (Google Places), phoned one by one, the driver texted the one that can come, the broker told of the delay.
- **Owner rules:** judgment calls the owner hands to the AI. After the owner sends 3 of the same kind unchanged, the AI offers to stop asking.
- **Drivers:** a weekly check-in in their language, the owner told when someone's unhappy or long away from home, and optional weekly pay texts.
- **Money and fraud:** market rates in pricing, invoices with detention, lumper and TONU, and QuickBooks-ready downloads. Double brokering, lookalike email domains and bank-detail scams are caught before money moves.
- **Fleet planning:** truck routing, loads split across the whole fleet, idle trucks moved to where the freight is, slow docks remembered, check calls to brokers, and DOT, IFTA, UCR and 2290 deadlines.
- **Natural phone calls:** with the voice server (`voice-server/`, run outside Vercel), the AI talks and listens at the same time, and stops when interrupted.
- **Support team tools:** a playbook for each kind of hand-off, timers that turn red when an item is late, and the number to push down: hand-offs per truck per week.
- **ELD and load feeds:** Samsara or Motive for truck locations and drivers' hours, and any JSON or CSV list of loads.
- **Backroute support, for very little:** the AI finishes the job itself (it asks brokers for missing MCs, chases short pays and late invoices, hands dock appointments back to brokers, answers bank-detail scams, warns brokers about impostors). Your support team at `/ops` gets only safety emergencies, other companies' websites the AI couldn't finish, our own outages, owners who ask for a person, and urgent things an owner leaves for an hour. Money decisions are the owner's.
- **Evening text:** an end-of-day text to the owner.
- **Before real carriers:**
  - **Practice mode:** the AI does everything but sends nothing, and shows what it would have sent.
  - **Simulated brokers and drivers:** `eval/sim.mjs` runs whole conversations and scores the money and the manners.
  - **History import:** a CSV of past loads, so pricing starts from what each lane and broker paid.
- **Holds up:** messages retried through provider outages, stale screens can't undo newer changes to a load, stuck work goes to a person, and the support console shows what each carrier costs to run.

Each load board switches on when Backroute's partner login for it is set. Emergencies still need a person on the support team.

`DEPLOY.md` covers the setup, the tests, and what isn't done yet. The server side is in `src/lib/agent`, `src/lib/channels` and `src/app/api`. The database schema and access rules are in `supabase/migrations/`.

## Stack

Next.js (App Router, Turbopack) · TypeScript · Tailwind CSS v4 · Zustand · Supabase, Claude, Twilio, Postmark (all optional) · Recharts · Framer Motion · lucide-react
