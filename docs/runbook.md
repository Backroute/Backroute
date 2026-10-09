# When something goes wrong: the runbook

For whoever is on call once real carriers are live. Setup is in DEPLOY.md; the pilot's day-to-day is in PILOT.md.
This page is for the bad moments: what each alert means, the first thing to do, and how to undo it.

## The stop button

If the AI is doing something wrong to more than one carrier (wrong prices, odd emails, a loop), stop it first and look
after:

```sh
node scripts/pilot-carrier.mjs pause-all      # every live carrier to practice mode: nothing goes to brokers or drivers
node scripts/pilot-carrier.mjs list           # who's live, who's in practice
node scripts/pilot-carrier.mjs resume-all     # each one back exactly as it was
```

One carrier only: `pause <id>` and `resume <id>`. In practice mode the AI still reads everything and decides, so
nothing is lost; the owner sees what it would have sent. Drivers mid-load stop getting check-ins too, so text the owner
that you've paused it (from `/ops`, **Text the owner**).

Run these from a trusted machine with `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` set.

## The alerts

Alerts come by text to `ALERT_PHONES` (or `SUPPORT_PHONES`) and by email to `SUPPORT_EMAIL`, once per problem per hour,
and once more when it's fixed. The same list is the **System** tab in `/ops`.

| Alert | What it means | First thing to do |
|---|---|---|
| **Database** down | Supabase isn't answering. Nothing works. Postmark retries the broker emails that came in meanwhile; Twilio doesn't retry texts, so drivers' texts in that window are lost. | Supabase status page. If it's them, wait. If it's us (paused project, out of space), fix in the Supabase dashboard. After, text the owners: anything a driver texted during the outage needs resending. |
| **AI** down or unusual | No `ANTHROPIC_API_KEY`, or 2+ messages in the last hour the AI couldn't answer. Those messages are already in **Waiting on us**. | Anthropic status page; the console's usage limit (a spend cap reached looks like this). Answer what's in Waiting on us by hand. |
| **Texts and calls (Twilio)** | Twilio isn't set up on this deployment. | A deploy dropped the variables: check Vercel's Environment Variables, then redeploy. |
| **Email (Postmark)** | Postmark isn't set up on this deployment. | Same as above. |
| **Dispatcher's rounds** late or never | `/api/cron/dispatch` hasn't run in 25+ minutes. No check-ins, invoices, follow-ups or alerts go out. | The scheduler: Vercel → Cron Jobs (or cron-job.org). Run it once by hand: `curl -H "Authorization: Bearer $CRON_SECRET" https://YOUR-SITE/api/cron/dispatch`. |
| **Messages waiting to send** | A provider was down and messages are queued to retry; "given up" means some never went. | The provider's status page. Given-up messages are in the outbox table: tell the owner which ones. |
| **Voice server** | `VOICE_SERVER_URL` doesn't answer. Calls still work, taking turns instead of talking naturally. | Restart it on its host. Nothing else is affected. |
| **Website worker** | The browser worker hasn't asked for work in 10+ minutes, or a job has waited 15+. | Restart it on its host. Broker-website jobs fall to Waiting on us meanwhile. |
| **AI spending** | A carrier is using 3x its usual AI spend today (and over $5): a loop, an email flood, or abuse. | `/ops` → Numbers for that carrier; look at its log. `pause <id>` if it's a loop. |

## A driver emergency

The AI tells a driver who reports a crash or injury to call 911, texts the support phones, and puts it first in
Waiting on us and in the owner's Needs you. Whoever's on call:

1. Calls the driver back (the number is on the item). If no answer in 5 minutes, call the owner.
2. Makes sure the broker knows the load is delayed.
3. Writes what happened in the item's note before resolving it.

Backroute is not an emergency service: someone on the support team must always be reachable.

## A bad deploy

Vercel → Deployments → the last good one → **Instant Rollback**. It's back in seconds. Database migrations aren't
rolled back with it: every migration so far only adds tables and columns or allows more values, so the older app runs
on the newer database. Keep it that way (drop or rename only in a later release, once nothing reads it).

## A leaked key

Change it at the provider first, then in Vercel's Environment Variables, then redeploy. Where each one changes:

| Key | Where to make a new one | Also update |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API keys: make a new secret key, then delete the old one | scripts' machines |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API keys | |
| `TWILIO_AUTH_TOKEN` | Twilio console → API keys & tokens: make a secondary token, promote it | the voice server if it has it |
| `POSTMARK_SERVER_TOKEN` | Postmark → the server → API Tokens | |
| `EMAIL_WEBHOOK_TOKEN` | any long random string (`openssl rand -hex 32`) | Postmark's inbound webhook URL `?token=`, at the same time |
| `CRON_SECRET` | any long random string | the scheduler's `Authorization` header (Vercel's own cron picks it up) |
| `VOICE_SERVER_SECRET`, `PORTAL_WORKER_SECRET` | any long random string | the same value on the voice server or worker |
| `PORTAL_VAULT_KEY` | `openssl rand -base64 32` | put the old one in `PORTAL_VAULT_KEY_OLD` until saved logins re-seal; remove it after |
| `STRIPE_SECRET_KEY` | Stripe → Developers → API keys: roll | |

Then run `npm run check:live` against the new settings.

## A carrier says the AI did something wrong

1. `pause <id>` if it could happen again before you understand it.
2. The load's timeline and the log (`/ops` → the carrier) show what came in, what the AI decided, and why.
3. Tell the owner what happened and what you're changing. If a broker got something wrong (a price, a promise), send
   the correction from the load before anything else.
4. Fix it, run `npm run measure`, and move the carrier back up a stage at a time (PILOT.md).

## Every morning (5 minutes)

- `/ops` → System is green; overnight alerts were handled.
- `/ops` → Waiting on us is empty or owned by someone.
- `node scripts/pilot-carrier.mjs list`: nobody is paused who shouldn't be.
