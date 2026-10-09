# Running a pilot with real carriers

How to bring the first carriers onto Backroute safely: a separate test setup first, then each carrier moving up one
stage at a time, from practice mode to full autopilot, with clear reasons to move up or step back. Tools:
`scripts/pilot-carrier.mjs` (set up and move carriers), the support console at `/ops` (System, Numbers, Waiting on us),
and `npm run measure` (the AI's report card).

## Before the first carrier

1. **A test setup that isn't production.** A second Supabase project and a Vercel preview environment, with its own
   keys (Stripe in test mode, a Twilio test number, a Postmark sandbox server). Run every migration there first. Point
   `npm run measure` at it.
2. **The report card says go.** `EVAL_SECRET=... npm run measure -- --base https://your-test-app` must pass the bar:
   95% of messages understood, no hard rule broken, 90% of the money brokers would pay, and 4/5 on sounding human.
   Fix what the report lists before going further; run it again after every change to the AI's instructions.
3. **Production is set up and watched** (DEPLOY.md): every step through 15, the migrations, `SUPPORT_PHONES` and
   `SUPPORT_EMAIL` for alerts, and an uptime monitor on `https://your-app/api/health`. The System tab in `/ops` is all
   green (or "not set up" for what you're not using).
   `npm run check:live -- --env <the production settings file>` says "Nothing blocking": it asks each service whether
   its key works and points at this site (Twilio's number, Postmark's inbound webhook, the database's access rules,
   the migrations, the security headers), without sending anything.
4. **The paperwork is signed** (docs/legal: drafts for your lawyer): the carrier agreement with the authority to act
   and sign for the carrier, drivers' consent to texts, and the call-recording notice where it applies.
5. **Text registration (A2P 10DLC) is approved** on the dispatch number (`docs/sms-registration.md`). Without it US
   carriers block the texts.

## Picking pilot carriers

Start with two or three: small fleets (1 to 5 trucks), dry van or reefer, an owner who answers their phone and already
works with brokers by email. One owner-operator is a good second. Avoid hazmat, heavy haul and a fleet mid-crisis.

## The stages

Each carrier moves one stage at a time with `node scripts/pilot-carrier.mjs stage <id> <stage>`. Anyone can move a
carrier back at once: `pause <id>` puts them in practice mode (nothing leaves) while you look.

| Stage | What the AI does on its own | How long |
| --- | --- | --- |
| **shadow** (practice) | Reads every email, text and call and decides everything, but sends nothing: the owner sees what it would have sent. Drivers aren't texted. | 5 to 7 days |
| **ask** | Live, but every email to a broker waits for the owner's Send in Needs you. Driver check-ins and paperwork reminders go out. | 1 to 2 weeks |
| **rules** | Book requests, counters and acceptances at or over the owner's lowest rate, invoices, detention with known terms and setup packets go on their own. | 2 weeks |
| **full** | The AI's own replies go too. | from then on |

Set up a carrier (practice mode, owner invited by phone, fleet from a CSV):

```sh
node scripts/pilot-carrier.mjs create --name "Lone Star Hauling" --mc 123456 --dot 1234567 --owner-phone "+1 214 555 0100" --fleet fleet.csv
```

### Day 0, with the owner (30 minutes, on a call)

Before the call, print their kit (`docs/pilot-kit`): `npm run pilot:kit -- --carrier "Lone Star Hauling" --dispatch "(469) 555-0199" --inbound <their Backroute address>`.
Send the owner the guide, and the driver sheet for each driver's cab.


- They sign in with their phone, check trucks and drivers, set the lowest rate per mile, billing email and factoring,
  upload W-9 and COI (and a voided check if they want the AI doing setup websites), and name who signs rate cons.
- They turn on phone alerts (Settings → Notifications) and add Backroute to their home screen on an iPhone.
- They forward broker load emails to their Backroute address, or CC it on threads.
- Drivers get one text with the app link (sent by the rounds once the carrier is live, if it was made in practice
  mode or with this script); each signs in with their phone, taps I agree to texts from dispatch, and
  turns on notifications (Profile). Drivers on WhatsApp just message the dispatch line there. If the owner has each
  driver's written OK already, add `--drivers-agreed` when creating the carrier (or check the box in Add a truck).
- Ask the owner to forward (or upload) a few months of old rate cons in Settings → Bring your history, so the AI prices
  from their own lanes and brokers from the first day.
- Start the subscription (Settings → Billing & Team): the trial covers the pilot.

### Every day (support, 15 minutes per carrier)

- `node scripts/pilot-carrier.mjs status <id>`: loads, what's waiting on the owner and on support, what went out.
- `/ops` → Waiting on us: anything for this carrier, handled the same day.
- In practice mode: read what the AI would have sent (Settings → the log). Note anything a dispatcher wouldn't say.
- The System tab is green; any alert text was handled.

### Every week (with the owner, 20 minutes)

- Start from their Monday review (Home → Your week): did they agree with the one thing it said to change?
- What the AI did well, what it got wrong, and what the owner had to fix.
- `/ops` → Numbers: what came up most. Each repeat is the next thing to teach the AI.
- The owner's cost to run (Numbers) against what they pay.

## When to move up

- **shadow → ask:** a week of practice where the owner agrees with at least 9 in 10 of what the AI would have sent, and
  nothing it would have sent was dangerous (a price under their lowest, a wrong load, anything to an impostor).
- **ask → rules:** two weeks where the owner sent at least 9 in 10 of the AI's emails unchanged, no booking mistakes,
  and invoices went out right.
- **rules → full:** two weeks with no booking or money mistakes and fewer than two things a week the owner had to fix.

## When to step back (at once: `pause <id>`)

For everyone at once (`pause-all`), and for outages and alerts, see `docs/runbook.md`.

- The AI books, offers or accepts under the owner's lowest rate, or on the wrong truck.
- Anything goes to someone it shouldn't (an impostor, the wrong broker, a driver's private details).
- A driver safety issue is missed or late.
- The owner asks.

Then: find why in the log and the report, fix it, run `npm run measure`, and move them back up one stage at a time.

## After the pilot

When three carriers have run a month on rules or full with no step-backs: open sign-up, keep `BILLING_REQUIRED=1`,
and keep the daily status for new carriers' first two weeks.
