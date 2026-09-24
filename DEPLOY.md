# Going live: accounts, saved data, hosting

Without any keys, Backroute is a demo: a sample fleet, nothing saved, no sign-in. This guide switches on real
accounts (sign-in by phone number) and saved data with [Supabase](https://supabase.com), and hosts the app on
[Vercel](https://vercel.com). Nothing in the code changes. It all switches on from environment variables.

## What you get, and what's still to come

**Works once the keys are set (phase 1):**

- Sign-in with a phone number and a texted code. No passwords.
- Roles:
  - **Owner:** everything, and the only role that can add people.
  - **Dispatcher:** everything except adding people.
  - **Driver:** only their own profile, truck, loads, calls, messages, inspections, time off and expenses.
  - **Owner-operator:** an owner who is also the driver.
- The owner lets drivers and dispatchers in by phone number (Settings → Billing & Team → Who can sign in). A driver's first sign-in joins them to the fleet automatically.
- The fleet is saved: loads, calls, messages, settings and the AI's log survive reloads and work across devices.
- Screens that are open at the same time stay in step through Supabase Realtime.
- The database enforces who sees what (row-level security), so it isn't only the app hiding things. The rules are in `supabase/migrations/20260924000000_core.sql`.

**Not yet (phase 2 and later). Know these before real drivers rely on it:**

- **The AI still runs in the browser.** It runs in the owner's or dispatcher's open dashboard. If nobody has the dashboard open, nothing gets sourced, called or followed up. Moving the AI to a server so it runs around the clock is phase 2.
- **Loads, brokers and the fleet are still simulated.** Sign-up reads a sample fleet where the ELD import will go, and the AI books sample loads. Real ELD, load-board and TMS connections come after phase 2.
- **Phone calls and texts to drivers are still simulated in the app.** Real calls need a telephony provider such as Twilio.
- **Two people editing the same load at once:** the last save wins.
- **Driver edits to loads:** a driver can edit any detail of a load on their own truck, not just its stage. Phase 2 moves stage changes to server functions.
- **Removals:** when the office removes something, other open screens only see it after a reload.
- **One carrier per person:** someone who belongs to two carriers sees the first one.
- **Ops portal:** `/ops` still shows demo data.

## The demo stays

Turning on accounts doesn't remove the demo. `your-site/demo` still opens the sample fleet for anyone, with no account, and nothing is saved. A yellow bar on every demo screen says so, switches between the owner and driver side, and has **Exit demo**. Everywhere else the app is the real version: the dashboard and driver app ask people to sign in. Share `/demo` with prospects and send real users to `/login`.

## 1. Create the Supabase project

1. Sign up at supabase.com and create a project. Pick the region closest to your drivers (for example, US East).
2. Go to **SQL Editor** → **New query**. Paste all of `supabase/migrations/20260924000000_core.sql` and click **Run**.
   - If you use the Supabase CLI instead: `supabase link` and then `supabase db push`.
3. Go to **Project Settings → API** and copy two values:
   - the **Project URL**
   - the **anon** key. Newer projects call it the **publishable** key. Either works.
   - Don't use the `service_role` key. It bypasses every access rule and must never go in the app.

## 2. Turn on phone sign-in

Supabase sends the sign-in codes through an SMS provider. You need an account with one; Twilio is the most common.

1. In Supabase, go to **Authentication → Sign In / Providers → Phone**.
2. Turn the provider on, choose your SMS provider, and paste its credentials. For Twilio that's the Account SID, the Auth Token, and a Messaging Service SID or a phone number.
3. Texts to US numbers from a business need A2P 10DLC registration with your SMS provider. Registration can take days to a couple of weeks, so start it early.
4. Optional, for testing: Supabase lets you set test phone numbers with fixed codes on the same page, so you can sign in without sending real texts.

Every code texted costs a few cents through the SMS provider.

## 3. Run it locally with real accounts

Create `.env.local` in the project root. It's git-ignored; never commit keys:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-or-publishable-key
FMCSA_WEB_KEY=optional-see-below
```

Then run `npm run dev` and open `/signup`:

1. It asks you to sign in.
2. Sign up with your MC number.
3. Your account is created, and the fleet is saved.

## 4. Host it on Vercel

1. At vercel.com: **Add New → Project**, import this GitHub repository, and keep the defaults (it detects Next.js).
2. Under **Environment Variables**, add the same three variables as in `.env.local`.
3. Deploy.
4. `NEXT_PUBLIC_` values are built into the app. If you change one later, redeploy for the change to take effect.
5. In Supabase, go to **Authentication → URL Configuration** and set **Site URL** to your Vercel address (for example `https://backroute.vercel.app`) or your own domain.

## 5. FMCSA lookup (optional)

For real MC-number lookups at sign-up:

1. Register for a free web key at https://mobile.fmcsa.dot.gov/QCDevsite/.
2. Set it as `FMCSA_WEB_KEY`. It is only used on the server.

Without it, sign-up shows the demo carrier and says so.

## Adding people

The owner does this in **Settings → Billing & Team → Who can sign in**:

- **Drivers:** tap **Let them sign in** next to each one. It uses the phone number on the driver's profile.
- **Dispatchers:** type their phone number and tap **Add**.
- Send them the sign-in link shown on the card. Backroute doesn't text it for you yet.
- When they sign in with that number, they're in, with the access their role allows.

## Checking the access rules yourself

The rules were tested against Postgres 16 with a small stand-in for Supabase's `auth` schema: 39 checks. They cover:

- another fleet sees nothing
- a driver sees only their own things and can't change a coworker's
- a driver can't make themselves owner
- a signed-out visitor reads nothing

The sign-in, save and reload flows were also run end to end, in the browser and in code, through PostgREST (the API layer Supabase uses) against the same migration.

They haven't been run against a live Supabase project yet, including Realtime and real SMS delivery. Do a test pass with two phones before inviting drivers:

1. Sign up as the owner.
2. Let yourself in as a driver on a second phone.
3. Check that the driver sees only their own load.
4. Make a change on each phone and check it shows on the other.
