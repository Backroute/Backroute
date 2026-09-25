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
| What people see | The sample fleet with the AI running, a yellow "Demo" bar, nothing saved or sent | Sign-in, real fleets, real texts, calls and email. No demo page, no demo links, no sample data anywhere |

- **Show the demo** by sharing the demo site. It can't text, call or email anyone, and it can't touch real accounts: it has no keys.
- **Delete the demo** when you're done showing it by deleting the demo project in Vercel. The real site doesn't change.
- **Bring it back** any time by creating the demo project again. The code stays in the repository.

With `NEXT_PUBLIC_DEMO=off`:

- `/demo` says there's no demo, and the landing page and sign-in page have no demo links.
- The sample-data Ops portal is closed.
- A browser tab that was in the demo can't get back into it.

It's built into the app, so redeploy after changing it.

You can also run the demo on the real site by leaving `NEXT_PUBLIC_DEMO` unset there: `/demo` then opens the sample fleet in a separate tab state, and signing in always leaves it. Two sites is cleaner.

## What the real version does

- **Accounts and roles.** Sign in with a phone number and a texted code.
  - **Owner:** everything, and the only one who can add people.
  - **Dispatcher:** everything except adding people.
  - **Driver:** only their own profile, truck, loads, calls and messages.
  - **Owner-operator:** an owner who drives.
- **Your own fleet, no sample data.**
  - At sign-up the owner types in each truck and its driver, with the driver's cell number.
  - More trucks can be added on the Fleet page.
  - In a real account, nothing is simulated.
- **Loads the owner booked.**
  - On Loads, choose **Add a load** and upload the broker's rate con: the AI fills in the form, you check it, pick the truck and add it.
  - The load goes to the driver's app, and the driver gets a text with the pickup and delivery.
- **The dispatch number.** One Twilio number for all carriers. A driver is recognized by the number they text or call from.
  - **Texts:** drivers text it about their load. The AI answers in the driver's language from the carrier's real data.
    - It can mark the load at pickup, loaded or at delivery when the driver says so.
    - It passes problems (breakdown, running late, a crash) to the owner's **Needs you** list.
    - If the AI can't answer, the office gets the message and the driver is told someone will get back to them.
  - **Calls:** drivers call the same number and talk with the AI in their own language (7 languages).
    - It opens by saying it's an AI dispatcher for their carrier.
    - It can do everything the texts can, and says goodbye and hangs up when they're done.
- **Broker email.** Each carrier gets its own address, shown in Settings → General → Phone, text and email. Brokers email it, or the owner forwards to it. The AI handles each email the way a dispatcher would:
  - **Loads offered** (one load or a list): each one that fits a truck goes on the dashboard as an offer, priced by the owner's rules. A truck fits when it has the right equipment, is free (or delivers at least 2 hours before the pickup) and is within 300 miles.
  - **Booking:** the owner taps **Ask to book it**, or on **Within my rules** the AI asks for the best offer per truck by itself. The ask is 5% over the posted rate, never under the owner's lowest rate per mile.
  - **Counter-offers:** at or over the owner's lowest, the AI takes it. Under it, the AI counters once at the lowest. Under it again, the owner decides. These emails come from templates, so the price in them is exactly what the rules picked.
  - **Rate cons:** the AI reads the PDF and checks it against the load. If it confirms a load the AI asked for and matches, the load goes on its truck and the driver gets a text. If anything doesn't match, the owner is told.
  - **Setup requests:** the AI replies with the carrier's W-9, insurance certificate and authority from Settings → General → Your papers. If one is missing or expired, the owner is told.
  - **Anything else:** the AI writes a reply.
- **Check-ins with drivers,** in each driver's language, by text, or by phone for drivers who texted STOP:
  - 2 hours before pickup and 3 hours before delivery: "on track?"
  - 30 minutes after a missed appointment: "are you there?"
  - No answer 45 minutes later: the AI calls the driver and texts the owner.
  - After delivery: a reminder to photograph the signed POD, and the owner is told if it doesn't come.
  - The driver's answer goes to the same AI that handles their texts and calls, so "I'm loaded" moves the load.
  - Turn them off in Settings → General → Rates, billing and check-ins.
- **Paperwork after delivery:**
  - **POD photos:** the driver uploads them in the app. The AI checks each one: that it's the right document, that it's signed, and whether a shortage or damage is written on it.
  - **Invoice:** once a signed POD is in, the AI makes the invoice PDF and emails it with the POD, to the broker or to the factoring company if one is set.
  - **Detention:** when the driver's check-in and check-out times show a stop ran past free time, the AI emails the broker a claim with the times. It uses the rate con's detention terms. Without them, it assumes $50 an hour after 2 hours and asks the owner first.
