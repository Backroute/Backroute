# Going live: the real version

Without any keys, Backroute is a demo: a sample fleet, a simulated AI, nothing saved, no sign-in. Each service
below switches on part of the real version, from environment variables only. The code doesn't change.

| Service | What it switches on |
|---|---|
| [Supabase](https://supabase.com) | Accounts (sign-in by phone), saved data, the server's database access |
| [Anthropic](https://console.anthropic.com) (Claude) | The AI: answers, reading rate cons, texting and talking with drivers, drafting broker email |
| [Twilio](https://www.twilio.com) | The dispatch phone number: texts and calls with drivers, the owner's evening text |
| [Postmark](https://postmarkapp.com) | Broker email in and out |
| [Vercel](https://vercel.com) | Hosting, the evening text, and the dispatcher's rounds every few minutes |

## Two sites: the demo and the real one

Keep them apart by running two Vercel projects from this same repository:

| | Demo site (e.g. `demo.yourdomain.com`) | Real site (e.g. `app.yourdomain.com`) |
|---|---|---|
| Keys | None | All the keys below |
| `NEXT_PUBLIC_DEMO` | Leave unset | `off` |
| What people see | The sample fleet with the AI running, a yellow "Demo" bar, nothing saved or sent | Sign-in, real fleets, real texts, calls and email. No demo page or demo links. A signed-in owner can open a practice sample fleet in their own tab (`NEXT_PUBLIC_SAMPLE=off` removes it) |

- **Show the demo** by sharing the demo site. It can't text, call or email anyone, and it can't touch real accounts: it has no keys.
- **Delete the demo** when you're done showing it by deleting the demo project in Vercel. The real site doesn't change.
- **Bring it back** any time by creating the demo project again. The code stays in the repository.

With `NEXT_PUBLIC_DEMO=off`:

- `/demo` says there's no demo, and the landing page and sign-in page have no demo links.
- `/ops` is the support team's console (for people on the support list), not the sample-data Ops portal.
- The sample fleet for practice stays (a signed-in owner opens it from Home; it lives only in that tab, nothing saved or sent). Set `NEXT_PUBLIC_SAMPLE=off` to remove it too.
- A browser tab that was in the demo can't get back into it.

It's built into the app, so redeploy after changing it.

You can also run the demo on the real site by leaving `NEXT_PUBLIC_DEMO` unset there: `/demo` then opens the sample fleet in a separate tab state, and signing in always leaves it. Two sites is cleaner.

## What it does, and how it was tested

- [docs/features.md](docs/features.md): what the real version does today, and what it doesn't do yet.
- [docs/testing.md](docs/testing.md): how to run the tests, and what each round was tested with.

## Setting it up

Keys go in Vercel's **Environment Variables**, and in `.env.local` when running locally. Never commit them or paste
them in chat. `.env.example` lists every variable.

When you think it's all set, run `npm run check:live -- --env <file with the production values>` (or with the values
in your shell). It checks each value looks right (no secret in a `NEXT_PUBLIC_` variable, the anon and service keys
not swapped, long random secrets, no test-only settings) and then asks each service whether its key works and points
at your site. It only reads, so nothing is texted, emailed or charged, and it never prints a secret. `--offline`
checks the values alone. Fix every ✗ before the first carrier.

### 1. Supabase: accounts and the database

1. Create a project at supabase.com (region near your drivers, e.g. US East).
2. In **SQL Editor**, run every file in `supabase/migrations/` in order, oldest first (the names start with the date), through `20261014000000_lookup_cache.sql`. With the CLI instead: `supabase link`, then `supabase db push`.
3. From **Project Settings → API**, set:
   - `NEXT_PUBLIC_SUPABASE_URL`: the Project URL.
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`: the anon (or publishable) key.
   - `SUPABASE_SERVICE_ROLE_KEY`: the service_role (or secret) key. Only the server uses it, to act on texts, calls and email. It skips the access rules, so never put it in a `NEXT_PUBLIC_` variable.
4. **Authentication → Sign In / Providers → Phone:** turn it on with your SMS provider (Twilio works). Supabase can also set test numbers with fixed codes for trying it out.
5. **Authentication → URL Configuration:** set the Site URL to your web address.
6. **Authentication → Multi-Factor:** turn on TOTP (authenticator app), so owners can add two-step sign-in in Settings → Security.

### 2. Anthropic: the AI

1. At console.anthropic.com, create an API key and add a payment method.
2. Set a monthly spending limit there too.
3. Set `ANTHROPIC_API_KEY`.

Demo visitors keep the scripted replies unless you set `AI_IN_DEMO=on`. That allows 15 questions an hour per visitor, counted separately on each server instance, so it's not a hard cap.

### 3. Twilio: the dispatch number

1. Buy a US phone number with SMS and Voice.
2. **Start A2P 10DLC registration now.** US carriers block business texts from unregistered numbers, and approval can take 1–2 weeks. Every answer the form asks for, and what reviewers check first, is in `docs/sms-registration.md`.
3. On the number's settings, set these, both **HTTP POST**:
   - **A message comes in:** `https://YOUR-SITE/api/channels/sms`
   - **A call comes in:** `https://YOUR-SITE/api/channels/voice`
   - Check-in calls the AI places use the same number and need `TWILIO_FROM_NUMBER` (a Messaging Service alone can't call).
4. Set:
   - `TWILIO_ACCOUNT_SID`
   - `TWILIO_AUTH_TOKEN`
   - `TWILIO_FROM_NUMBER` (e.g. `+14695550199`), or `TWILIO_MESSAGING_SERVICE_SID` if you use a Messaging Service
   - `PUBLIC_BASE_URL` (e.g. `https://backroute.vercel.app`). Twilio signs each request with the exact web address; the app checks the signature and refuses anything unsigned.
5. Voices and speech recognition use Google voices through Twilio in all 7 languages. Check in the Twilio console that each language you need, Punjabi especially, is available on your account.

### 4. Postmark: broker email

1. Create a server.
2. **Sending:** verify your sending domain (DKIM and Return-Path) and set `EMAIL_FROM`, e.g. `dispatch@yourdomain.com`. Replies go out under the carrier's name from that address.
3. **Inbound:** on the inbound stream, set the webhook to `https://YOUR-SITE/api/channels/email?token=A-LONG-RANDOM-SECRET`. Put the same secret in `EMAIL_WEBHOOK_TOKEN`.
4. Set `EMAIL_INBOUND_ADDRESS` to the inbound address Postmark gives you (e.g. `abc123@inbound.postmarkapp.com`). Each carrier's own address is that one with `+their-key` added, and it's shown in their Settings.
5. Set `POSTMARK_SERVER_TOKEN`.

### 5. Vercel: hosting and the two jobs

1. Import the GitHub repository. It's detected as Next.js.
2. Add all the variables above, plus `CRON_SECRET` (any long random string). Both jobs refuse to run without it.
3. **The evening text:** `vercel.json` runs `/api/cron/daily` at 23:00 UTC, which is 6 PM Central during daylight time.
4. **The dispatcher's rounds: `/api/cron/dispatch`, every 5 to 15 minutes.** This sends the check-ins, follow-ups, invoices and detention claims, so without it none of those happen. Vercel's free Hobby plan only allows jobs once a day, so pick one:
   - **Vercel Pro:** add `{ "path": "/api/cron/dispatch", "schedule": "*/10 * * * *" }` to `crons` in `vercel.json` and redeploy. Vercel sends the secret itself.
   - **Any outside scheduler** (cron-job.org, a GitHub Actions schedule, your own server): every 10 minutes, send `GET https://YOUR-SITE/api/cron/dispatch` with the header `Authorization: Bearer YOUR-CRON_SECRET`.
5. `NEXT_PUBLIC_` values are built into the app: redeploy after changing one.

### 6. FMCSA: checking brokers

Get a free web key at https://mobile.fmcsa.dot.gov/QCDevsite/ and set `FMCSA_WEB_KEY`. It's used for MC lookups at sign-up, and for the AI's check of every broker before booking. Without it, every new broker waits for the support team.

### 7. Your support team

1. Each person signs in once at `/login` with their phone. They'll be sent to sign-up, since they have no fleet: just close it.
2. In Supabase's **SQL Editor**, add them:
   ```sql
   insert into public.support_staff (user_id, name)
   select id, 'Sam' from auth.users where phone = '13125550100';
   ```
   Use the phone number digits as Supabase stores them, with no plus sign.
3. From then on, signing in takes them to `/ops`, the support console. Nobody can add themselves: the table can only be changed from the SQL Editor.
4. Set `SUPPORT_PHONES` (e.g. `+13125550100,+13125550101`) for texts about urgent items.

### 8. ELD, load boards and feeds (per carrier)

The owner connects these in **Settings → General → ELD, load boards and feeds**. Keys are checked when added and kept on the server; nobody can read them back.

- **Samsara:** an API token with read access to vehicles and hours of service.
- **Motive:** an API key.
- Trucks are matched by unit number, and drivers by name, so they need to match what's in the ELD.
- **A load feed** is a web address that returns loads as JSON (an array, or `{ "loads": [...] }`) or CSV with a header row. Each load has:

  | Field | What it is |
  |---|---|
  | `loadNumber` | The broker's load number |
  | `originCity`, `originState`, `destinationCity`, `destinationState` | Required |
  | `pickupLocal`, `deliveryLocal` | `YYYY-MM-DDTHH:mm` at the stop |
  | `pickup`, `delivery` | Free-text windows |
  | `equipment`, `rate`, `miles`, `weight` | |
  | `brokerName`, `brokerEmail`, `brokerPhone`, `brokerMc` | An email or a phone is required |

  A header (e.g. an API key) can be added for feeds that need one.

### 9. Load boards (Backroute's side, once per board)

Each board gives Backroute a partner login under its agreement. Until one is set, carriers can save their side and it waits.

- **Truckstop:** set `TRUCKSTOP_WS_USERNAME`, `TRUCKSTOP_WS_PASSWORD` and `TRUCKSTOP_WS_BASE`.
  - The base is the web-service address Truckstop gives with the login; their test one is `https://testws.truckstop.com`.
  - Each carrier enters their own Truckstop **Integration ID**.
- **DAT:** set `DAT_SERVICE_EMAIL` and `DAT_SERVICE_PASSWORD` (Backroute's service account).
  - If DAT gives different addresses, also set `DAT_IDENTITY_BASE` and `DAT_FREIGHT_BASE`.
  - Each carrier enters the email they sign in to DAT with.
  - Check `src/lib/agent/boards/dat.ts` against DAT's documents first.
- **Any other board:** Backroute support pastes a JSON description in the carrier's settings, under **Another load board**:
  - the search address, with `{{originCity}}`, `{{originState}}`, `{{radius}}`, `{{date}}`, `{{equipment}}` and `{{equipmentCode}}` filled in for each truck
  - any headers
  - where the list of loads is in the answer
  - which field is which, using the load-feed field names above

  It's tested with a search when it's added.

### 10. Google Places: help for breakdowns

In Google Cloud:

1. Enable **Places API (New)**.
2. Create an API key restricted to it.
3. Set `GOOGLE_PLACES_API_KEY`.

Without it, the AI still tells the owner and the broker about a breakdown, but a person has to find the shop.

The same key gives the posted hours of a shipper or receiver no driver has reported on yet (a heads-up when the appointment falls outside them).

### 11. Market rates (optional)

Set one of these:

- **Greenscreens.ai:** `GREENSCREENS_API_KEY`
- **DAT RateView:** `DAT_RATES_URL`, plus the DAT service account from step 9
- **Any other rate API:**
  - `RATES_API_URL`, with `{{originCity}}` etc. in it
  - `RATES_API_HEADER`
  - `RATES_RPM_PATH` and `RATES_HIGH_PATH`: where the numbers are in the answer

Check the request format in `src/lib/agent/rates.ts` against the provider's documents first.

### 12. HERE truck routing (optional)

Create a HERE platform API key with Routing v8 and Geocoding, then set `HERE_API_KEY`. Besides road miles and ETAs, it finds each dock's exact spot from its street address (so the driver's truck GPS goes to the dock, not the city) and draws the truck's road on the driver's map, sized for the truck. Without it, drivers copy the dock address into their truck GPS and the map shows a straight line marked "not directions".

### 13. The voice server (for natural calls)

`voice-server/` is a small Node service that holds each call's audio stream. It runs anywhere that keeps a process up: Fly.io, Render, Railway or a small VM, not Vercel.

1. Deploy the `voice-server` folder (`npm install`, then `npm start`) with:
   - `APP_URL`: this app's address
   - `VOICE_SERVER_SECRET`: a long random string
   - `DEEPGRAM_API_KEY`: speech to text
   - `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID`: the voice, one multilingual voice
   - `PORT`, if the host needs it
2. Give it a public `wss://` address. Its health check is at `/health`.
3. In Vercel, set `VOICE_SERVER_URL` to that address and the same `VOICE_SERVER_SECRET`.

Calls switch over as soon as both are set. Remove them to go back to turn-by-turn calls.

### 14. Broker credit (optional)

Any credit service that answers by MC number: the factoring company's broker check, or a freight credit bureau. Set:

- `CREDIT_API_URL`, with `{{mc}}` in it
- `CREDIT_API_HEADER` ("Name: value", for the key)
- `CREDIT_SCORE_PATH` and `CREDIT_DAYS_PATH`: where the score and the days to pay are in the answer (default `score` and `daysToPay`)
- `CREDIT_SCORE_MAX`: the service's top score, if it isn't 100
- `CREDIT_API_NAME`: the name shown on broker checks

Without it, the AI goes by what the carrier's own invoices show once a broker has paid a couple.

### 15. The browser worker (broker websites)

`portal-worker/` is a small Node service with Chromium that does the clicking on other companies' websites. It holds no carrier data and makes no decisions: the app decides each step. Like the voice server, it runs anywhere that keeps a process up, not Vercel. `portal-worker/Dockerfile` has the matching Chromium.

1. In Vercel, set:
   - `PORTAL_WORKER_SECRET`: a long random string
   - `PORTAL_VAULT_KEY`: 32 random bytes, base64 (`openssl rand -base64 32`). It encrypts the carrier's website passwords. Keep a copy somewhere safe: without it the saved logins can't be opened. To change it, put the old one in `PORTAL_VAULT_KEY_OLD` and the new one in `PORTAL_VAULT_KEY`.
2. Run the migration `20261005000000_portal_worker.sql` (it's with the others).
3. Deploy the `portal-worker` folder (the Dockerfile, or `npm install` and `npm start` where Chromium is installed) with:
   - `APP_URL`: this app's address
   - `PORTAL_WORKER_SECRET`: the same secret
   - `WORKER_CONCURRENCY` (default 3), and `PORT` for its health check, if the host needs one
4. For each carrier: Settings → Broker websites → **Let the AI do these itself**, and add any logins they already have.

A job nobody picks up in 30 minutes goes to support, so a worker that's down is noticed. Before switching it on for real carriers, run it against each real site as in `portal-worker/README.md`.

### 16. Billing (Stripe)

Carriers pay per truck per month, through Stripe, with a free trial.

1. In Stripe, make a product with a **monthly recurring price per unit** (one unit = one truck). Turn on the **customer portal** (Settings → Billing → Customer portal) so owners can change their card and cancel.
2. Add a webhook endpoint `https://YOUR-SITE/api/billing/webhook` for `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid` and `invoice.payment_failed`.
3. In Vercel set `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (the endpoint's signing secret), `STRIPE_PRICE_PER_TRUCK` (the price id), and optionally `BILLING_TRIAL_DAYS` (default 14), `BILLING_GRACE_DAYS` (default 7) and `BILLING_PRICE_LABEL` (the dollars per truck, shown in Settings).
4. When you're ready to require payment, set `BILLING_REQUIRED=1`. From then on a carrier whose trial ended with no subscription, whose card has failed past the grace days, or who cancelled gets no new loads booked by the AI (booked loads still run, and the owner is told once a day). Without it, billing is shown but nothing is held.

The owner starts and manages it in Settings → Billing & Team. The daily job keeps each subscription's truck count in step with the fleet (Stripe prorates).

### 17. Phone alerts (push notifications)

1. Make a key pair once: `npx web-push generate-vapid-keys`.
2. In Vercel set `NEXT_PUBLIC_VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` (`mailto:` your support address). Redeploy (the public key is built into the app).
3. Owners turn them on in Settings → Notifications → Phone alerts. On an iPhone they first add Backroute to the home screen (Share → Add to Home Screen) and open it from there.

Everything that lands on an owner's Needs you buzzes their phone; emergencies support has buzz too, marked urgent.

### 18. Knowing when something's down

- **Uptime monitor:** point one (Better Stack, UptimeRobot, Pingdom...) at `https://YOUR-SITE/api/health`. It answers 200 when the app and database do, 503 when not, and nothing else.
- **The System tab** in `/ops` shows each part: database, AI, texts, WhatsApp, voice messages, email, the dispatcher's rounds, messages waiting on a provider, the voice server, the website worker, and AI spending (a carrier using three times its usual in a day).
- **Alerts:** every round of the dispatcher checks the same things and texts `ALERT_PHONES` (or `SUPPORT_PHONES` if that's not set), and emails `SUPPORT_EMAIL`, when something goes down: once an hour per problem, and once when it's fixed. If the texting provider itself is down, the email still goes.

### 19. WhatsApp (optional)

1. In Twilio, register a WhatsApp sender for the dispatch line (Messaging → Senders → WhatsApp senders; Meta approves the business, which takes a few days) and set its webhook for incoming messages to `https://YOUR-SITE/api/channels/sms`, the same as texts.
2. Make one message template (Content Template Builder), category Utility, body like `Dispatch update: {{1}}`, and get it approved. It's what reaches a driver who hasn't written in 24 hours.
3. Set `TWILIO_WHATSAPP_FROM` (the sender's number, `+1...`), `TWILIO_WHATSAPP_TEMPLATE_SID` (the template's `HX...`) and `NEXT_PUBLIC_WHATSAPP_NUMBER` (the same number, for the "message dispatch on WhatsApp" link in the driver app). Redeploy.

Without the template, a driver quiet for a day gets texts by SMS until they write on WhatsApp again.

### 20. Voice messages (optional)

1. A Deepgram account: set `DEEPGRAM_API_KEY` (the same one the voice server uses works). Voice notes are transcribed with `nova-3` in the driver's language; `DEEPGRAM_MODEL` changes the model.
2. For spoken answers on WhatsApp: `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID` (one multilingual voice covers the languages), and `PUBLIC_BASE_URL` so WhatsApp can fetch the audio. Spoken answers are deleted after two days by the daily job.

Without Deepgram, a voice message gets a polite "type it, or call". The System tab shows both.

### 21. Fuel card and toll statements (per carrier, optional)

Nothing to set on Backroute's side. The owner uploads a CSV on Money → Fuel & tolls, or in Settings → Integrations gives the link where the card company publishes a scheduled CSV report (most do: WEX, Comdata, EFS, BestPass), and the header it needs to open, if any. The link is checked when saved and then read once a day by the dispatcher's rounds. The header value is stored server-side and never shown again.

### 22. Weather on the route (optional)

Uses the National Weather Service (`api.weather.gov`) in the US and Environment Canada (`api.weather.gc.ca`) north of the border; both free, no key. `WEATHER_ALERTS=off` turns it off everywhere; `WEATHER_API_BASE` and `WEATHER_CA_API_BASE` point them somewhere else (only for testing).

### 23. Truck parking reservations (optional)

Set `PARKING_API_BASE` and `PARKING_API_KEY` for a reservation network Backroute has a partner agreement with. Backroute calls three things (with `Authorization: Bearer <key>`), so a small adapter in front of any network's API works:

- `GET /v1/spots?lat=&lon=&radius_mi=&arrive=` → `{ spots: [{ id, name, address, lat, lon, price }] }`
- `POST /v1/reservations` with `{ spotId, arrive, driverName, driverPhone, unitNumber, company }` → `{ id, confirmation, checkIn? }`
- `POST /v1/reservations/{id}/cancel`

Spots are only ever booked when a driver or the owner asks. The price and place always come from the service, never from the phone.

### 24. QuickBooks Online (optional)

1. At developer.intuit.com, create an app with the **Accounting** scope.
2. Add `PUBLIC_BASE_URL/api/integrations/quickbooks/callback` as its redirect address.
3. Set `QBO_CLIENT_ID` and `QBO_CLIENT_SECRET`. For Intuit's sandbox companies, also set `QBO_ENV=sandbox`.
4. `PORTAL_VAULT_KEY` must be set: each company's sign-in is stored encrypted with it.

Intuit reviews the app before real companies can connect.

In QuickBooks, Backroute finds or makes:

- a "Freight" service item (on "Freight Income")
- the expense accounts "Fuel", "Tolls and Scales" and "Lumper and Driver Expenses"

Costs are recorded against the company's credit card account if it has one, else its bank account.

### Security, in short

- Every API route checks who's calling: the signed-in person (and their role and carrier, checked against the database as them), support staff, or a secret or signature for webhooks, the cron jobs, the voice server and the website worker. The public ones are the FMCSA lookup at sign-up (limited to 30 an address per 10 minutes) and `/api/health`.
- A signed-in account can ask the AI up to `AI_PER_USER_HOURLY` times an hour (default 300), so a stolen login can't run up the bill.
- Every page is sent with headers that stop framing, MIME sniffing and plain HTTP (`next.config.ts`).
- `npm audit --omit=dev` shows no known vulnerabilities at the time of writing; check it before each release.

## Before real drivers: rules to get right

- **Consent to texts.** Drivers must agree to get texts from the dispatch number. Get it in writing when you add them and check the box in Add a truck (or in Settings → Billing & Team). A driver with nothing on record gets the first text asking them to confirm, and can agree in the app. STOP, START, HELP and every yes are recorded, with the words shown. WhatsApp's own rules also ask for the driver's opt-in; the same records cover it.
- **AI disclosure.** Every call opens by saying it's the carrier's AI dispatcher.
- **Calls to brokers.** The AI says at the start that it's an AI and that the call is transcribed. Check the rules for automated calls with your lawyer; these are business calls about a specific load, not marketing.
- **Transcripts.** What a driver says on a call is turned into text and saved in the log. No audio is recorded. Several states require everyone's consent to record, so have a lawyer confirm whether saving transcripts needs a spoken notice in your states.
- **Emergencies.** The AI tells a driver who reports a crash or injury to call 911 first. It alerts the support team by text and puts it at the top of their queue and of the owner's Needs you. It's not an emergency service, so make sure someone on the support team can always be reached.
- **Practice before it talks to anyone.** Run `node eval/sim.mjs` against the real deployment (with the AI on) and read the misses. Then give each new carrier a shadow week in practice mode and go through "what the AI would have sent" with them before turning it off.
- **A dispatch agreement** with each carrier, saying Backroute writes to brokers on their behalf. Have a transportation lawyer review it.

## Costs, roughly

| Item | Cost |
|---|---|
| Supabase, Vercel, Postmark | Free tiers to start; Postmark about $15/mo past 100 emails |
| Twilio number | About $1–2 a month |
| Twilio texts | About 1 cent each, plus carrier fees |
| Twilio calls, including speech recognition | A few cents a minute |
| Claude (Opus 5) | $5 per million input tokens and $25 per million output tokens: a few cents per text, chat answer or POD photo checked, and a little more per spoken turn, per broker email (it's read, then answered) or per rate con |
| Google Places (breakdowns) | About 3–4 cents per search with phone numbers; one search per breakdown |
| Load boards | Set by each board's agreement |
| Rate data (Greenscreens, DAT RateView) | By subscription |
| HERE routing | Free tier covers a small fleet; then a fraction of a cent per route |
| Natural calls | Deepgram about 0.5 cents a minute, ElevenLabs a few cents a minute, and the voice server's host about $5–10 a month |
| Check-in calls | Twilio's per-minute rate for outbound calls; most check-ins are texts |
| The dispatcher's rounds | Every 10 minutes is about 4,300 short runs a month. Vercel Pro is $20 a month; an outside scheduler is free or close to it |

Check each provider's current prices. The support console's Numbers tab estimates each carrier's monthly cost from what it actually used; set the `COST_*` rates to match your contracts.

## Adding people

In **Settings → Billing & Team → Who can sign in**:

- Tap **Let them sign in** next to each driver.
- Add dispatchers by phone number.
- Add a bookkeeper by phone number: they see the money and the fleet, record advances and mark invoices paid, and can't book or message anyone.
- Send them the sign-in link on the card.
