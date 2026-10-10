# Testing

## Running the tests

Everything is in [`tests/`](../tests/README.md): the commands, what each suite covers, and how to add one.

| Command | What it runs | Time |
|---|---|---|
| `npm run test:unit` | Types, lint, and the unit tests | about 35 seconds |
| `npm run test:quick` | The unit check, then sign-up, broker email to booking, the latest round's flows, and the demo in a browser | about 15 minutes |
| `npm run test:e2e` | Every end-to-end suite (34), against the stand-ins and a fresh database | about 2 hours |
| `npm run test:rls` | The database's access rules | a few seconds |
| `npm run test:offline` | Offline on the built app (starts fresh, makes the carrier first) | about 2 minutes |

Run `npm run test:setup` once per machine first.

`real-e2e` sets up the test carrier every other suite uses. If it fails, `npm run test:e2e` stops there and says so,
instead of running the rest against a half-made carrier (that once turned a single slow compile into 68 failures).

### Load and walkthrough checks (not in the suites)

- **Load test, 60 carriers:** 3 trucks each, live within the rules, each sent broker loads; then the dispatcher's rounds
  are timed. Against the stand-ins a round took 8.5 s (22.1 s before the rounds ran six carriers at a time).
- **A new carrier, start to first load, phone and laptop sizes:** sign-up (including an MC FMCSA doesn't know and an
  empty fleet form), the first dashboard, Loads, Fleet, Money, Settings and Add a load, with screenshots, an axe
  accessibility scan (WCAG 2 A/AA, serious and critical), sideways scroll and console errors on each. It found a
  stranger's phone number on the evening-text preview, a dead link in the evening text, the demo's autopilot wording
  in a real sign-up, an unnamed call button and "AI" on most screens; all fixed, and the second pass was clean.

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
- **Haggling on Within my rules:**
  - A low offer: the AI comes down part of the way, with a reason. The broker doesn't move: it holds. Its third counter is its last number, never under the floor.
  - Just under the floor after three counters, the owner decides. The broker meets the floor: it takes it, asking for detention and TONU terms.
  - By phone: it asks if the load is available before any price, gets the freight details, knows where the truck is, gives our number when asked, takes a rate per mile, changes its reason each round, meets in the middle when close, and keeps every number on record. Freight too heavy for the truck isn't booked, whatever the price.
  - Far under after three counters: it passes politely and the truck is free; when the broker comes back with more, it takes it.
  - A driver asking where to park gets the nearest truck parking by text.
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
  - Someone posing as a broker (inactive MC, free email) isn't booked with, and the owner is told why.
  - A real broker passes FMCSA and is booked with automatically.
- **Cancellations:**
  - A booked load comes off the truck.
  - A dispatched one also gets a TONU claim, and the driver is told not to go.
- **Getting paid:**
  - A payment email marks the invoice paid, and a short payment gets an email asking for the rest.
  - A late invoice gets a reminder, a second one, then a final notice naming the broker's bond, each once; the owner decides what's next.
- **Calls to brokers:**
  - An unanswered book request gets a call, which opens with the AI disclosure and the price.
  - A lower offer is countered, and the AI can't be talked into a number the rules didn't accept.
  - Agreement books it pending the rate con, and voicemail gets a short message.
- **Load feeds:**
  - A feed that refuses its key isn't saved, and bad rows are skipped.
  - CSV with quoted commas works.
  - Feed loads are matched like emailed ones, and a phone-only broker gets a call.
- **ELD:**
  - Samsara (two pages of vehicles) and Motive both connect, and a wrong key is refused.
  - Trucks and drivers are matched, and unknown ones are listed.
  - Location and hours are saved, and the broker gets one late notice when the truck can't make it.
- **Full autopilot:** a money decision the AI won't make is the owner's, not support's.
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
- **Money and fraud:**
  - The market rate raises the ask on an underpriced post.
  - The invoice bills line haul, claimed detention and the lumper from the receipt, and a claimed TONU gets its own invoice.
  - A rate con from another MC stops the booking; the broker is asked for their own rate con and the owner is told.
  - A lookalike domain quoting a real MC is flagged.
  - A bank-details email gets the standing answer (nothing changes by email), and the owner is told.
  - Tracking-required loads get a check call every 4 hours.
  - A setup request gets the profile links; a portal invite for a network the carrier is already on needs nobody.
