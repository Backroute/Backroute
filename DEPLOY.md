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
- `/ops` is the support team's console (for people on the support list), not the sample-data Ops portal.
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
- **Your support team, not the carrier's dispatcher.** Anything the AI can't handle goes to Backroute's support team, at `/ops`, for every carrier at once. Examples: a breakdown, a driver who can't be reached, a broker who fails the check, a short payment, an email the AI couldn't answer.
  - Each item comes with the carrier, load, driver, broker, how to reach them, and the texts, calls or emails it came from.
  - Support can take it, call, text the driver from the dispatch number, send or fix the AI's draft, mark a broker as checked, hand it to the owner, or close it with a note the owner sees.
  - Urgent ones (a crash, a missing driver on a late load) also text the support team's phones.
  - The owner sees these items as "Backroute support is on it". Only the carrier's own decisions go to the owner, and on **Full autopilot** those go to support too, so the owner only hears about emergencies.
- **Brokers are checked** before the AI books with them. The broker's MC number (from their email signature or rate con) is looked up with FMCSA: broker authority active, and the name on file matching the name and email domain they use. Someone posing as a real broker, or using a free email, is flagged, and support is asked to look. The AI won't book with a broker who doesn't pass.
- **Getting paid:**
  - Payment emails (ACH notices, remittances) mark invoices paid. A short payment goes to support.
  - An invoice past its terms gets a polite reminder 3 days late, another at 13 days, then support calls the broker's accounts payable. Skipped when the carrier factors.
- **Cancellations:** when a broker cancels, the load comes off the truck and the driver is told not to go, in their language. If the truck was already dispatched, a TONU claim is sent, using the rate con's amount, or $150 checked first. The truck's other offers come back, and within the rules the AI asks for the best one.
- **The AI calls brokers:**
  - When a book request gets no email answer in 30 minutes, the AI phones the broker. It does the same right away for a broker who only gave a phone number (most load board posts).
  - A broker it has no MC number for is asked for it on the call, and it's checked with FMCSA before the AI agrees to book.
  - After booking by phone with a broker it has no email for, it asks where to send the confirmation, then emails a written confirmation with the carrier packet so the rate con comes back to the carrier's address.
  - It says it's an AI and that the call is transcribed, and asks the price the rules set.
  - It counters or accepts only through the same rules as email, and can't be talked into another number. It leaves a short voicemail if nobody answers, and a phone-only broker gets one more call.
  - The booking is still confirmed by the broker's rate con.