- **The autopilot switch decides what goes out without the owner:**
  - **Ask me first** (the default): every email to a broker waits in Needs you. The owner can edit it, then **Send** or **Don't send**.
  - **Within my rules:** book requests, counters and acceptances at or over the lowest rate, invoices, detention claims with known terms, and setup packets go on their own. Replies the AI wrote itself wait.
  - **Full autopilot:** the AI's own replies go too, unless one names a price that isn't already in the conversation.
  - Whatever the setting, anything under the owner's lowest rate, a POD with a problem on it, or an unverified broker waits for the owner. The AI won't book on its own without a lowest rate per mile set.
- **Ask the AI** (dashboard) and driver **Messages** in the app are answered by the AI from the carrier's own data.
- **Evening text:** at 6 PM Central the owner gets a text: what was delivered, what it made, how many trucks are rolling, and what needs them.
- **The log:** every text, call and email in or out is listed in Settings, with what the AI did.
- **Access rules in the database:** they decide who sees what, so it isn't only the app hiding things. See `supabase/migrations/`.

## What it doesn't do yet

Know these before real drivers rely on it. This is an AI dispatcher for the work that runs through email, texts and calls. It is not a full replacement for a dispatcher who works the phones with brokers and the load boards.

- **No load boards.** It finds loads only in what brokers email the carrier. DAT, Truckstop and 123Loadboard need business agreements and paid API access; connecting one is a separate project.
- **It doesn't call brokers.** Booking and negotiating are by email only. Many brokers book by phone. The owner still makes those calls, then adds the load (or forwards the rate con).
- **No ELD or GPS.** It doesn't know where trucks are, or drivers' hours of service. Check-ins go by appointment times and what drivers say. A driver who is late without saying so is noticed 30 minutes after the appointment, not before.
- **It doesn't verify brokers.** A new broker is treated as unverified, so the AI won't book with them by itself until the owner marks them OK on the Brokers page. Check authority and the contact yourself, since double brokering and fake-broker fraud are common.
- **Detention pay isn't tracked.** The claim goes out, but whether the broker pays it, and adding it to the invoice, is up to the owner.
- **Payments aren't tracked.** The invoice goes out, but there's no connection to the bank or the factoring company to see when it's paid.
- **Invoices are simple:** one page with the line-haul rate. Accessorials (lumper, detention, TONU) aren't added to them yet.
- **Two screens editing the same load at once:** the last save wins, and that includes the AI's own changes.
- **Driver edits to loads:** a driver can edit any detail of a load on their own truck, not just its stage.
- **Removals:** when the office removes something, other open screens only see it after a reload.
- **One carrier per person:** a person, or a driver's phone, in two carriers gets the first one.
- **Ops portal:** `/ops` still shows demo data.

## Setting it up

Keys go in Vercel's **Environment Variables**, and in `.env.local` when running locally. Never commit them or paste
them in chat. `.env.example` lists every variable.

### 1. Supabase: accounts and the database