- **Fleet:**
  - Loads without miles get truck-route miles.
  - Two loads for one nearest truck are split across two trucks.
  - An idle truck is sent to the freight on full autopilot, or the owner is asked.
  - A slow receiver is mentioned in the driver's new-load text.
  - An inspection due in 10 days is flagged once.
  - Invoices and driver pay download as CSV, and drivers can't download them.
  - Support sees its numbers, and owners can't.
- **Natural calls** (the voice server with speech stand-ins):
  - The app hands the call's audio to the voice server with a signed set of parameters.
  - The AI opens in its own voice.
  - "I'm loaded" moves the load, and talking over the AI stops it.
  - Goodbye ends the call.
  - A stream with a wrong signature is shut, and the turn endpoint refuses callers without the secret.
  - A Punjabi-speaking driver's call stays turn by turn.
- **Practice mode and outages:**
  - In practice mode a driver's text, a broker's setup request and the dispatcher's rounds all run, but nothing is texted, emailed or called. The owner can read what was held.
  - The simulator refuses real carriers, even one in practice mode, and is hidden without its secret.
  - With Twilio down, the AI's reply is kept and sent on the next round. With Postmark down, the setup packet waits and then goes with its attachments.
  - A text held up for an hour is given up on and handed to support.
  - An urgent item nobody has taken in 15 minutes texts support again, once.
- **Phone menus:**
  - "For carrier sales, press 2" presses 2. It waits quietly through hold and talks again when a person picks up.
  - Five other ways menus are read out get the right key: dispatch, carrier services, English, "if you're a carrier", or the operator.
  - A looping menu gets the operator, then a hang-up.
  - A repair shop's menu gets road service.
- **History import:**
  - A dry run finds the columns and says what it skipped, and saves nothing. Only the owner can import.
  - Imported loads are finished history, dated when they ran. Importing twice doesn't double them.
  - The next load from that broker on that lane is priced from what they paid.
  - Nothing is invoiced or texted for old loads.
- **The simulated week** (`eval/sim.mjs`, scripted): every scenario runs with no hard rule broken, and the money captured stays at 90% or more of what brokers would really pay.
- **Closer to a veteran dispatcher** (checks in `gaps-e2e`):
  - A driver's news is remembered and in front of the AI next time.
  - Other carriers' waits at a dock warn this carrier's driver; this carrier's finished stops are shared, and no one who signs in can read the record.
  - The rate con thanks asks for a reload. A book request carries the carrier's record.
  - "We don't deal with AI": goodbye, an email with the offer, and no more calls to that broker.
  - A blurry POD is asked for again with a tip, and isn't filed.
  - Support sees the week's repeated hand-offs.
