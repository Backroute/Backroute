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
  - **Haggling, like a dispatcher** (`src/lib/agent/negotiation.ts`): the AI opens at its ask and comes down in steps, up to three counters, each with a reason a broker hears every day (what the lane pays now, the empty miles to get there, a hard place to reload, a truck ready on time), a different one each round. If the broker doesn't move, neither does it. When the numbers get close, it offers to meet in the middle, and on its last number it says it'll book right now if they can do it. An offer within $50 or 3% of its number, and over the owner's lowest, it takes. It aims no lower than 90% of what the lane pays today when a rate service is connected, and never under the owner's lowest. After three counters: at or over the lowest it takes it, just under (within 5%) the owner decides, further under it passes politely and leaves the door open. If the broker comes back with more while the truck is still free, it takes it.
  - **Terms, not just the price:** every book request and acceptance asks for detention (default $50/hour after 2 hours free) and TONU (default $150) on the rate con. The owner sets both in Settings → Your rules.
  - These emails come from templates, so every number in them is exactly what the rules picked, and they read like a dispatcher's: "Can we get it? Our van is empty in Dallas." The back-and-forth is shown on the load. Replies the AI writes itself (a broker's question) are two or three short lines that answer the question first.
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
- **The AI finishes almost everything; your support team gets only a few kinds of thing.** Backroute's support team works at `/ops`, for every carrier at once, and gets only:
  1. **Safety emergencies:** a crash, an injury, danger on the road, or a stranded truck no repair shop or tow company the AI called could help.
  2. **Other companies' websites the AI couldn't finish:** signing in DocuSign or a broker's portal, a carrier setup (MyCarrierPackets, RMIS, Highway), or a dock scheduling site. With the browser worker (step 15) switched on for the carrier, the AI does these itself; support gets the ones that beat it, with the link, its steps and its last screenshot. Without it, support does them all (a signing is asked for as a PDF first).
  3. **Our own systems failing:** the AI couldn't answer a text, call or email even on a second try, or the text or email service was down the whole time a message was worth sending.
  4. **The owner asks for a person.**
  5. **Backup:** something urgent the owner hasn't picked up within an hour (a driver who won't answer on a late load goes to the owner first, since they know the driver).

  Everything else the AI does itself, and what's the carrier's own money goes to the owner. See "What the AI handles instead of support" below.
  - Each item comes with the carrier, load, driver, broker, how to reach them, and the texts, calls or emails it came from.
  - Support can take it, call, text the driver from the dispatch number, send or fix the AI's draft, mark a broker as checked, hand it to the owner, or close it with a note the owner sees.
  - Urgent ones (a crash, a missing driver on a late load) also text the support team's phones.
  - Each item shows its kind and a short playbook, for example emergency, possible fraud, breakdown, broker check or money. It turns red once it's late: 15 minutes for urgent items, 2 hours for the rest.
  - The **Numbers** tab shows hand-offs to support per truck per week, by kind, how fast they're closed, and how many ran late. That's the number to push down.
  - The owner sees these items as "Backroute support is on it".
  - The owner gets the carrier's own decisions: a price just under their lowest, filing on a broker's bond, a claim to their insurer, a broker the AI won't book with. On **Full autopilot**, what the AI already handled is only in the activity log, not in Needs you.
- **What the AI handles instead of support:**
  - **A broker with no MC number:** it emails them for it, checks it with FMCSA when they answer, and asks to book their load if it passes. A broker who fails the check isn't booked; the owner can mark them trusted.
  - **A dock appointment the facility won't set or can't be reached for:** the broker is asked to set it, reminded once after 2 hours, and the time they send goes on the load and to the driver.
  - **Short payments:** the broker is asked what the difference is for and for the balance, with the invoice lines.
  - **Late invoices:** a reminder at 3 days, another at 13, and a final notice at 30 that names the broker's bond. Filing on the bond is the owner's call.
  - **Bank-detail requests:** the standing answer (payment details never change by email), nothing shared, and the owner is told.
  - **Impostors:** no answer and nothing done; the real broker is warned at the address the carrier already had, and the owner is told.
  - **Double brokering:** not booked. The broker the carrier dealt with is asked, at the known address, for a rate con from their own company.
  - **Tracking still off at pickup:** the broker is asked to resend it to the driver's number, and the driver is told.
  - **A broker call the AI couldn't finish:** it follows up by email with where things stood, or calls back.
  - **No email or phone to book a load:** the AI lets it go; the truck stays free.
  - **No broker email for an invoice or claim:** it uses the one on their rate con.
  - **A breakdown with no repair shop found:** it searches for heavy-duty towing and calls those too, before support.
  - **A change after booking priced too low by the broker:** it holds its number once, with the reason.
  - **A hiccup in the AI service:** each answer is tried a second time before anyone is asked.
- **Brokers are checked** before the AI books with them. The broker's MC number (from their email signature or rate con) is looked up with FMCSA: broker authority active, and the name on file matching the name and email domain they use. Someone posing as a real broker, or using a free email, is flagged. The AI won't book with a broker who doesn't pass; one with no MC yet is asked for it.
- **Getting paid:**
  - Payment emails (ACH notices, remittances) mark invoices paid. A short payment gets an email asking what the difference is for.
  - An invoice past its terms gets a polite reminder 3 days late, another at 13 days, and a final notice at 30 naming the broker's bond. Skipped when the carrier factors.
