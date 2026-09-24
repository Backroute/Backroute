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

`/demo` is the link to share: the whole product on a sample fleet, no account, nothing saved or sent. A yellow bar on every demo screen says so and switches between the owner's dashboard and the driver app. It works whether or not accounts are switched on, so one deployment serves both the demo and real carriers.

## Accounts and saved data

Off by default. Set the two Supabase keys in `.env.local` to switch on sign-in by phone number, roles (owner, dispatcher, driver) and a saved fleet. `DEPLOY.md` covers setting up Supabase and Vercel, and lists what isn't live yet. The database schema and access rules are in `supabase/migrations/`.

## Stack

Next.js (App Router, Turbopack) · TypeScript · Tailwind CSS v4 · Zustand · Supabase (optional) · Recharts · Framer Motion · lucide-react
