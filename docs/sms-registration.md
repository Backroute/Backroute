# Text registration (A2P 10DLC): the packet

US phone companies block business texts sent from an ordinary 10-digit number unless the sender is registered. You
register through Twilio in two parts: the **brand** (who is sending) and the **campaign** (what the texts are for).
Approval usually takes 1–2 weeks, and a rejection restarts that wait. Start this before anything else in DEPLOY.md
step 3. This page has the answers to paste in, taken from what the app actually sends.

Twilio console: **Messaging → Regulatory Compliance → A2P 10DLC** (or **Trust Hub**).

## Before you submit: what reviewers check

Most rejections come from the website, not the form. Have these live first:

1. **A privacy policy at a public address** (e.g. `https://backroute.pro/privacy`). It must say that phone numbers and
   text consent are **not shared with or sold to third parties for marketing**. The draft is in
   `docs/legal/privacy-policy.md`. Have the lawyer approve it before it goes on the site; it isn't published yet.
2. **Terms at a public address** (e.g. `https://backroute.pro/terms`) with a short "Text messages" section: what the
   texts are about, that frequency varies, that message and data rates may apply, and that STOP stops texts and HELP
   gets help. The draft is in `docs/legal/terms-of-service.md`.
3. **The website and the business match the form.** Same legal name, address and EIN as the IRS letter (CP 575 or 147C).
   The website's contact email (hello@backroute.pro) should be on the same domain as the email you register with.
4. **The number in the campaign is the one in `TWILIO_FROM_NUMBER`** (or the number in the Messaging Service named by
   `TWILIO_MESSAGING_SERVICE_SID`).

## Part 1: the brand

| Field | What to enter |
|---|---|
| Brand type | **Standard** (not Sole Proprietor). Low-volume Standard is cheaper and enough for the first ~6,000 texts a day. |
| Legal company name | Exactly as on the IRS letter |
| EIN | From the IRS letter |
| Business type | Private company (LLC or corporation, as registered) |
| Industry | **Transportation** |
| Website | https://backroute.pro |
| Contact | An owner of the company, with an email on the backroute.pro domain |

If you want carriers' own names to show as the sender on their drivers' phones, that's a separate brand per carrier
(Twilio calls this the ISV setup). Not needed now: one Backroute brand covers it, because every first text says it's the
carrier's dispatch line **run by Backroute**.

## Part 2: the campaign

**Use case:** **Mixed** (low volume), with *Account notifications* and *Customer care* as the sub-uses. If Twilio's form
suggests a single use case, pick **Customer care**.

**Campaign description** (paste):

> Backroute is a dispatch service for trucking companies. It texts the company's truck drivers, and the company's owner,
> about the loads the drivers are hauling: new load assignments with pickup and delivery times, appointment changes,
> check-ins before each pickup and delivery, requests for delivery paperwork, and replies to the driver's own questions.
> The owner gets a daily summary and questions that need their decision. Drivers are added by the trucking company they
> work for, who confirms each driver agreed in writing. Drivers can also agree in the driver app or by replying YES to
> the first text. No marketing is sent.

**How people opt in** (paste; reviewers read this closely):

> Drivers are added by their trucking company (our customer) in the Backroute app. When adding a driver, the company must
> check a box confirming: "This driver has agreed, in writing, to get texts and calls from [Company]'s dispatch line,
> run by Backroute, about their loads and work, including automated texts and calls from an AI dispatcher. I'll keep a
> copy of that agreement." Backroute gives companies a consent form for drivers to sign. A driver can also agree in the
> Backroute driver app, which shows: "I agree that [Company] and its dispatch provider, Backroute, may text and call me
> ... Message frequency varies; message and data rates may apply. I can reply STOP at any time to stop texts, and HELP
> for help." The first text every driver gets explains who is texting and how to stop, and asks them to reply YES.
> Every consent, YES, STOP and START is recorded with the time and the words shown. Owners agree to texts when they
> sign up for Backroute. Privacy policy: https://backroute.pro/privacy. Terms: https://backroute.pro/terms.

If the reviewer asks for a screenshot of the opt-in, send the "Add a truck" screen with the consent box and the driver
app's consent card (Settings → Billing & Team shows each driver's answer).

**Opt-in keywords:** `YES, START, UNSTOP`
**Opt-out keywords:** `STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT` (the app and Twilio both honor these)
**Help keyword:** `HELP`

**Opt-in confirmation message** (sent after YES):

> Thanks, you're all set. Text here any time about your loads.

**Help message:**

> Backroute AI dispatcher for [Company]. Text here about your loads. Reply STOP to stop texts. In an emergency call 911.

**Opt-out message:** Twilio sends its standard confirmation; the app records the STOP and sends nothing more.

**Sample messages** (paste five; they're the app's real wording with sample details filled in):

1. `Titan Freight dispatch: this is your dispatch line, run by Backroute (an AI dispatcher, with people for emergencies). You'll get texts and calls about your loads. Msg frequency varies. Msg & data rates may apply. Reply YES to confirm, HELP for help, STOP to stop texts.`
2. `New load TF-4821: Memphis, TN → Nashville, TN. Pickup Fri, Oct 9, 8:00 AM CDT. Delivery Fri, Oct 9, 3:00 PM CDT. Details in the Backroute app. Text back here with any questions.`
3. `Load TF-4821: pickup at Acme Foods, Memphis, TN is today at 8:00 AM CDT. On track? Reply here if anything's off.`
4. `Load TF-4821: once you're unloaded, take a photo of the signed POD in the Backroute app. Tell me here about any shortage or damage.`
5. `Hi Marcus, it's the AI dispatcher for Titan Freight. Quick weekly check-in: how's it going out there? Anything about loads, pay, home time or the truck you'd like changed? Just reply here.`

**Message details** (the form's checkboxes):

| Question | Answer |
|---|---|
| Embedded links | **Yes**: when a broker requires tracking, the driver is texted the broker's tracking link (MacroPoint, Trucker Tools, FourKites and the like) to accept. No shortened links. |
| Embedded phone numbers | **Yes** (a repair shop's or facility's number during a breakdown or appointment) |
| Age-gated content | No |
| Direct lending / loans | No |
| Affiliate marketing | No |

**Volume:** low. Roughly 10–30 texts per truck per day, both ways.

**Sign-in codes are separate.** The one-time codes for signing in are sent by Supabase through its own SMS setting
(DEPLOY.md, step 1). If that's the same Twilio account, either use Twilio Verify for them (registered by Twilio) or put
them on a different number with its own **2FA** campaign. Don't add them to this campaign.

## After approval

- Twilio links the campaign to the number. Send one text to your own phone and check the console's message log shows
  it **delivered**, not error 30034 (unregistered) or 30007 (filtered).
- Keep the opt-in records: they're in `driver_consents` and can't be edited or deleted while the carrier is on
  Backroute.
- If the wording of the first text, the consent box or the HELP reply changes (`src/lib/consent-words.ts`,
  `src/lib/channels/phrases.ts`), update the campaign's samples to match. A mismatch is grounds for suspension.

## If it's rejected

The rejection names a reason code. The usual ones:

- **Website or privacy policy missing or not mentioning texts:** fix the pages (above) and resubmit.
- **Opt-in unclear:** paste the opt-in text above again, with the screenshots.
- **Brand mismatch:** the legal name or EIN doesn't match the IRS record exactly (punctuation and "LLC" count).

WhatsApp has its own approval (DEPLOY.md, step 19) and doesn't need this.