- **Cancellations:** when a broker cancels, the load comes off the truck and the driver is told not to go, in their language. If the truck was already dispatched, a TONU claim is sent, using the rate con's amount, or $150 checked first. The truck's other offers come back, and within the rules the AI asks for the best one.
- **The AI calls brokers:**
  - When a book request gets no email answer in 30 minutes, the AI phones the broker. It does the same right away for a broker who only gave a phone number (most load board posts).
  - A broker it has no MC number for is asked for it on the call, and it's checked with FMCSA before the AI agrees to book.
  - After booking by phone with a broker it has no email for, it asks where to send the confirmation, then emails a written confirmation with the carrier packet so the rate con comes back to the carrier's address.
  - It says it's an AI and that the call is transcribed, and asks the price the rules set.
  - The call goes the way a dispatcher's does: who's calling (and that it's an AI), which load, is it still available; then the freight (commodity, weight, appointments); then "what are you paying on it?". If the broker asks what we need, it gives our number with a reason. It understands a rate per mile ("two eighty a mile").
  - It answers the broker's usual questions from the carrier's data: where the truck is, how far from the pickup, the driver's hours, the MC number.
  - It talks like a dispatcher (short, friendly, confident) and haggles with the same rules as email, saying the reason for each number. It can't be talked into a number the rules didn't give it.
  - Before booking it asks what the freight is, the weight and the appointments. Freight over what the truck can legally carry isn't booked, and hazmat waits for the owner unless they've said they haul it.
  - It leaves a short voicemail if nobody answers, and a phone-only broker gets one more call.
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
- **Market rates** (with a rate data service): the AI knows what the lane pays now. When the post is under the market, it opens at the market average, never past the top of the market's range. Offers show the market next to the post.
- **Invoices with everything on them:**
  - the line haul
  - detention the broker was already sent a claim for
  - a lumper the driver paid, read off the receipt photo (receipt attached)
  - a claimed TONU is invoiced on its own, without a POD

  The Downloads card in Settings exports invoices in QuickBooks Online's import columns, and each driver's pay per load.
- **Fraud checks before money moves:**
  - A rate con from a different MC than the broker the load was booked with (double brokering): the truck doesn't go until support confirms.
  - An email from a domain one letter off a broker the carrier knows is treated as an impostor, even when it quotes the real broker's MC.
  - An email asking to change bank or payment details, or to "verify" an account: the AI doesn't reply, and support confirms by phone.
- **Check calls:** when the rate con asks for tracking, or the owner turns it on for every load, the broker gets a location and ETA email from the ELD every 4 hours.
- **Carrier setup networks:** the carrier's MyCarrierPackets, Highway or RMIS profile links go out with every setup packet. With the browser worker on, a broker's portal invite is filled in on the site by the AI (below); without it, an invite for a network the carrier has a profile on gets the link, and any other goes to support to fill out once.
- **Truck routing** (HERE, truck mode): real road miles for loads posted without them, and ETAs by road for late notices and check calls. Without it, miles are estimated from city coordinates.
- **The whole fleet at once:** when two loads both want the same nearest truck, it takes the better one and the other goes to the next free truck that can reach it.
- **Moving an idle truck to the freight:** a truck that's sat empty 12 hours with nothing that fits is pointed at the nearest place the carrier's loads actually come from (at least 3 in 3 weeks). On full autopilot, within half the owner's empty-miles limit, the AI texts the driver to go. Otherwise it asks the owner. Board searches then run from there.
- **Slow docks:** the AI remembers how long each shipper and receiver kept the carrier's trucks (from the rate con names and the driver's in and out taps). Drivers hear about a 3-hour-plus dock with the new load.
- **Deadlines:** each truck's annual DOT inspection, the quarterly IFTA return, UCR and Form 2290. The owner is reminded ahead of each, once.
- **Natural phone calls** (with the voice server running): the AI hears while it talks and stops when interrupted. Driver calls are covered in English, Spanish, French, Hindi, Russian and Ukrainian, and so are calls to brokers and repair shops. Punjabi calls keep taking turns.
- **Ask the AI** (dashboard) and driver **Messages** in the app are answered by the AI from the carrier's own data.
- **Every email and call gets an answer**, the way a dispatcher's desk works:
  - A broker's yes gets a thank-you and "send the rate con" with the detention and TONU terms. A question alongside a price ("when can you get there?") is answered in the same email, from the carrier's data and never with a new price. A rate per mile ("we can do 2.90 a mile") is handled like any offer.
  - A rate con that matches gets "got it, truck 102 with Ana is set for pickup". One that doesn't gets a list of what's off and a request for a corrected one (and the owner hears).
  - A cancellation before the truck rolled gets "got it, thanks". Loads that fit no truck get "not today, here's what we run", once a day per broker. A request for papers that aren't uploaded yet gets "coming shortly".
  - An email the AI can't answer, even on a second try, gets "thanks, we'll get back to you shortly", and support takes it.
  - These short notes carry no price or promise, so they go out on every autopilot setting.
  - On the phone, brokers asking for the carrier packet get it by email. Questions only the carrier can answer go to the owner.
  - A broker calling back the number the AI called them from reaches the AI, which picks up about that load.
  - The owner can call or text the dispatch line: the AI answers from the fleet data in the owner's language, and passes anything that needs a person to support.
  - A broker who saw a carrier's truck on a load board calls the dispatch line. The post says to call it and ask for the carrier; the owner can switch that back to their own number in Settings → Your rules. The front desk finds the carrier, takes the load down (lanes, time, equipment, weight, company, MC), checks it fits a truck, and works the price on the same call.
  - Anyone else who calls hears who it is and is asked who's calling; the message goes to the support team's phones.
  - Brokers who write in French or Spanish (or another language) get our emails in theirs. Template emails are translated, and every amount, load number and MC is checked to have come through exactly; if anything differs, the English goes. The AI's own replies are written in the broker's language.
  - The owner's calls go through the voice server too, when it's running.