- **Load boards** (Settings → General → ELD, load boards and feeds), once Backroute has the board's agreement:
  - **Truckstop** (the carrier's Integration ID) and **DAT** (the carrier's DAT login email). Any other board with an API (123Loadboard, Direct Freight, a broker's portal) is described in JSON by Backroute support, with no new code.
  - Every 30 minutes, for each truck that's empty or delivers within a day and a half, the AI searches within 150 miles of where it will be empty, from when it will be. That lines up the reload before delivery.
  - Loads heading toward the driver's home come first. They go through the same broker check, pricing and booking as email.
  - If the owner turns it on, each truck is also posted as available once a day.
  - Before the agreement is in place, the carrier can still save their side; it shows "waiting on Backroute's agreement".
- **Load feeds:** any list of loads a broker, shipper or load board publishes as JSON or CSV at a web address (Settings → General → ELD, load boards and feeds). It's read every round, and the loads go through the same matching and booking as email. Format below.
- **ELD (Samsara or Motive):**
  - Truck locations and drivers' hours are read every round.
  - The AI offers a truck only loads its driver has the hours to reach in time.
  - It emails the broker as soon as a truck can't make an appointment, instead of 30 minutes after.
- **Pricing and planning like a dispatcher who's been there a while:**
  - **Lane history:** when the carrier has hauled a lane at least twice in the last 4 months, the AI asks what it usually gets there, up to 15% over the posted rate. It never goes under the owner's lowest rate.
  - **Broker memory:** on calls and replies, the AI knows what the carrier hauled with that broker, what it got, and whether they usually push back.
  - **Home time:** when a driver needs to head home, or the owner said "get them home first", the AI picks the load that ends closest to home. It never picks one that would make the driver miss their home day. It skips states a driver said they won't go to.
  - **Capacity emails:** when a truck has nothing lined up, the AI emails up to 4 checked brokers who've sent loads out of that state, saying the truck will be free. That's at most once a day to each broker.
  - **A plan per truck** on the Fleet page: what it's on, what's next or where the AI is looking, and whether the driver makes it home on time.
- **Breakdowns:** when a driver reports one, the AI:
  - finds repair shops, tire service or towing (Google Places) near the ELD position, or near where the driver says they are.
  - texts the driver the nearest open ones.
  - phones them one by one until one says they can come, then texts the driver that shop's number and how soon.
  - emails the broker that the load is delayed.
  - puts the repair bill in front of the owner. The AI never agrees to a repair price.
- **Your rules** (Settings → General): judgment calls the owner can hand to the AI:
  - TONU at the usual amount
  - detention at the usual rate
  - invoices with a noted POD
  - the AI's own email replies on Within my rules
  - the most empty miles to a pickup

  All are off to start. When the owner has sent 3 of the same kind in a row without changing a word, the AI offers once to stop asking.
- **Drivers:**
  - A weekly "how's it going?" text in each driver's language, answered by the same AI.
  - If a driver is unhappy, asks for the owner or mentions quitting, the owner is asked to call them.
  - A home-day request is noted and planned around.
  - The ELD notes when the truck was at the driver's home. After 3 weeks away, the owner is told.
  - If the owner turns it on, each driver gets a weekly text with their loads, miles and estimated pay before deductions.
- **Ask the AI** (dashboard) and driver **Messages** in the app are answered by the AI from the carrier's own data.
- **Evening text:** at 6 PM Central the owner gets a text: what was delivered, what it made, how many trucks are rolling, and what needs them.
- **The log:** every text, call and email in or out is listed in Settings, with what the AI did.
- **Access rules in the database:** they decide who sees what, so it isn't only the app hiding things. See `supabase/migrations/`.

## What it doesn't do yet

The AI now does the day-to-day work of a dispatcher by email, text and phone. What's still out of its reach, or needs something from outside:

- **Load boards need Backroute's agreement with each board.** The code is ready, and each board switches on when its logins are set (below).
  - Truckstop is built from its public web-service reference.
  - DAT's developer documents are only open to partners, so the DAT addresses and fields must be checked against DAT's documents when access is granted. They're marked in `src/lib/agent/boards/dat.ts`.
  - Boards' terms usually limit how results are used; check them when signing.
- **Calls take turns.** The AI and the broker (or shop) speak in turns through Twilio's speech recognition, so there's a short pause after each person speaks, and talking over each other doesn't work.
  - A natural, interruptible voice needs an always-on server holding the call's audio stream (Twilio Media Streams with a realtime speech model). Vercel functions can't hold that open, so it would run on a separate small server. That's the next step for calls.
  - Some brokers won't deal with an AI and hang up. Those come back to email or to support.
- **Emergencies need a person.** For a crash, the AI tells the driver to call 911 and alerts support and the owner. A person reaches the driver, deals with the police report and the insurance claim, and approves any repair.
- **Where it guesses, it asks first**, until the owner turns on the matching rule:
  - a TONU amount the rate con doesn't give
  - detention pay without the broker's terms
  - a POD with a shortage written on it
  - A new broker that fails the check always waits.
- **Miles and ETAs:** they come from about 130 freight cities and each state's middle. For a town not on the list, miles are rough, and the AI doesn't send late notices from them. A mapping service would make both exact.
- **Invoices are simple:** one page with the line-haul rate. Accessorials (lumper, detention, TONU) aren't added to them yet.
- **Two screens editing the same load at once:** the last save wins, and that includes the AI's own changes.
- **Driver edits to loads:** a driver can edit any detail of a load on their own truck, not just its stage.
- **One carrier per person:** a person, or a driver's phone, in two carriers gets the first one.

## Setting it up

Keys go in Vercel's **Environment Variables**, and in `.env.local` when running locally. Never commit them or paste
them in chat. `.env.example` lists every variable.

### 1. Supabase: accounts and the database

1. Create a project at supabase.com (region near your drivers, e.g. US East).
2. In **SQL Editor**, run the files in `supabase/migrations/` in order: `20260924000000_core.sql`, `20260925000000_channels.sql`, `20260926000000_dispatch.sql`, then `20260927000000_support.sql`. With the CLI instead: `supabase link`, then `supabase db push`.
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

## Before real drivers: rules to get right

- **Consent to texts.** Drivers must agree to get texts from the dispatch number. Get it in writing when you add them. STOP, START and HELP work, and STOP is recorded on the driver.
- **AI disclosure.** Every call opens by saying it's the carrier's AI dispatcher.
- **Calls to brokers.** The AI says at the start that it's an AI and that the call is transcribed. Check the rules for automated calls with your lawyer; these are business calls about a specific load, not marketing.
- **Transcripts.** What a driver says on a call is turned into text and saved in the log. No audio is recorded. Several states require everyone's consent to record, so have a lawyer confirm whether saving transcripts needs a spoken notice in your states.
- **Emergencies.** The AI tells a driver who reports a crash or injury to call 911 first. It alerts the support team by text and puts it at the top of their queue and of the owner's Needs you. It's not an emergency service, so make sure someone on the support team can always be reached.
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

- **Access rules:** 59 checks, including:
  - the channel log and brokers
  - that a driver sees only the files on their own truck's loads
  - that only the server reads the AI's check-in records, the support team list, and carriers' ELD and feed keys (not even the owner can read a key back)
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

- **The support team:**
  - What the AI hands off shows in the console across carriers, urgent first, with who to call and the thread.
  - Support can take an item, text the driver, close it with a note the owner sees, or mark a broker checked.
  - An owner can't open the console, and sees support items as handled.
- **Broker checks:**
  - Someone posing as a broker (inactive MC, free email) isn't booked with, and support is asked.
  - A real broker passes FMCSA and is booked with automatically.
- **Cancellations:**
  - A booked load comes off the truck.
  - A dispatched one also gets a TONU claim, and the driver is told not to go.
- **Getting paid:**
  - A payment email marks the invoice paid, and a short payment goes to support.
  - A late invoice gets a reminder, a second one, then goes to support, each once.
- **Calls to brokers:**
  - An unanswered book request gets a call, which opens with the AI disclosure and the price.
  - A lower offer is countered at the floor, and the AI can't be talked into a number the rules didn't accept.
  - Agreement books it pending the rate con, and voicemail gets a short message.
- **Load feeds:**
  - A feed that refuses its key isn't saved, and bad rows are skipped.
  - CSV with quoted commas works.
  - Feed loads are matched like emailed ones, and a phone-only broker gets a call.
- **ELD:**
  - Samsara (two pages of vehicles) and Motive both connect, and a wrong key is refused.
  - Trucks and drivers are matched, and unknown ones are listed.
  - Location and hours are saved, and the broker gets one late notice when the truck can't make it.
- **Full autopilot:** a decision the AI won't make goes to support, not the owner.
- **Load boards** (against stand-ins built from Truckstop's public reference and the DAT shape in the code):
  - Without Backroute's logins, a carrier can save their side, nothing is searched, and it says it's waiting.
  - A wrong Truckstop Integration ID is caught when it's added.
  - Each free truck is searched from where it is, for its equipment, and posted once a day. Searches repeat every 30 minutes, not every round.
  - A post with no phone or email is skipped.
  - A phone-only poster gets a call. The AI asks their MC, checks it with FMCSA on the call, books, emails the confirmation and packet to the address they give, and their rate con books the load.
  - DAT signs in as the organization, then the carrier's user, searches from the truck, and posts it.
  - A board described in JSON is checked when added. Its searches fill in the truck's city, date and equipment, and its loads go through the broker check and booking.
- **Smarter booking:**
  - A lane hauled twice at $3.59 a mile is asked at that rate, not 5% over a lower post.
  - "Get Marcus home first" picks the load to Dallas over a better-paying one to Atlanta.
  - A state the driver avoids isn't offered.
  - Brokers who've sent loads from the state hear a truck is free, once a day, only checked ones.
  - Each truck's plan is saved and shown on the Fleet page.
- **Breakdowns:**
  - Shops are searched near the ELD position. The driver gets the nearest open ones, closed ones marked, ones without a phone left out.
  - The AI calls the first shop. On a no, it calls the next, and the one that says yes goes to the driver with how soon.
  - The broker gets a delay notice, and the owner sees what was done and that the bill is theirs.
  - A second report doesn't start over.
- **Owner rules:**
  - After an edited approval, then 3 sent as written, the AI offers once to stop asking.
  - With the TONU rule on, a TONU claim goes out without waiting.
- **Drivers:**
  - The weekly check-in goes in each driver's language, once a week, and the pay text matches their loads and miles.
  - An unhappy driver reaches the owner, and a home-day request is recorded.
  - The ELD's position at home is noted, and 25 days away tells the owner.

**None of it has been run against the live services yet.** These are all untested:

- Real SMS delivery and real calls
- Real voices and speech recognition
- Supabase Realtime
- Live Claude answers, and how well the AI reads real broker emails and real POD photos
- Truckstop, DAT, Google Places and the ELDs themselves

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