1. Create a project at supabase.com (region near your drivers, e.g. US East).
2. In **SQL Editor**, run the files in `supabase/migrations/` in order: `20260924000000_core.sql`, `20260925000000_channels.sql`, then `20260926000000_dispatch.sql`. With the CLI instead: `supabase link`, then `supabase db push`.
3. From **Project Settings → API**, set:
   - `NEXT_PUBLIC_SUPABASE_URL`: the Project URL.
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`: the anon (or publishable) key.
   - `SUPABASE_SERVICE_ROLE_KEY`: the service_role (or secret) key. Only the server uses it, to act on texts, calls and email. It skips the access rules, so never put it in a `NEXT_PUBLIC_` variable.
4. **Authentication → Sign In / Providers → Phone:** turn it on with your SMS provider (Twilio works). Supabase can also set test numbers with fixed codes for trying it out.
5. **Authentication → URL Configuration:** set the Site URL to your web address.

### 2. Anthropic: the AI

1. At console.anthropic.com, create an API key and add a payment method.
2. Set a monthly spending limit there too.
3. Set `ANTHROPIC_API_KEY`.

Demo visitors keep the scripted replies unless you set `AI_IN_DEMO=on`. That allows 15 questions an hour per visitor, counted separately on each server instance, so it's not a hard cap.

### 3. Twilio: the dispatch number

1. Buy a US phone number with SMS and Voice.
2. **Start A2P 10DLC registration now.** US carriers block business texts from unregistered numbers, and approval can take 1–2 weeks.
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

### 6. FMCSA (optional)

Get a free web key at https://mobile.fmcsa.dot.gov/QCDevsite/ and set `FMCSA_WEB_KEY`, for real MC lookups at sign-up.

## Before real drivers: rules to get right

- **Consent to texts.** Drivers must agree to get texts from the dispatch number. Get it in writing when you add them. STOP, START and HELP work, and STOP is recorded on the driver.
- **AI disclosure.** Every call opens by saying it's the carrier's AI dispatcher.
- **Transcripts.** What a driver says on a call is turned into text and saved in the log. No audio is recorded. Several states require everyone's consent to record, so have a lawyer confirm whether saving transcripts needs a spoken notice in your states.
- **Emergencies.** The AI tells a driver who reports a crash or injury to call 911 first, and puts it at the top of Needs you with a Call button. It's not an emergency service.
- **A dispatch agreement** with each carrier, saying Backroute writes to brokers on their behalf. Have a transportation lawyer review it.

## Costs, roughly

| Item | Cost |
|---|---|
| Supabase, Vercel, Postmark | Free tiers to start; Postmark about $15/mo past 100 emails |
| Twilio number | About $1–2 a month |
| Twilio texts | About 1 cent each, plus carrier fees |
| Twilio calls, including speech recognition | A few cents a minute |
| Claude (Opus 5) | $5 per million input tokens and $25 per million output tokens: a few cents per text, chat answer or POD photo checked, and a little more per spoken turn, per broker email (it's read, then answered) or per rate con |
| Check-in calls | Twilio's per-minute rate for outbound calls; most check-ins are texts |
| The dispatcher's rounds | Every 10 minutes is about 4,300 short runs a month. Vercel Pro is $20 a month; an outside scheduler is free or close to it |

Check each provider's current prices.

## How it was tested

The code was run against local stand-ins that behave like the real services:

- Postgres with Supabase's API layer (PostgREST).
- The Claude API, including tool use.
- Twilio's messaging and calling API, with requests signed exactly the way Twilio signs them.
- Postmark's sending (with attachments) and inbound webhooks.

**What the tests covered:**

- **Access rules:** 56 checks. They cover the channel log and brokers, and that a driver sees only the files on their own truck's loads while only the server reads the AI's check-in records.
- **Owner sign-up with a typed-in fleet:** no sample data saved.
- **Adding a load from a rate con:** the appointment times are filled in and saved in the stop's time zone, and the load reaches the driver by text.
- **A driver's text:** it marks the load loaded, and the reply goes back.
- **Webhooks:** a retried one isn't handled twice, a bad signature is refused, and STOP and HELP work.
- **A call:** it greets with the AI disclosure, takes a breakdown report, and hangs up on goodbye.
- **A broker email with a rate con:** the reply is drafted and nothing is sent until the owner edits it and taps Send.
- **The evening text:** it goes out.
- **Setup packets:**
  - With no papers on file, the owner is told what to upload.
  - With papers on file, the packet waits for approval, then goes out with the W-9 and COI attached.
- **Loads from a broker's email:**
  - Each load is matched to the right truck (equipment, timing, distance), and one too far away is skipped.
  - Each is priced at 5% over posted and never under the floor.
  - On Ask me first, nothing is emailed until the owner taps. A driver can't book.
- **Counter-offers on Within my rules:**
  - Under the floor, the AI counters once at the floor.
  - Under it again, the owner decides.
  - When the broker agrees, the matching rate con books the load onto the truck and texts the driver.
- **Rules autopilot:**
  - With an unverified broker, the AI asks the owner.
  - With a broker the owner trusts, it asks the broker to book by itself and sets the truck's other offers aside.
- **Check-ins:**
  - A text before delivery.
  - A call instead of a text for a driver who texted STOP. The call opens with the AI disclosure, and "I'm loaded" on that call moves the load and records the time.
  - Each check-in happens once.
  - An "are you there?" text after a missed appointment. With no answer after 45 minutes, a call to the driver and a text to the owner.
- **POD and paperwork:**
  - The driver's POD photo is stored and checked. A shortage written on it is flagged.
  - A driver can't file a POD on another truck's load, or open the carrier's W-9.
  - The invoice goes to the broker with the POD, as a one-page PDF that a strict PDF reader opens.
  - A detention claim is worked out from the driver's times and the rate con's terms.
  - Each goes out once, and the owner hears once when the insurance certificate is about to expire.
- **The screens** (in a browser):
  - Settings saves the lowest rate, factoring email and check-ins switch, and uploads papers.
  - Offers say they came from email and what the AI will ask.
  - Tapping one sends the book request, raised to the floor if the floor went up.
  - The load page shows where the booking stands, and **book it** puts the load on the truck and texts the driver.
  - A company driver's app shows no broker offers.

**None of it has been run against the live services yet.** These are all untested:

- Real SMS delivery and real calls
- Real voices and speech recognition
- Supabase Realtime
- Live Claude answers, and how well the AI reads real broker emails and real POD photos

Before inviting drivers:

1. Sign up as the owner and add your own phone as a driver.
2. In Settings, set your lowest rate per mile and billing email, and upload your W-9 and COI.
3. Add a load with an appointment about 2 hours out, and check the new-load text and then the check-in text arrive.
4. Text the number "I'm at pickup", then call it and ask about the load.
5. From another email address, send the carrier address a few loads as a broker would, and check the offers that show up.
6. Tap one, answer the book request with a lower number, and watch the counter.
7. Upload a POD photo in the driver app, mark it delivered, and check the invoice.
8. Check the log in Settings shows all of it.

## Adding people

In **Settings → Billing & Team → Who can sign in**:

- Tap **Let them sign in** next to each driver.
- Add dispatchers by phone number.
- Send them the sign-in link on the card.