- **One AI, however people reach it.** A driver's text, call or message in the app, and the owner's text, call or message in the app, all go to the same AI with the same tools. So "I'm loaded" moves the load whichever way it's said. In the app's chat the owner can also answer what's waiting ("send it", "don't"); by text or phone they're pointed to the app, because a phone number can't prove it's them.
- **Photos:** a driver can text a photo of the BOL, the signed POD or a lumper receipt. It's stored and checked like an upload in the app and put on their load, and a clean POD finishes the delivery so the invoice can go out. A broker's photo of a rate con by email is read like a PDF.
- **How people really talk:** the AI knows trucking talk (bobtail, deadhead, 34 reset, lumper, TONU, "what's your 20") and what phone transcription does to it ("real fur" is reefer). It handles typos, texting shorthand, all caps, emoji and mixed languages. Phone lines listen for trucking words (Twilio speech hints, Deepgram key terms). A price written as "2,300 dollars" or "$2.3k" is caught by the same guard as "$2,300".
- **Measuring it:** `eval/` generates about 900,000 different messages from 24 things drivers, brokers and broker emails say. They come with typos, shorthand, voice-transcript errors and 7 languages, each marked with what a dispatcher would do. `node eval/run.mjs --n 300` sends a sample to the real AI (dry run: nothing saved or sent) and scores it by intent and by how it was typed. Set `EVAL_SECRET` on the app and in your shell first; the endpoint doesn't exist without it.
- **Practice mode (a shadow week):** in Settings → Phone, text and email, an owner can switch on practice mode. The AI reads their broker email (forward a copy to the carrier's address) and does its whole job: booking, haggling, check-ins, invoices. But nothing leaves: no text, email or call goes out. Each one is kept, shown in Settings as "what the AI would have sent", and a black bar on every screen says practice mode is on. The owner keeps dispatching as they do today and compares. It's the no-risk way to try Backroute before letting it talk to anyone.
- **Simulated brokers and drivers:** `node eval/sim.mjs` plays a week of a small fleet's dispatch work against the real app. It runs whole conversations, by email, text and phone, on practice carriers it makes and deletes, so nothing leaves and no real carrier is touched. The scenarios:
  - brokers who lowball, rush, won't name a price, add a stop after agreeing, write in Spanish, or pose as a known broker to get bank details;
  - a brokerage phone menu with hold and a transfer;
  - drivers running late, broken down on the interstate, stuck at a dock, or angry about pay;
  - the owner checking in.

  Each broker has a hidden most-they'll-pay. With the AI on, the AI plays the other side and a veteran-dispatcher judge scores each conversation. Without it, each follows its script. Hard rules are checked in code:
  - never under the carrier's lowest rate;
  - never less than the broker already offered;
  - nothing sent to an impostor;
  - no internal words.

  The run reports how much of what brokers would really pay the AI got, and exits with an error if a hard rule broke. Set `EVAL_SECRET` on the app and in your shell. It uses the app's own AI key.
- **Negotiation that opens with room and knows each broker:**
  - **Opening:** a bit over a post that already pays (about 8%), and well over the carrier's lowest when the post is under it. It never goes past the top of what the lane pays when a rate service knows it.
  - **Broker history:** it asks at least what this broker has paid on loads the carrier hauled for them (up to 20% over the post). It adds a little with a broker who always takes the first number, and leaves room with one who always pushes back.
  - **Pace:** with a broker who usually comes up 10% or more from their first number, it comes down in smaller steps.
- **Phone menus and hold, on the AI's calls to brokers and repair shops:**
  - "For carrier sales, press 2" gets a 2. A shop's menu gets road service, a language menu gets English, and anything else gets the operator.
  - It waits quietly through hold music and "please hold" (up to about ten minutes), then says who it is again when a person picks up.
  - A menu that keeps looping gets the operator, then a hang-up and the usual follow-up.
  - On natural calls the key press goes into the live call.
- **Fast on load boards:**
  - A truck that's empty now or within six hours is searched every round, not every 30 minutes.
  - When it's empty now and the board load lists a phone number, the AI calls the poster instead of emailing, the way dispatchers cover a load before someone else does. The email is the fallback.
  - An unanswered book request on a load picking up within a day gets a call after 10 minutes instead of 30.
- **Provider outages don't lose messages:** a text or email that fails because Twilio or Postmark is down is kept and sent again by the dispatcher's rounds, with backoff. It gives up once it's too old to make sense (a text after 30 minutes, an email after a day), and support is then asked to reach the person another way. A bad number or address isn't retried. Calls aren't retried either; each call already falls back to a text or email. Everything goes out through one place (`src/lib/channels/out.ts`), and a lint rule stops code from calling the providers directly.
- **Stuck work gets a person:** besides messages that couldn't be delivered, an urgent support item nobody has taken after 15 minutes texts the support team again, once.
- **Two screens on one load:** a screen saves only the fields the person changed, and the database merges them into the current load. An owner fixing a pickup time on a copy from a minute ago can't undo the negotiation, rate con or invoice the AI recorded in that minute.
- **What each carrier costs to run:** every AI call's tokens are counted against the carrier it was for. The support console's Numbers tab shows this month per carrier: AI, texts, emails and call turns, the estimated total and the cost per truck. Set the `COST_*` rates (see `.env.example`) to your own.
- **Bring your history:** in Settings, the owner uploads a spreadsheet of the past year's loads (CSV from a TMS, QuickBooks or their own sheet).
  - It reads the columns by name ("Linehaul", "Pickup City", "Customer", "Load #"...), shows what it found and what it skipped and why, and imports on the owner's OK.
  - The brokers and finished loads it adds give the AI lane prices and broker habits from day one.
  - Importing the same sheet twice doesn't double it, and nothing is invoiced or texted for old loads.
- **The rest of a dispatcher's paperwork and phone work:**
  - **Signing the rate con:** in Settings → Your rules → Rate cons, the owner names who's authorized to sign. When a broker's rate con matches what was agreed on a load the AI booked, the AI adds a signature page (the load, the rate, the terms, the signer's name and the time) and sends the signed copy back with its thanks. Both the broker's copy and the signed one are kept on the load. A rate con that doesn't match is sent back for a fix, never signed. A broker who wants it signed in their own portal (DocuSign and the like) has it signed there by the browser worker when it's on (below); otherwise they're asked for a PDF first, and support signs it there if they insist. With no signer named, the owner is asked once to add one.
  - **Broker websites** (with the browser worker, step 15, and the owner's switch in Settings → Broker websites):
    - **Signing:** a DocuSign, Adobe Sign or broker-portal link for a booked load is signed there in the authorized signer's name. Before the signature the AI reads the rate on the page; if it isn't what was agreed it doesn't sign, asks the broker to fix it and tells the owner. The signed copy is downloaded to the load.
    - **Carrier setup:** a MyCarrierPackets, RMIS or Highway invite is filled in from the carrier's details and papers (W-9, COI, authority, voided check). It signs in with the carrier's login, or opens the account itself with the carrier's AI email address and a strong password it keeps in the vault. The final submit waits for the owner unless they turn on "Submit carrier setups on broker websites" in Your rules (or run full autopilot).
    - **Dock appointments:** a scheduling-site link (Opendock, C3 and the like) for a stop still waiting on its time is booked there: the load number, the earliest slot in the load's window, and the confirmation number go on the load, to the driver and to the broker. A slot outside the window waits for the owner.
    - **What it doesn't know it asks once:** a login, a tax ID, a code texted to the owner. The answer is kept encrypted for next time. Codes the site emails come to the carrier's AI address and are typed in without anyone.
    - **Passwords are never shown:** the owner adds logins in Settings and can't read them back; the AI writes a placeholder and the real value goes to the worker only for that field, only on that website. Nothing typed from the vault is kept in the job's log. Every signature and submit has a screenshot from just before it.
    - **When the site beats it** (it broke, three tries, or the worker is down), a signing asks the broker for a PDF; anything else goes to support with the link, what the AI did and its last screenshot. The owner can send a failed job back to the AI, or stop one.
  - **The broker's tracking app:** when the rate con or the broker's email asks for Macropoint, Trucker Tools, FourKites, project44 or the like, the driver is texted what to accept, with the link when there is one. "Yes" back turns it on and tells the broker. Not on 2 hours before pickup, the driver gets a reminder; still not on at pickup, the broker is asked to resend it to the driver's number.
  - **Dock appointments by phone:** a rate con that says to call for an appointment gets a call to the shipper or receiver (their number from the rate con) to book one, in their working hours, up to three tries. A truck that will miss its appointment gets a call to move it, before the late notice goes to the broker. The time they give goes on the load, the driver is texted it and the broker hears. It goes through their phone menu (receiving, shipping, scheduling), answers the usual questions from the load (load number, weight, what it is), and a facility that says the broker has to set it gets the broker asked by email and support told.
  - **Layover:** a truck held overnight at a stop it reached on time is claimed a day's layover per day, while it's still waiting, at the rate con's layover terms or the owner's rate (default $250). That stop gets no hourly detention on top, and the layover goes on the invoice. Without the broker's terms it waits for the owner's OK, like detention.
  - **Broker credit:** before asking to book, the AI checks the broker's credit: a credit service by MC number (step 14) and, once a broker has paid a couple of invoices, how long they really took. Under the owner's lowest score (default 70 of 100), or 60+ days to pay, it doesn't book on its own and says why. Slower than 40 days, it asks 4% more.
  - **Changes after booking:** a broker adding a stop or sending the truck somewhere else gets a price first: the extra miles at what the load pays a mile (never under the owner's lowest) plus stop pay (default $75 a stop). Their yes, or a revised rate con at the new total, puts it on the load, the driver hears, and it goes on the invoice. A lower number that covers most of it is taken; less goes to the owner.
  - **Factoring:** with a factoring email set, each delivered load's packet goes to the factor the way they want it: a schedule of accounts on top, then the invoice, the (signed) rate con, the signed POD and BOL, and any receipts billed. A load with no rate con on file still goes, and the owner is asked to send it.
  - **Cargo claims:** a broker's claim email (damage, a shortage, OS&D) is acknowledged in writing with what they still need to send (the written amount, the commercial invoice, the noted POD, photos). The driver is asked what happened while it's fresh, and their answer and any damage photos they text go in the claim file. A POD with damage or a shortage written on it starts the file before anyone asks. The file (the load, the times from the driver's app, what the BOL and POD say, the statement) goes to the cargo insurer's claims email once the owner OKs it. Paying a claim or filing it with insurance is always the owner's call.
- **Closer to a veteran dispatcher:**
  - **It remembers drivers.** What a driver mentions about their life or how they like to work (a kid's game, a bad back, no night driving) is kept on their profile and brought up naturally later. The owner's AI sees it too when they ask how someone's doing.
  - **Dock knowledge shared across every carrier.** Each finished stop (the facility, the city, and how long the truck waited, from the driver's app) goes into a shared record, so a driver heading to a dock their carrier has never been to still hears "this one usually takes 4 hours." Nothing else is shared: no load, broker, rate or carrier name. Only the server reads it (`20261004000000_facility_network.sql`).
  - **The carrier's report card.** Once a carrier has at least 5 delivered loads in six months and 90% or more on time, book requests and setup packets say so: loads run, on-time %, tracking on every load that asked, paperwork the same day, no claims. It's the kind of record that gets a carrier on a broker's preferred list. Nothing is said while the record is short or not good.
  - **It asks for reloads.** The rate con thanks tells the broker when and where the truck will be empty and asks if they have anything out of there, unless the truck already has its next load.
  - **Brokers who won't talk to an AI** ("we don't deal with robots") get a polite goodbye, an email right away with where things stood, and email only from then on.
  - **Blurry paperwork** a broker's billing clerk couldn't read is asked for again on the spot, with a tip (flash, flat, all four corners), before the driver leaves the dock. It isn't filed or used to mark the load delivered.
  - **The weekly review:** the support console's Numbers tab lists what came up most this week, to support or to owners, grouped and with an example each. Each repeat is the next thing to teach the AI.
- **Reaching drivers the way they already talk:**
  - **WhatsApp** (step 19): a driver who writes on WhatsApp is answered there, from the dispatch line's WhatsApp number, and hears from dispatch there after. WhatsApp only takes a free-form message within 24 hours of the driver's last one; after that the text goes as the approved template (one variable: the message) or, without one, by SMS. A driver can pick SMS or WhatsApp in the app (Profile → How dispatch reaches you).
  - **Voice messages** (step 20): a WhatsApp voice note or an MMS recording is turned into text and handled like any text (a status, a reefer reading, a question). What they said is kept with the recording. The answer also comes back spoken (on WhatsApp, or as MMS to a driver who sent one), so the driver never has to look down; the audio is fetched from a link that works for two hours and only opens spoken answers. One that can't be made out gets "type it, or call".
  - **Notifications in the driver app:** a driver turns them on in Profile. Every message from dispatch shows on their lock screen (a new load opens Home). Texts still go too, so nothing depends on the phone keeping the permission. The office's alerts never go to a driver's phone.
  - **Consent to texts and calls:** the owner checks that a driver agreed when adding them (the wording is in `docs/legal/driver-text-consent.md`), or the driver taps I agree in the app (shown in their app's language), or answers YES to the first text. A driver with nothing on record gets that first text before anything else (once per number; never the owner, who agreed when signing up): who's texting, that it's an AI, rates, HELP and STOP. STOP and START are recorded too. With `CONSENT_REQUIRED=1`, nothing else goes to a driver until they say yes: their texts wait (the owner is told once), and go out when they answer YES, agree in the app, or the owner says they agreed. Off by default until your lawyer says which way. A driver can also turn texts off in the app (Profile → How dispatch reaches you) and get notifications instead, as long as their phone takes them; texts come back if it stops for two weeks. Every record keeps the words shown, when, how, and (in the app) the address it came from, and the table refuses changes and deletes (`20261009000000_natural_dispatch.sql`). The owner sees each driver's latest answer in Settings → Billing & Team.
  - **Dock tips, passed on:** a driver mentions "check in at the guard shack, back in from the east gate, receiving closes at 2" and the AI saves it as a tip about that place (names and phone numbers taken out), with the hours. The next driver going there hears it with the new load, in the check-in before the stop, in the morning text, and whenever they ask the AI about the dock. Tips are pooled across carriers, like dock times, and kept to the place: names, phone numbers and links are taken out, a tip that reads like orders to the AI is refused, a driver can leave at most 8 a day, and the AI treats tips as information only. With the rate con's ZIP, two docks with the same name in a city don't share tips.
  - **The morning text:** in each driver's morning (5 to 9 local, never before their "no calls before" hour), on days with a stop, one text with the stops and times, appointment numbers, dock tips, slow docks, the reefer setting, National Weather Service warnings where the truck is and is going, and hours left. The AI writes it in the driver's language; a plain list if it can't. The owner can turn it off for everyone (Settings → Notifications), a driver for themselves.
  - **Reefer loads:** the rate con's set point or range, mode and pre-cool are read off it and go to the driver with the load and before pickup. Once loaded the AI asks for the unit's reading and the pulp temperature, and again before delivery. A reading (texted, said in a voice message, or in a photo of the display with the number) is kept on the load; one out of range tells the driver what to check and reaches the owner (urgent at 5°F off). A warm pulp temperature at pickup: don't sign the BOL until it's written on it. The readings go in the cargo claim file.
- **Quick to steer, easy to use:**
  - **Undo:** an email the AI writes on its own to book, counter or accept waits 90 seconds before it goes (Settings → Basics: send at once, 1 minute, 90 seconds or 5 minutes; `UNDO_SECONDS` sets the default). Home shows it under "About to send" with Undo. A stopped book request puts the load back with its offers; a stopped counter or acceptance leaves the broker's number for the owner to answer. Sent by a short wait after the request that wrote it, and by the dispatcher's rounds if that was cut off (`20261011000000_owner_ux.sql`).
  - **Answer from the notification:** what needs the owner arrives on their phone with Yes / No buttons (Android and desktop; iPhone opens the app). The button carries a signed token for that one item, good for two days.
  - **Teach the AI** on each load: never this broker, never below a rate on this lane, get this driver home first.
  - **Settings → Basics:** five plain questions (lowest rate, empty miles, how much the AI does alone, each driver's home time, how to reach the owner); everything else is under More.
  - **Home:** a getting-set-up checklist with progress until the first load is booked, money this week (in, out, kept) with late invoices and what the AI already sent, and empty screens that say what to do next.
  - **Weekly review** adds up to three things the AI learned (a broker paying slower than their terms, a lane that pays more on one weekday, a broker who takes the first number).
  - **Late trucks:** when the ELD says a stop will be missed, the owner hears it with the new arrival time at the same moment the broker does.
  - **Fleet from a photo:** in the truck and driver form, "Fill in from a photo" reads a whiteboard, printed list or spreadsheet on screen. Nothing is saved until the owner checks it; rows hard to read are marked, and phone numbers are kept only when whole.
  - **Opens at once, and with no signal:** the last view is kept on the device for three days (forgotten on sign-out), shown right away and refreshed in the background. The installed app keeps its own pages and files on the phone too (`public/sw.js`, built app only), so it opens even when the phone has no signal at all.
  - **Nothing lost offline:** a tap made with no signal (arrived, loaded, a setting, a message) is tried again every few seconds while the app is open, and also kept on the phone. If the phone closes the app first, it goes as soon as the app is opened with signal again, on top of what the database has, field by field (an office change to another field isn't undone), with the time it was tapped. Photos wait the same way. The app shows "N waiting to send" until it's all gone. Parked off duty, a truck's ELD spot still comes in (that's where the AI plans its next load); a personal-conveyance trip isn't followed.
  - **Drivers:** one-tap answers to dispatch in their language, picked for where they are on the trip; this week's pay with what the current load adds and payday; hands-free switching on by itself once the phone moves at road speed (only if location is already allowed; a driver can turn it off); a framing hint and a blur, dark or glare check before a document photo goes; photos taken without signal kept on the phone and sent when it's back, with "N waiting to send".
  - **Look:** one set of status colors on every screen (green done, blue in progress, amber waiting on someone, red needs you), helper text dark enough to read in sunlight, larger tap targets in the driver app, visible keyboard focus, and no animation for people who turned motion off.
- **Modern and quick to run:**
  - **Dark mode** that follows the phone, or Light, Dark or Auto in the account menu, Settings and the driver's profile (kept on that device). It's applied before the page draws, so a dark phone never flashes white.
  - **Needs you:** plain cards with a colored edge for how urgent each is (red decide now, amber waiting on you, grey for your information), most urgent first. On a phone, swipe right to do a card's one-tap action and left to set it aside for later. Several of the same paperwork (detention, layover and TONU claims, invoices, payment reminders, ETA updates, setup packets, short replies) can be sent together; offers, counters and anything with a new price never are.
  - **Since you were last here:** after three hours or more away, Home opens with what the AI did meanwhile (booked, delivered, paid, calls) and what waits.
  - **Fleet map** on Home: every truck as a dot by what it's doing (moving, at a stop, running late, empty), from the ELD when connected; tap one for its trip. Map tiles from OpenFreeMap (no key).
  - **Money:** the last 8 weeks in bars (what came in, what it cost, what was kept), and the same per truck and per lane, from the carrier's own loads.
  - **On a phone:** a tab bar for the owner like the driver's; the app icon shows how many things need the owner (installed app); long-press the icon for Needs you, Ask the AI, and the driver's next stop.
  - **Command bar** (Ctrl+K or the search box): find a load, truck or driver; run "pause the AI" or "dark mode"; anything else, like "book Marcus home by Friday", goes to the AI dispatcher as an order or a question.
  - **Pause everything:** the AI status pill at the top. Paused, the AI keeps reading email and answering drivers, but books nothing, sends nothing to brokers, and calls no broker or dock; what it would send waits in Needs you, and emails waiting for Undo wait too and go on the first round after Resume. The owner's own taps (send this, ask to book that) still go. Breakdown calls to repair shops still go.
  - **Load timeline:** every load from the offer to the money: asked to book (by the AI or by you), booked, rate con, picked up, delivered, invoiced, paid, with when and who.
  - **Loads:** search and filters (truck, broker, time) remembered on the device, ready-made views (unpaid over 30 days, running late, no rate con yet, delivered with no POD) and your own saved views.
  - **Sample fleet:** a new owner can open a made-up fleet from Home to practice (answer Needs you, pick a load, ask the AI, open a timeline, pause and resume), with a checklist that ticks off. It lives only in that browser tab, nothing is saved or sent, and Back to my fleet returns to the real account. It's on the real site too (separate from the public demo); `NEXT_PUBLIC_SAMPLE=off` removes it.
  - **Drivers:** quick replies learn their own words (short things they've sent twice come first); a microphone on the message box types what they say, in their language; and an optional next stop on the lock screen (a quiet notification that changes as the trip moves).
  - **Help on settings:** a "?" beside each of the main settings with two plain lines and an example.
  - Loading shows the page's outline instead of a spinner, alerts never stack more than two (the rest are in the bell), and cards and alerts move gently (none for people who turned motion off).
- **Owners seeing why:**
  - **Why-lines:** every load the AI asks to book says why, on the load and on anything waiting for the owner's OK: what it pays a mile against their lowest and the market, empty miles to the pickup, what it does for the driver's home time, how the broker pays (their own invoices first), and what else the truck had. Each counter or acceptance adds a line with the broker's number and the AI's answer.
  - **Holidays, dock hours and drive time:** each offer and booking is checked against the days most docks close (New Year's, Memorial Day, July 4th, Labor Day, Thanksgiving, Christmas, and the observed days), days many close early, the hours drivers reported for that dock, and whether one driver (or a team) can legally drive it between pickup and delivery: 11 hours driving in a 14-hour day, the 30-minute break, 10 hours off, about an hour a day for the pre-trip and fuel, and, for a pickup soon, the hours the driver has left by the ELD. A stop in a Canadian province is checked against Canada's holidays (and Quebec's). A dock's hours from the carrier's own drivers can stop a booking; another carrier's driver's are a heads-up. A hard problem is shown on the load and keeps the AI from asking for it on its own; a new one found at booking goes to the owner.
  - **The weekly review:** Monday morning (owner's time), the week in a minute: loads, gross and net, per mile, empty miles, best broker (from two loads or more) and worst (a slow payer first), and one thing to change, like dropping a broker who pays in 40 days or a driver 3 weeks from home. On Home, by text, and on the owner's phone.
  - **History from old rate cons:** in Settings → Bring your history, besides a spreadsheet: upload up to 40 old rate cons (PDFs or photos) at a time (the app sends them in parts of 4 MB; a bigger file goes by email), or forward them from email to the history address (`inbound+KEY-hXXXXXXXXXX@...`, with a new random part each time it's opened, so a broker who knows the carrier's address can't guess it), which opens for a week from the app. Each is read for the broker (name, email, MC, payment terms), lane, rate and docks, and becomes finished history for pricing, never invoiced or texted. The same file twice is read once. Each import (spreadsheet, upload or email) is listed under Your imports with an Undo that takes out its loads and the brokers it added that nothing else uses (`src/lib/agent/import-batches.ts`).
- **The back office:**
  - **Paperwork reminders:** each truck's registration and annual DOT inspection, each driver's CDL and medical card, the insurance certificate, the IFTA return each quarter and the decals each December. The owner hears 30, 14 and 7 days ahead and once it runs out, each once (Needs you, and their phone). They're listed on Compliance. A truck with a lapsed inspection or registration or an engine code that means stop, or a driver whose CDL or medical card ran out, isn't booked by the AI.
  - **Fuel & tolls** (Money): fuel card and toll statements as CSV (WEX, Comdata, EFS, BestPass and most others export one), uploaded or read once a day from the report's link (Settings → Integrations, with the header it needs). Each line goes on the load its truck was on that day; a unit number the app doesn't know is asked once: pick the truck and every line with that unit goes on its loads. The same line from an overlapping statement is saved once. Shows what each load really cost and diesel by state for the IFTA quarter.
  - **Driver pay** (Money): each week's pay worked out from the loads (percentage, per mile or flat), less deductions, escrow and advances. An advance bigger than the week's pay is carried to the next week, never a pay below zero. Check, pay, mark paid, and download as CSV; at year end, the 1099-NEC list: what each contractor was paid (reimbursements left out) and who needs one ($2,000 or more from 2026).
  - **Customers:** shippers who book the carrier directly, with their terms, and lanes they run every week. The AI makes those loads a week ahead on a truck that fits, once each.
  - **Lanes** (Money): the carrier's rate per mile on each lane, month by month, against the market.
  - **A bookkeeper:** an account that sees loads, money, fuel, pay and the fleet list, records advances and marks invoices paid, and nothing else: no booking, no messages to brokers or drivers, no AI chat, no settings.
  - **Who did what:** every change to loads and settings, trucks and drivers added or removed, who can sign in, and pay, advances and payments is in Settings → Security, with who (owner, dispatcher, bookkeeper, driver or the AI) and when. Only the owner reads it.
  - **Two-step sign-in:** the owner can add an authenticator app (Settings → Security). After that, an account's data stays out of reach until the 6-digit code is entered, in the database itself. The same page lists the devices signed in, with Sign out everywhere else.
  - **From the ELD:** the odometer (for service due by miles) and engine codes, each with what it means and what to do. One that means stop reaches the owner at once.
- **On the road (driver app):**
  - **Directions, truck-safe only:** the big button opens the driver's truck GPS app (Sygic Truck or CoPilot Truck, picked once; "Get the app" if it isn't on the phone) at the dock itself. Google Maps, Apple Maps and Waze are left out on purpose: they route like a car, under low bridges and onto parkways. The dock's street address comes from the rate con (or the office types it on the load) and is looked up to its exact spot at street level (HERE, step 12); a city-only match is never used. Without an exact spot the driver copies the address and is told to check the pin; with no address at all the card says so and to ask dispatch, never "go to Memphis". The new-load text has the address too, and the AI tells drivers the same: truck GPS, the dock's address, no car apps.
  - **The trip map** draws the road a truck this size takes (HERE truck routing), or, without it, a dashed straight line marked "Straight line · not directions". In a real account the truck's dot, miles left and arrival time come from its ELD position (fresh within 30 minutes); with none the card says "No GPS yet" instead of moving a dot on a timer. On the owner's fleet map a truck placed without GPS is faded and the legend says it's estimated.
  - The fuel plan (where diesel is cheapest on the way) uses sample prices, so it shows only in the demo until a fuel card price feed is connected. The Lanes page compares against the market only when a rate service gives one (step 11); a load the owner typed in isn't treated as the market.
  - **Hours clock** at the top, counting down from the ELD's last reading, with a spoken heads-up at 60, 30 and 15 minutes left (Profile turns the voice off), and where on the way the hours run out, with truck parking near there.
  - **Weather on the route:** National Weather Service warnings along the way to the next stop (`/api/weather`, US points only).
  - **Lumper money:** the driver asks for the amount at the dock; the office gets it on their phone and in Needs you, sends the express code (Comdata, EFS) back, and the driver sees it in the app, never on the lock screen.
  - **Paperwork photos** are cropped to the page, with the contrast lifted so they read like a scan, before they go.
  - **Location only on duty:** the app stops sending where the phone is once the driver is off duty.
- **Drivers can ask for what's near them:** truck parking, a truck stop, diesel, a CAT scale, a truck wash, a repair or tire shop, by text or on a call (needs the Places key from the breakdown step).
- **Evening text:** at 6 PM Central the owner gets a text: what was delivered, what it made, how many trucks are rolling, and what needs them.
- **The log:** every text, call and email in or out is listed in Settings, with what the AI did.
- **Access rules in the database:** they decide who sees what, so it isn't only the app hiding things. See `supabase/migrations/`.
  - A driver's app can change only the trip on their own truck's loads: the stage along the trip, times, documents and stops. The rate, broker, invoice and rate con stay as the office and the AI set them, even when a phone saves an old copy (`20260929000000_driver_edits.sql`).
  - Texts, emails and calls that didn't go straight out (held in practice mode, or waiting to be sent again after a provider outage) are readable by the carrier's office only, and only the server writes them (`20260930000000_outbound.sql`).
  - A screen's save of a load carries only what it changed, merged into the current row (`20261001000000_merge_edits.sql`).
  - What each carrier costs to run is server-only: no one who signs in can read or change it (`20261002000000_usage.sql`).
  - The signed rate con, the factoring schedule, claim files and damage photos are kept with the load's other files (`20261003000000_paperwork_kinds.sql`).
  - Trucks, drivers and Needs you items merge the same way loads do, and an old copy can't reopen a closed Needs you item. (This also fixed loads: the app's upsert used to replace the whole load; now it merges.) (`20261006000000_merge_more.sql`)
  - Billing, push devices and the system's heartbeats are server-only; no one can mark their own account paid (`20261007000000_pilot_readiness.sql`). Rate-limit counters too (`20261008000000_rate_limits.sql`).
  - Consent records can't be changed or deleted, even by the server; a carrier's office reads its own drivers', a driver their own. Dock tips: each office reads its own drivers', the server all. How each number texts us is server-only. The weekly review is the office's (`20261009000000_natural_dispatch.sql`).
  - The bookkeeper's limits, the audit log (written by the database, read by the owner only), the device list (each person their own), and two-step sign-in, checked on every table: with an authenticator app on, nothing is readable or writable until its code is entered. Marking an invoice paid goes through one function that changes nothing else on the load (`20261012000000_owner_tools.sql`).
  - Website logins and the answers the owner gives for them are encrypted by the server before they're stored, and no one who signs in can read the table, not even the owner. The website job queue is server-only too, and only the server can hand a job to the worker (`20261005000000_portal_worker.sql`).
- **Dispatching like a senior dispatcher.**
  - **Loads lined up.** The AI books up to three loads ahead per truck, each picking up after the one before delivers (with two hours between). Load boards are searched from where the last load ends. The truck's plan shows the current load, then "Next" and "Then".
  - **The whole fleet at once.** When several offers come in, trucks and loads are paired for the best total, not each load's nearest truck in turn. Each pairing counts the empty miles to the pickup, home time, and how easy it is to reload where the load ends (from the carrier's own offers in the last three weeks).
  - **Asks that learn.** The opening number follows how the last asks went: with this broker (three answered asks or more), else on this lane with anyone (four or more). It opens 5–7% higher when brokers keep taking the first number, and 3–8% lower when most asks are lost. The owner's lowest and the market's top still bound it, and the why line says so.
  - **Rules from repeated answers.** Sending an empty truck to busier freight is a Yes/No for the owner. After three yeses in a row, the AI offers to make it a rule.
- **Weather along the whole route**, not only at the stops: the truck's road (HERE) or the straight line is checked every ~100 miles, in the US (National Weather Service) and Canada (Environment Canada).
- **Dock hours no driver has reported**: the place's posted hours on Google Places, as a heads-up only. They're often the office's hours, so they never stop a booking; drivers' word always wins.
- **Truck parking, only when asked.** The driver taps **Reserve a spot** (spots near where their hours run out, with prices), or asks the AI by text, call or chat. The owner can ask in the app's chat, or book from the app. The AI never books a spot on its own; the tool refuses unless the person's own words asking for it are in their message. The driver gets the address, confirmation and gate code.
- **Late trucks seen sooner.** ETAs use live traffic (HERE), weather warnings on the road ahead, and the driver's hours. Within 30 minutes either side of the appointment, the owner hears it's tight, with why. Past that, the broker is told, as before. A truck stopped 90 minutes or more away from its stops, with the driver on duty, gets an "everything OK?" text.
- **Offline, finished.** The trip's map area is kept on the phone when the trip map opens (the road ahead, whole-trip to town level), so the map still draws with no signal. A Yes/No tapped on a notification with no signal is kept and sent once the phone is back online, with a note saying so.
- **QuickBooks Online, kept in step.** The owner connects their company once (Settings → General). Every hour the AI puts in:
  - each invoice sent to a broker, with the broker as the customer and one line per charge
  - the payment when the broker pays
  - fuel, tolls, and the lumpers and scales drivers paid that the owner approved

  Each goes in once. The company's sign-in is stored encrypted (`20261013000000_quickbooks.sql`). The CSV downloads stay for anyone not on QuickBooks.

## What it doesn't do yet

The AI now does the day-to-day work of a dispatcher by email, text and phone. What's still out of its reach, or needs something from outside:

- **Load boards need Backroute's agreement with each board.** The code is ready, and each board switches on when its logins are set (below).
  - Truckstop is built from its public web-service reference.
  - DAT's developer documents are only open to partners, so the DAT addresses and fields must be checked against DAT's documents when access is granted. They're marked in `src/lib/agent/boards/dat.ts`.
  - Boards' terms usually limit how results are used; check them when signing.
- **Natural calls need the voice server running** (step 13). Without it, calls take turns through Twilio's speech recognition, with a short pause after each person speaks.
  - Even with it, the AI answers in about a second or two, since each answer goes through the same checks as email.
  - Punjabi calls always take turns.
  - Some brokers won't deal with an AI and hang up. Those come back to email.
- **Rate data and routing need their own accounts** (steps 11 and 12). The DAT and Greenscreens request formats must be checked against their documents when access is granted, the same as DAT's load board.
- **Emergencies need a person.** For a crash, the AI tells the driver to call 911 and alerts support and the owner. A person reaches the driver, deals with the police report and the insurance claim, and approves any repair.
- **Where it guesses, it asks first**, until the owner turns on the matching rule:
  - a TONU amount the rate con doesn't give
  - detention pay without the broker's terms
  - a POD with a shortage written on it
  - layover pay without the broker's terms
  - sending a claim file to the insurer
  - A new broker that fails the check, or whose credit is under the owner's lowest, always waits.
- **Broker websites are built but not yet tried on the real sites.** The browser worker (step 15) signs in DocuSign and brokers' portals, fills carrier setups and books dock appointments, and it's tested end to end against stand-in sites. Each real site (DocuSign, Adobe Sign, MyCarrierPackets, RMIS, Highway, Opendock, C3) needs a supervised run first: `portal-worker/README.md` has the plan. Until a carrier's owner switches it on, support does these. Sites that want a selfie or a phone call to prove who you are always need the owner.
- **Credit scores need a credit service** (step 14). Until one is set, the AI only has the carrier's own payment history, which starts empty.
- **Miles and ETAs without a routing account** (step 12) come from about 130 freight cities and each state's middle. For a town not on the list, miles are rough, and the AI doesn't send late notices from them.
- **Negotiation is by rules, not instinct.** The AI haggles in steps with reasons, and adjusts to each broker's history. But it doesn't read a broker's mood, bluff about other loads, or trade favors across loads the way a long-time dispatcher might. Every number comes from the rules, on purpose, so it can't be talked below the owner's lowest.
- **The simulator's scores with the real AI haven't been measured yet.** It needs the app running with `ANTHROPIC_API_KEY` and `EVAL_SECRET`. The scripted runs check the money rules and the plumbing; only the AI-played runs say how human it sounds.
- **The legal paperwork is drafted, not done.** `docs/legal/` has drafts of the carrier agreement (with the authority to act and sign for the carrier), terms, privacy policy, driver text consent and the call notice, plus the questions for your lawyer. The consent checkbox, the first text and the records are built with the draft wording; change it in `src/lib/consent-words.ts` (and bump `CONSENT_VERSION`) once your lawyer approves.
- **WhatsApp needs Meta's approval** of the business and the template (step 19), and voice messages need Deepgram and ElevenLabs accounts (step 20). Punjabi voice messages are auto-detected and may not come through; those drivers are asked to type or call.
- **Weather covers the US and Canada only.** Mexico isn't covered.
- **Holidays are the US ones.** A dock's hours come from what drivers told the AI, else its posted hours on Google Places (a heads-up only). A dock with neither is assumed open.
- **Parking needs a reservation partner** (step 23). The API Backroute expects is small and written down. Each network (Truck Parking Club, TA, Pilot) has its own partner terms. Without one, the AI finds lots nearby and the driver books in their truck stop app.
- **QuickBooks Online needs Backroute's Intuit app approved** for production (step 24); until then it runs against Intuit's sandbox companies. It doesn't change an invoice already in QuickBooks when the load's charges change later (add the extra line there), and QuickBooks Desktop isn't supported.

## Setting it up

Keys go in Vercel's **Environment Variables**, and in `.env.local` when running locally. Never commit them or paste
them in chat. `.env.example` lists every variable.

### 1. Supabase: accounts and the database

1. Create a project at supabase.com (region near your drivers, e.g. US East).
2. In **SQL Editor**, run every file in `supabase/migrations/` in order, oldest first (the names start with the date), through `20261012000000_owner_tools.sql`. With the CLI instead: `supabase link`, then `supabase db push`.
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

## Adding people

In **Settings → Billing & Team → Who can sign in**:

- Tap **Let them sign in** next to each driver.
- Add dispatchers by phone number.
- Add a bookkeeper by phone number: they see the money and the fleet, record advances and mark invoices paid, and can't book or message anyone.
- Send them the sign-in link on the card.
