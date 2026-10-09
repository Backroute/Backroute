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
| **Rounds leaving carriers over** (the log says `left for the next run`) | A run hit its time budget before reaching every carrier. Those carriers go first next run, so nobody waits more than one extra run. | If it happens every run, raise `ROUNDS_POOL` (8 to 10), or run the job every 5 minutes. A load test with 60 carriers took 8.5 s per run against the stand-ins. |
| **Messages waiting to send** | A provider was down and messages are queued to retry; "given up" means some never went. | The provider's status page. Given-up messages are in the outbox table: tell the owner which ones. |
| **Voice server** | `VOICE_SERVER_URL` doesn't answer. Calls still work, taking turns instead of talking naturally. | Restart it on its host. Nothing else is affected. |
| **Website worker** | The browser worker hasn't asked for work in 10+ minutes, or a job has waited 15+. | Restart it on its host. Broker-website jobs fall to Waiting on us meanwhile. |
| **AI spending** | A carrier is using 3x its usual AI spend today (and over $5): a loop, an email flood, or abuse. | `/ops` → Numbers for that carrier; look at its log. `pause <id>` if it's a loop. |

## Backups and restoring

Everything a carrier has is in the database, files included (W-9s, COIs, BOL and POD photos are stored in
`carrier_files`), so a database backup is a full backup.

- **Supabase's own backups:** daily on the Pro plan, kept for 7 days; turn on Point-in-Time Recovery for restores to the
  minute. Restore from Supabase → Database → Backups. A restore replaces the whole database and the app is down while it
  runs: pause everyone first (`pause-all`), restore, check, then `resume-all`.
- **Our own copy, nightly**, off Supabase (so a deleted project or a lost account isn't the end):

  ```sh
  pg_dump "$SUPABASE_DB_URL" -Fc --no-owner -f backroute-$(date +%F).dump
  ```

  `SUPABASE_DB_URL` is the connection string in Supabase → Project Settings → Database (the direct one). The dump has
  drivers' phone numbers and carriers' papers in it: keep it encrypted, somewhere only the team can read, for 30 days.
- **Restoring one carrier's data** (someone deleted the wrong thing): restore the dump into a new database, copy that
  carrier's rows across by `carrier_id`, and drop the new database. Never restore over production for one carrier.

**The drill, every quarter** (about 20 minutes): restore last night's dump into an empty database and check it holds
what production does.

```sh
createdb restore_drill && pg_restore --no-owner -d restore_drill backroute-YYYY-MM-DD.dump
psql -d restore_drill -c "select (select count(*) from carriers) carriers, (select count(*) from loads) loads,
  (select count(*) from carrier_files) files, (select count(*) from pg_policies where schemaname = 'public') access_rules"
```

The counts should match production as of the dump, and `access_rules` should match too: a restore without them would
let any signed-in user read every carrier. Last run on the test database (2026-10-09): restored with no errors, the same
61 access rules on 34 tables, 20 functions and 14 triggers.

## The outage drill

Once before the pilot and then every quarter, on the test setup (never production), break one thing at a time and check
that the alert comes, nothing is lost, and it recovers on its own. The stand-ins in `tests/` check the same things on
every test run (`sandbox-e2e`); this is the real providers.

| Break it | What should happen | Put it back, then |
|---|---|---|
| Set `TWILIO_AUTH_TOKEN` to something wrong and text the dispatch number from a test driver's phone | The answer is kept in `outbound` and retried; after a few failed runs, the **Messages waiting to send** alert | The next run sends it. A text more than an hour old is given up on, and support is asked to reach the driver another way |
| Set `POSTMARK_SERVER_TOKEN` wrong and email the test carrier a load | The broker reply waits in `outbound`; the same alert | The next run sends it |
| Set `ANTHROPIC_API_KEY` wrong and text a question | Two messages the AI can't answer: the **AI** alert, and each message is in Waiting on us | Answer them by hand; nothing more is needed |
| Pause the test Supabase project | `/api/health` fails, the uptime monitor and the **Database** alert fire | Messages that came in while it was down: Postmark retried the emails; Twilio didn't retry the texts (see above) |
| Turn off the scheduler for 30 minutes | The **Dispatcher's rounds** alert | One run by hand, then the scheduler back on |

Write down when each alert arrived. If one doesn't come, that's the thing to fix before carriers are on it.

## A carrier leaving

The owner can do both themselves in Settings → Billing & Team → Your data: **Download everything** (a .zip with every
load as a spreadsheet, every file, and everything else as JSON) and **Delete account**. If they ask us instead, in
writing (an email from the owner's address on file, or a text from the owner's phone):

```sh
node scripts/pilot-carrier.mjs export <id> --out export-<id>     # send them the folder, zipped, then delete it
node scripts/pilot-carrier.mjs delete <id> --confirm "<exact company name>"
```

Deleting cancels the Stripe subscription first (with `STRIPE_SECRET_KEY` set; if Stripe refuses, nothing is deleted),
then removes the carrier and every table of theirs, and the sign-ins that belonged only to them. Two things stay, both
server-only: `closed_accounts` (that the account existed, and when) and `consent_archive` (each driver's yes or no to
texts and calls, the proof the texts were sent under; how long to keep it is for counsel). Our nightly dumps still
hold their data until those dumps age out (30 days). Loads on the road are the owner's to finish: tell them before
deleting. Neither the download nor the script includes saved website passwords or connection keys.

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