- **Ready for a paid pilot** (47 checks in `pilot-e2e`):
  - Security headers on every page; the push service worker and the home-screen manifest.
  - `/api/health` for uptime monitors; the full report only for support. A system problem texts whoever's on call and emails `SUPPORT_EMAIL`, once an hour, and again when it's fixed.
  - The public FMCSA lookup refuses the 31st call from one address in 10 minutes.
  - Someone in two carriers works in the one their app says (never one they don't belong to); a driver in two carriers is heard by the one with a load on their truck.
  - Billing: checkout for trucks × price with the trial left; unsigned webhooks change nothing; signed ones start the trial; invoices listed; the owner's Stripe page; the truck count follows the fleet daily; a failed card warns the owner (and buzzes their phone), holds new bookings after the grace days, and paying clears it; a cancelled one holds too.
  - Phone alerts: turned on with a test, sent encrypted and signed; the office's alerts never reach a driver's phone; a phone that's gone is forgotten.
  - The pilot script: a carrier in practice mode with its fleet and invites, moved between stages, its status, and paused.
- **Reaching drivers the way they talk, and owners seeing why** (68 checks in `natural-e2e`, plus 10 on the holiday calendar):
  - Consent: the first text to a new driver says who's texting and how to stop, once; YES, STOP and START are recorded; the app's "I agree" keeps the words in the driver's language, with where it came from; the owner vouches for a driver by the phone typed in; a driver can't vouch for others; a driver on record gets no notice. Records can't be changed or deleted (and the RLS checks, now 96).
  - WhatsApp: answered on WhatsApp from the WhatsApp number; after 24 hours the approved template with the message as its variable (no line breaks); a driver who picked SMS gets SMS.
  - Voice messages: transcribed in the driver's language with trucking words, acted on like a text (a reefer reading out of range reaches the owner), kept with what they said; on WhatsApp the answer comes back spoken from a signed link that won't open with another signature or for another kind of file; one that can't be made out gets "type it, or call".
  - Driver push: turned on in the driver app with a test in their language; a message from dispatch lights up their phone; the office's alerts don't.
  - Dock tips: saved with the hours, without names or phone numbers; the next driver (in Spanish) gets them with the new load, and the AI has them when asked.
  - Reefer: the setting with the load; readings asked for once loaded, once; a photo of the display recorded.
  - Morning text: the stop, time, appointment number, the dock tip, the reefer setting and the NWS warning where the truck's going (not a marine statement); in Spanish for a Spanish speaker; once a day; not for a driver who turned it off.
  - Weekly review: kept, on Home, not readable by drivers, texted to the owner once.
  - A Thanksgiving delivery and 780 miles in 12 hours are flagged and not asked for. A load the AI asks for says why (per mile against the lowest and the market, empty miles, home time, the broker), and a counter adds what it did.
  - History: uploaded rate cons become finished loads (with the docks) and brokers (MC, payment terms); a copy is skipped; a non-rate con is skipped with the reason; drivers can't add history; forwarded rate cons (even inside a forwarded email) go in while the history address is open, and nothing after.
  - The System tab shows WhatsApp and voice messages.
- **Broker websites** (45 checks in `portal-e2e`, the real worker and Chromium against stand-in sites):
  - A DocuSign-style link is signed in the signer's name after the consent box; the signed copy is downloaded to the load, with screenshots before signing and at the end.
  - A portal rate con showing a different rate isn't signed; the broker gets both numbers and the owner is told.
  - A setup invite: the AI opens the account with the carrier's AI address and a strong password (encrypted in the vault), types the code the site emailed, fills the company form and the W-9, asks the owner the EIN once, and waits for the owner's OK before submitting.
  - A scheduling-site link books a slot in the load's window; the confirmation goes on the load, to the driver and to the broker.
  - No password, code or EIN is in the owner's screens, the job logs, the worker's log or support's view. A job only answers to the worker holding it; the worker's door needs the secret.
  - With the worker down, a signing asks the broker for a PDF and a setup goes to support with the link and where it stopped. The owner can retry or stop a job. With the owner's switch off, support still does them.
- **What the AI finishes instead of support** (24 checks):
  - A broker with no MC is emailed for it; their answer is checked with FMCSA and their load is asked for.
  - A bank-details request gets the standing answer and the owner is told. An impostor gets nothing, and the real broker is warned.
  - A short pay gets a question with the invoice lines. A month late gets a final notice naming the bond, and the owner decides.
  - With no facility number, the broker is asked to set the appointment. Their emailed time goes on the load and to the driver, and they get a short thanks.
  - Tracking still off at pickup: the broker is asked to resend it to the driver's number.
  - A portal rate con: a PDF is asked for first, and support signs it only if the broker insists.
  - An urgent item the owner leaves for an hour goes to support, and their phones get it.
  - In all of that, the only new support items are the portal and the owner-silent emergency.
- **The rest of a dispatcher's job** (49 checks):
  - **Rate con:** a matching one is signed (the broker's pages plus a signature page) and sent back, and both copies are kept on the load.
  - **Tracking:** the driver is texted the Macropoint link. Their "yes" turns it on, and the broker is told.
  - **Dock appointments, by phone:**
    - A delivery appointment is booked through the receiver's phone menu (it presses "receiving"). Their question is answered, and the time and confirmation number go on the load, to the driver and to the broker.
    - A pickup move the facility won't make by phone goes back to the broker, and the owner is told.
    - Voicemail is tried again later.
  - **Layover:** a truck held overnight is claimed at the rate con's layover rate, with no hourly detention on top. A late truck claims nothing.
  - **Broker credit:** a broker under the lowest credit score isn't asked to book, and the owner is told why. A slow payer is asked 4% more.
  - **Changes after booking:**
    - An added stop is priced from the extra miles plus stop pay. The broker's yes puts it on the load, and the driver hears.
    - A reroute is agreed by a revised rate con at the new total.
  - **Factoring:** the packet has the schedule, the invoice, the rate con and the POD. It covers the line haul, the layover and the agreed extra stop.
  - **Cargo claim:** it's acknowledged in writing with what the claimant must send. The driver's account goes in the file, and the claim file waits for the owner's OK before going to the insurer.
- **Dispatching like a senior dispatcher** (58 unit checks, 34 end-to-end checks in `ux4-e2e`, and the whole suite again: 779 checks, 34 suites):
  - **Loads lined up:**
    - A truck's lineup is its current load, its next one, then what's booked by pickup time. A booked load more than a day past its pickup doesn't hold the truck.
    - Contract freight isn't held to the three-load limit, and a load with no delivery time is estimated from its pickup.
  - **Fleet-wide matching:** the pairing with the best total wins over each load's nearest truck. A truck that can't take a load is never paired with it.
  - **Asks that learn:**
    - Opening 5–7% higher after the broker took our first number 4 or 5 times, and 3–8% lower after most asks were lost.
    - A load we set aside ourselves isn't a lost ask.
    - A broker's own habit outranks the lane's.
  - **Posted dock hours:**
    - A Saturday delivery at a weekday-only dock is a heads-up, never a hard stop.
    - A different business found by the same search isn't taken as the dock.
  - **Parking, only on request:**
    - A dispatch round never books a spot.
    - The driver's spots come from where their hours run out, and a spot the service didn't offer can't be booked.
    - A second booking the same night is refused, and the bookkeeper can't book.
    - The owner booking for a truck texts the driver the address and confirmation.
    - The AI's tool refuses unless the person's own words asking for it are in their message.
  - **Late trucks, early:**
    - Traffic into Houston turns a 5-hour run into 7, and the owner hears why before the appointment.
    - A truck stopped 2 hours off its stops, with the driver on duty, gets one "everything OK?" text. A driver in the sleeper doesn't.
  - **QuickBooks Online:**
    - A forged return from Intuit is refused, and only the owner can connect. The sign-in is stored encrypted, never shown.
    - Invoices go in with one line per charge, payments are applied to their invoice, and fuel, tolls and an approved lumper each go to their own account. An unapproved cost stays out.
    - Up to 60 entries go in a run, and nothing goes in twice. An invoice number already in the books is linked, not duplicated.
    - Disconnecting tells Intuit to forget the sign-in.
  - **Offline:**
    - A Yes tapped with no signal is kept on the phone and goes through once it's back online, then isn't sent again. This was tested on the built app.
    - The trip's map area is saved and served with no signal: Dallas to Waco is 119 pieces, from the whole-trip view to town level. This was tested on the worker itself, because the test browser's service workers can't reach the internet.
- **Partials on one trip, and the round 5 fixes** (56 unit checks, 30 end-to-end checks in `ux5-e2e`, and the whole suite again: 809 checks, 34 suites, none failing):
  - **The trip planner:**
    - Pallets become feet (8 pallets is 17 ft), and an unknown partial is planned as half the trailer.
    - Hazmat doesn't ride with food, reefer set points 34°F and 0°F don't share, and an exclusive-use load rides alone.
    - Dallas, Waco and Houston partials run in one pass with no trip back: the Waco drop comes before the Waco pickup, and the Houston drops come off last-loaded first.
    - 64 ft of freight doesn't fit 53 ft, and 50,000 lbs is over the limit. A drop due too soon can't be planned, the truck waits for an early appointment, and two hours left on the clock puts a 10-hour break in the ETA.
    - Nine loads is too many for one trip.
    - A Waco-to-Houston partial on a truck already headed to Houston adds far fewer miles than its own 185.
  - **From the broker's email to the last drop (end to end):**
    - Two partials and a full load come in by email. The partials go to the truck already carrying a partial to Houston; the full load doesn't.
    - Riding along costs no empty miles and $18 of fuel. The Waco load is priced as a partial: $525, where a full truck's floor would have asked $550.
    - The AI asks for both partials on the same truck. Booked, each joins the trip, and the driver's text says "Pick it up at stop 2 and drop it at stop 3 of 4."
    - The trip has six stops in order, with nothing to restack. The owner's plan reads "Now: a trip of 3 loads, stop 2 of 6".
    - The driver's home screen lists every stop in order, and the Fleet page shows "Trip: 3 loads · stop 2 of 6", with no page errors.
    - Loaded in Dallas, the truck moves on to Waco. The broker cancels the Waco load: its stops come off, and the driver is told not to go. Both Houston drops end the trip and free the truck.
  - **Parking follows through:** a booked spot is a company-paid cost, the driver gets it again an hour out (once), and cancelling the load cancels the spot and takes its cost off the books.
  - **Tight on time:** the driver gets "traffic adds 2.1 h … Drive safe, no need to rush".
  - **QuickBooks:** detention added after the invoice went in updates it ($1,000 + $150), and a cancelled load's invoice is voided once. What went in is remembered per QuickBooks company, so connecting a different company puts everything in there too.
  - Feeds and boards read partials from a full/partial flag, feet or "8 pallets" in the notes. Per-day dock hours and the reason in the broker's late email are unit-checked too.
  - The built app still opens and sends saved answers with no signal (6 checks), and the offline worker passes its 8.
- **The redesign** (Apple's colours, fewer alerts, simpler screens, a new website; the whole suite again: 809 checks, 34 suites, none failing):
  - Driving mode, calls and sheets open above everything. `demo-smoke` taps the centre and both ends of every button and line in driving mode on a phone and fails if anything else is there. It caught the old bug ("Delivery" and the footer were under the app's own bars) when the fix was taken out.
  - "I'm parked" sits fully on screen and closes driving mode; the website doesn't scroll sideways on a phone and leads with the new headline.
  - The production build still works offline (6 checks), and dark mode was checked by eye on the owner's Home and the driver's loads.
- **Drivers getting in, and carriers leaving:**
  - Each driver typed in at sign-up is texted the app link once, after the notice of who's texting, and can sign in with
    their phone (`real-e2e`). In practice mode the link waits; once the carrier is live the rounds send it, once
    (`sandbox-e2e`).
  - The time-savers (19 checks in `ease-e2e`, 15 in `ease-unit`): the owner's message reaches the driver (a text with
    the company's name when they have no app notifications; a driver can't send as the office); a receipt's amount is
    read off its photo; defect photos are stored; today's stops show the late one with its ETA; Call/Text on a load;
    Message opens that driver's thread; Money in three tabs; Settings search lands on the card; the driver's
    things-for-you list, time off from Home, the office's message marked as such, and an expense that starts with the
    receipt. The unit checks: minutes from what a driver says, Take it books at the broker's last offer, Walk away
    frees the truck, and plans count as one choice.
  - The "fix everything" round (33 checks in `fixes-e2e`, 45 in `fixes-unit`; the whole suite: 930 checks, 40 suites, none failing): the owner's Gmail connected through Google's sign-in
    stand-in (a changed state turned away, the sign-in stored sealed), then read for freight mail only (the rate con in,
    a friend's note and a phone bill skipped, nothing taken twice); the owner's "Backroute test" and Gmail's forwarding
    code show in the setup and never reach the AI; disconnecting revokes. Every broker email answers to the carrier's
    Backroute address (`dispatch-e2e`). An invoice sent again to accounts payable, then marked paid $150 short and the
    broker asked about it, once. Truck papers: the driver sees their truck's and the fleet's, not another truck's or the
    company's W-9. Screens on a phone: one-line live loads, the load sheet (and no rate for a per-mile driver), papers
    before money on a load that's moving, Messages with nothing scrolled away. The unit checks: one TONU, who sees the
    rate, Reply-To, the freight filter, the signed connect state, setup mail, pre-dispatch stops (cards past delivery,
    hazmat, the 70-hour clock), the ELD's arrive and leave, and the sheet line with no money in it.
  - Leaving (21 checks in `leave-e2e`): only the owner can download or delete. The download comes a page at a time
    (1,005 rows come back as 1,000 + 5), with every file, and never a saved website password or an ELD key. Deleting
    needs the company name typed exactly; if Stripe won't cancel the subscription nothing is deleted; once it does,
    every table of theirs is empty, the account and drivers' consent records are kept, and the sign-ins that were only
    for them are removed. Support's `export` and `delete` do the same, and `delete` refuses without the name.
  - The .zip itself (5 unit checks): the standard CRC-32 check value, and the system `unzip` reads it back byte for byte,
    with a non-English file name and its date.
  - A driver's first day, walked through on a phone (sign in from the link, agree, pre-trip, pickup, BOL, delivery,
    POD): every step works and every screen is free of serious accessibility problems.
- **Ready for real traffic:**
  - Crash reporting (11 checks in `errors-e2e`, 7 unit checks): an error in a browser or on the server is counted by
    kind (the same error on two loads is one kind), never with the page's query; a crashed page reports what it
    caught; a dropped connection isn't reported; 31 reports from one address in ten minutes are cut off at 30; the
    System tab lists them and calls on-call when one keeps happening. `GET /api/errors` with `CRON_SECRET` is the
    drill's test crash.
  - Load test, 200 carriers with 3 trucks each against the stand-ins: made in 90 s, 200 broker emails read in 13 s
    (261 loads), and the dispatcher's rounds took 29 s for the first run (1,609 things done) and 7 to 10 s after,
    inside the 220 s budget. The database's scan counts showed no table read whole; three indexes were added for the
    queries that read across all carriers (`20261017000000_scale_indexes.sql`).
  - The production build, on a phone on slow 4G (1.6 Mb/s, 150 ms) with a 4x slower CPU: the website 547 kB and
    the sign-in page 460 kB, both painted within a second; the driver's home usable in 5.5 s the first time (720 kB)
    and under a second after; the owner's Home 1.26 MB the first time, most of it the map (277 kB, loaded after the
    page) and pages prefetched in the background. The built app still works offline (6 checks).
  - Backups: a dump restored into an empty database with every access rule, function and trigger (runbook).
- **Partials behind the lineup, and by road** (9 more unit checks in `round5-unit`, 7 in `trip-road-unit`): a partial
  booked after a second full load becomes a trip with the next one, planned from where that full load delivers; the
  lineup reads the load it's on, the next full load, then the trip; each delivery moves the truck up; a cancelled
  anchor hands the trip to the load the truck is on. With the HERE stand-in, a Little Rock partial on a Dallas to
  Memphis trip is measured by road through every stop; a place it doesn't know, or no HERE key, keeps the estimate.
- **Access rules:** 125 checks.
  - A stale copy saving one field of a load changes only that field.
  - What carriers cost to run is server-only.
  - The website password vault and job queue can't be read or written by anyone who signs in, not even the owner, and only the server can take a job like the worker.

**None of it has been run against the live services yet.** These are all untested:

- Real SMS delivery and real calls
- Real voices and speech recognition
- Supabase Realtime
- Live Claude answers, and how well the AI reads real broker emails and real POD photos
- Truckstop, DAT, Google Places and the ELDs themselves
- The browser worker on the real signing, setup and scheduling sites

Before inviting drivers:

1. Sign up as the owner and add your own phone as a driver.
2. In Settings, set your lowest rate per mile and billing email, and upload your W-9 and COI.
3. Add a load with an appointment about 2 hours out, and check the new-load text and then the check-in text arrive.
4. Text the number "I'm at pickup", then call it and ask about the load.
5. From another email address, send the carrier address a few loads as a broker would, and check the offers that show up.
6. Tap one, answer the book request with a lower number, and watch the counter.
7. Upload a POD photo in the driver app, mark it delivered, and check the invoice.
8. Check the log in Settings shows all of it.
