# Going live: the real version

Without any keys, Backroute is a demo: a sample fleet, a simulated AI, nothing saved, no sign-in. Each service
below switches on part of the real version, from environment variables only. The code doesn't change.

| Service | What it switches on |
|---|---|
| [Supabase](https://supabase.com) | Accounts (sign-in by phone), saved data, the server's database access |
| [Anthropic](https://console.anthropic.com) (Claude) | The AI: answers, reading rate cons, texting and talking with drivers, drafting broker email |
| [Twilio](https://www.twilio.com) | The dispatch phone number: texts and calls with drivers, the owner's evening text |
| [Postmark](https://postmarkapp.com) | Broker email in and out |
| [Vercel](https://vercel.com) | Hosting, and the evening job |

## The demo stays

Turning things on doesn't remove the demo. `your-site/demo` still opens the sample fleet for anyone, with no
account, and nothing is saved or sent. A yellow bar on every demo screen says so. Share `/demo` with prospects and
send real carriers to `/login` or `/signup`.

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
- **Broker email.** Each carrier gets its own address, shown in Settings → General → Phone, text and email.
  - Brokers email it, or the owner forwards to it.
  - The AI reads any attached rate con and checks it against the load, then writes the reply.
  - With autopilot on **Ask me first** (the default) or **Within my rules**, the reply waits in Needs you. The owner can edit it, then **Send** or **Don't send**.
  - On **Full autopilot** it sends the reply itself.
  - Its instructions say never to agree to a lower rate or new fees, and to flag those for the owner. That's an instruction, not a hard rule in the code, which is why replies wait for approval unless autopilot is on full.
- **Ask the AI** (dashboard) and driver **Messages** in the app are answered by the AI from the carrier's own data.
- **Evening text:** at 6 PM Central the owner gets a text: what was delivered, what it made, how many trucks are rolling, and what needs them.
- **The log:** every text, call and email in or out is listed in Settings, with what the AI did.
- **Access rules in the database:** they decide who sees what, so it isn't only the app hiding things. See `supabase/migrations/`.

## What it doesn't do yet

Know these before real drivers rely on it:

- **It doesn't find loads.** No load-board connection yet: loads come from rate cons and from what the owner types in. DAT and Truckstop need business agreements; that's a separate step.
- **It doesn't negotiate by phone or call brokers.** Broker work is email only, and it only drafts replies to emails that come in.
- **It doesn't call drivers.** It answers their texts and calls, and sends the new-load and evening texts. Outbound check calls come next.
- **Delivery is confirmed in the app** with the signed POD photo, not by text.
- **No ELD connection.** Trucks and drivers are typed in; locations and hours of service aren't live.
- **Within my rules** currently works the same as Ask me first.
- **Two screens editing the same load at once:** the last save wins.
- **Driver edits to loads:** a driver can edit any detail of a load on their own truck, not just its stage.
- **Removals:** when the office removes something, other open screens only see it after a reload.
- **One carrier per person:** a person, or a driver's phone, in two carriers gets the first one.
- **Ops portal:** `/ops` still shows demo data.

## Setting it up

Keys go in Vercel's **Environment Variables**, and in `.env.local` when running locally. Never commit them or paste
them in chat. `.env.example` lists every variable.

### 1. Supabase: accounts and the database

1. Create a project at supabase.com (region near your drivers, e.g. US East).
2. In **SQL Editor**, run `supabase/migrations/20260924000000_core.sql`, then `supabase/migrations/20260925000000_channels.sql`. With the CLI instead: `supabase link`, then `supabase db push`.
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

### 5. Vercel: hosting and the evening job

1. Import the GitHub repository. It's detected as Next.js.
2. Add all the variables above, plus `CRON_SECRET` (any long random string). Vercel sends it with the evening job, and the job refuses to run without it.
3. `vercel.json` runs `/api/cron/daily` at 23:00 UTC, which is 6 PM Central during daylight time. The free Hobby plan allows one run a day.
4. `NEXT_PUBLIC_` values are built into the app: redeploy after changing one.

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
| Claude (Opus 5) | $5 per million input tokens and $25 per million output tokens: a few cents per text or chat answer, and a little more per spoken turn, per email reply or per rate con |

Check each provider's current prices.

## How it was tested

The code was run against local stand-ins that behave like the real services:

- Postgres with Supabase's API layer (PostgREST).
- The Claude API, including tool use.
- Twilio's messaging API, with requests signed exactly the way Twilio signs them.
- Postmark's sending and inbound webhooks.

**What the tests covered:**

- **Access rules:** 50 checks, including the channel log and brokers.
- **Owner sign-up with a typed-in fleet:** no sample data saved.
- **Adding a load from a rate con:** it reaches the driver by text.
- **A driver's text:** it marks the load loaded, and the reply goes back.
- **Webhooks:** a retried one isn't handled twice, a bad signature is refused, and STOP and HELP work.
- **A call:** it greets with the AI disclosure, takes a breakdown report, and hangs up on goodbye.
- **A broker email with a rate con:** the reply is drafted and nothing is sent until the owner edits it and taps Send.
- **The evening text:** it goes out.

**None of it has been run against the live services yet.** Real SMS delivery, real voices and speech recognition, Supabase Realtime and live Claude answers are all untested. Before inviting drivers:

1. Sign up as the owner and add your own phone as a driver.
2. Add a load and check the text arrives.
3. Text the number "I'm at pickup", then call it and ask about the load.
4. Email the carrier address a rate con PDF, then check the draft and send it.
5. Check the log in Settings shows all of it.

## Adding people

In **Settings → Billing & Team → Who can sign in**:

- Tap **Let them sign in** next to each driver.
- Add dispatchers by phone number.
- Send them the sign-in link on the card.
