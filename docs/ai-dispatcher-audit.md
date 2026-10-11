# The 500 AI-dispatcher items: where each stands

Every item from the list of what it takes for the AI to do a human dispatcher's whole job, checked against the code.

- **Done:** built and tested with the stand-ins.
- **Partly:** part of it is built; the note says what isn't.
- **To build:** can be built and tested now, without real carriers.
- **Needs real accounts:** built or buildable only with live services or real traffic (boards, rate data, real calls, months of real loads).
- **Needs people:** needs native speakers, carriers' permission, or another outside sign-off.

| Status | Items |
|---|---|
| Done | 326 |
| Partly | 98 |
| To build | 44 |
| Needs real accounts | 21 |
| Needs people | 11 |


## 1. Finding loads (1–20)

| # | Item | Status | Note |
|---|---|---|---|
| 1 | Search every connected board for each truck at the same moment. | Partly | Boards searched each round per truck; real boards need agreements |
| 2 | Start searching 36 hours before a truck delivers, not only when empty. | Done | Searches for trucks delivering within a day and a half |
| 3 | Search from where the truck will be, not where it is. | Done | Searches from where the truck will be empty |
| 4 | Widen the search radius step by step when nothing fits. | Done | A search that finds nothing widens to 250, then up to 350 miles (within the owner's deadhead) |
| 5 | Search backhauls toward the driver's home first. | Done | Loads toward the driver's home come first |
| 6 | Read every broker email blast and pull out each load. | Done | Broker emails read, each load pulled out |
| 7 | Read load lists in attached spreadsheets and PDFs. | To build | Spreadsheet/PDF load lists attached to emails aren't read yet |
| 8 | Read loads from broker texts. | To build | Brokers texting the dispatch number aren't read as load offers |
| 9 | Read loads from voicemails brokers leave. | Needs real accounts | Needs real broker voicemails to transcribe |
| 10 | Watch for repeat postings that mean a broker is struggling to cover. | Done | Reposts counted; ask goes up (judgment) |
| 11 | Spot the same load posted by two brokers and pick the better one. | Done | Same load from two brokers: the better one (judgment) |
| 12 | Ask favorite brokers directly for freight on a lane by email. | Done | Capacity emails to brokers who send freight from that state |
| 13 | Call favorite brokers when a truck is about to be empty. | To build | Only emails; no call to favorite brokers yet |
| 14 | Post empty trucks with the right date, place and equipment. | Done | Trucks posted once a day when the owner turns it on |
| 15 | Repost trucks when the plan changes. | Needs real accounts | Post refresh needs each board's update endpoint, which isn't public; not guessed |
| 16 | Take posts down the moment a truck is booked. | Needs real accounts | Post removal needs each board's delete endpoint, which isn't public; not guessed |
| 17 | Answer broker calls about posted trucks on the first ring. | Done | Broker calls about posted trucks reach the AI |
| 18 | Search for partial loads that fit leftover trailer space. | Done | Partials planned into trips |
| 19 | Search for power-only loads when the trailer is free. | To build | Power-only loads not matched |
| 20 | Keep a list of loads that almost fit, in case the plan changes. | To build | No "almost fits" list kept |

## 2. Choosing the right load (21–40)

| # | Item | Status | Note |
|---|---|---|---|
| 21 | Score each load by profit per hour, not just per mile. | Partly | Per-hour pay shown in the load's why (with dock hours); the choice still ranks by mile and net |
| 22 | Count empty miles to pickup at the real cost per mile. | Done | Empty miles costed in net profit |
| 23 | Count how hard it is to reload where the load delivers. | Done | Reload outlook where the load ends |
| 24 | Count dock wait time from history at that shipper. | Partly | Slow docks told to the driver, not counted in the choice |
| 25 | Count tolls on the route. | Partly | Toll estimate on loads; real tolls from statements |
| 26 | Count fuel at the carrier's real card price. | Done | Fuel plan at the card's price |
| 27 | Count weekend and holiday dead time. | Partly | Holidays flagged; weekend dead time not counted |
| 28 | Count the driver's hours left. | Done | Hours checked against the ELD |
| 29 | Count whether the driver makes home on time. | Done | Home time checked before every load |
| 30 | Skip loads the truck can't legally carry (weight, hazmat, height). | Done | Endorsements, weight and hazmat checked before dispatch |
| 31 | Skip loads that need gear the truck lacks (straps, tarps, load locks). | Done | Truck gear checked (judgment) |
| 32 | Skip brokers the owner blocked. | Done | Blocked brokers aren't booked |
| 33 | Prefer brokers who pay fast. | Partly | Slow payers priced up; fast payers not preferred in the choice |
| 34 | Prefer shippers with short dock times. | Partly | A slow dock is priced into the ask (+4%); not yet a tie-breaker in the choice |
| 35 | Compare two loads in a row against one long load. | Done | Plans compare back-to-back loads with long runs |
| 36 | Compare a load today against a better one tomorrow. | To build | No today-vs-tomorrow comparison |
| 37 | Explain in one line why it picked this load. | Done | Why-lines on every load |
| 38 | Show the runner-up and why it lost. | Done | Next-best offer named in the why |
| 39 | Never pick a load under the owner's lowest rate. | Done | Never under the owner's lowest |
| 40 | Learn which loads the owner would have picked instead. | Partly | Learns from approvals; not from which offer the owner picked |

## 3. Pricing and market knowledge (41–60)

| # | Item | Status | Note |
|---|---|---|---|
| 41 | Know the going rate for each lane today. | Needs real accounts | Built; needs a rate data account |
| 42 | Know whether rates on a lane are rising or falling this week. | Done | Lane trend from the carrier's own loads: 5%+ rising lanes ask 3% more |
| 43 | Know each broker's usual pay on each lane. | Done | Broker memory per lane |
| 44 | Know the carrier's own past pay on each lane. | Done | Lane history pricing |
| 45 | Know seasonal swings (produce, holidays, quarter end). | Needs real accounts | Needs a year of market data |
| 46 | Know which days of the week pay more on a lane. | Done | Weekday edge from the carrier's own loads: a day paying 8%+ more asks 4% more |
| 47 | Know reefer, flatbed and van gaps on the same lane. | Partly | Market by equipment when the rate service gives it |
| 48 | Price extra stops correctly. | Done | Extra stops priced |
| 49 | Price detention terms into the ask. | Partly | Detention terms asked for, not priced into the ask |
| 50 | Price slow-paying brokers higher. | Done | Slow payers asked more |
| 51 | Price weekend pickups higher. | Done | Weekend pickup premium |
| 52 | Price last-minute loads higher. | Done | Short-notice premium |
| 53 | Price headhaul and backhaul differently. | Partly | Reload outlook used in the choice, not the price |
| 54 | Price hazmat and high-value freight higher. | Done | Hazmat and high-value premium |
| 55 | Price team loads for team speed. | Done | Team premium |
| 56 | Price partial loads per foot of trailer. | Done | Partials priced by trailer share |
| 57 | Price deadhead pay on long empty runs. | Done | Long empty runs (150+ mi, over 40% of loaded) asked for as dollars on top |
| 58 | Track how often its first ask gets accepted. | Done | Ask learning tracks acceptance |
| 59 | Raise the first ask when it is accepted too easily. | Done | Raises the ask when taken too easily |
| 60 | Lower the first ask when it loses too many loads. | Done | Lowers it when it loses loads |

## 4. Negotiating by email (61–80)

| # | Item | Status | Note |
|---|---|---|---|
| 61 | Reply to a load email within a minute. | Done | Answered when the email arrives |
| 62 | Open with a number and one reason. | Done | One reason with the number |
| 63 | Counter with reasons the broker can check. | Done | Counters with reasons |
| 64 | Mention the truck's exact location and empty time. | Done | Truck location in the ask |
| 65 | Mention the carrier's on-time record with that broker. | Done | Carrier's record in the ask |
| 66 | Ask for the detention and layover terms before agreeing. | Done | Detention and TONU asked for in writing |
| 67 | Ask for the appointment times before agreeing. | Partly | Asked on calls; not in email asks |
| 68 | Ask for the commodity and weight before agreeing. | Partly | Asked on calls; not in email asks |
| 69 | Walk away politely and leave the door open. | Done | Walks away politely |
| 70 | Come back when the broker reposts at a higher rate. | Done | Comes back when reposted higher |
| 71 | Stop after a set number of rounds. | Done | Three counters at most |
| 72 | Match the broker's tone (short or friendly). | To build | Doesn't match the broker's tone |
| 73 | Write in the broker's language. | Done | Broker's language |
| 74 | Answer every broker question in the same email. | Done | Answers questions in the same email |
| 75 | Never promise what the truck can't do. | Done | Never promises a truck the data doesn't show |
| 76 | Confirm the agreed number in writing. | Done | Confirms in writing |
| 77 | Catch a broker changing the number in a later email. | Done | Rate con checked against what was agreed |
| 78 | Handle several brokers bidding for the same truck. | Partly | Fleet matching picks one; several bids on one truck not compared |
| 79 | Pick the best offer and decline the rest politely. | Partly | Others set aside; no polite decline sent |
| 80 | Keep the whole email thread on the load. | Done | Thread kept on the load |

## 5. Negotiating by phone (81–100)

| # | Item | Status | Note |
|---|---|---|---|
| 81 | Call within a minute of a good posting. | Done | Calls right away on board loads for empty trucks |
| 82 | Get through broker phone menus. | Done | Phone menus |
| 83 | Wait on hold and keep the line open. | Done | Hold |
| 84 | Ask for the right person by name. | Done | Broker calls open by asking for the rep by name |
| 85 | Say who it is calling for and that it's an AI. | Done | Says who it calls for and that it's an AI |
| 86 | Ask "is it still available?" first. | Done | Asks if it's still available |
| 87 | Ask what the broker is paying before naming a number. | Done | Asks what they pay first |
| 88 | Understand rates said per mile or all-in. | Done | Per mile or all in |
| 89 | Counter in natural speech. | Done | Counters in speech |
| 90 | Handle being talked over without losing the thread. | Needs real accounts | Needs real calls |
| 91 | Understand thick accents and bad cell signals. | Needs real accounts | Needs real calls |
| 92 | Leave a short voicemail when nobody answers. | Done | Voicemail |
| 93 | Call back when the broker said "call me in ten." | Done | "Call me back in ten" scheduled and called back |
| 94 | Recap the agreement before hanging up. | Partly | Recaps on booking; not always |
| 95 | Ask the broker to email the rate con right away. | Done | Asks for the rate con |
| 96 | Hand the call to the owner on request. | Done | Owner can join |
| 97 | Let the owner listen in live. | Partly | Owner joins; no listen-only |
| 98 | Record and summarize every call. | Done | Recorded and summarized |
| 99 | Notice when a broker refuses to deal with an AI and switch to email. | Done | Switches to email |
| 100 | Never agree to anything the rules don't allow, even under pressure. | Done | Rules can't be talked past |

## 6. Booking and rate cons (101–120)

| # | Item | Status | Note |
|---|---|---|---|
| 101 | Read every rate con the moment it arrives. | Done | Read on arrival |
| 102 | Check the rate against what was agreed. | Done | Rate checked |
| 103 | Check the detention terms against what was agreed. | Done | Detention checked |
| 104 | Check the appointment times against what was agreed. | Done | Appointments checked |
| 105 | Check the MC number against the broker booked with. | Done | MC checked |
| 106 | Check fines and penalties in the fine print. | Done | Fines read |
| 107 | Ask for a corrected rate con when something is off. | Done | Corrected rate con asked for |
| 108 | Sign and return a clean rate con. | Done | Signed and returned |
| 109 | Sign through DocuSign and broker portals. | Needs real accounts | Built; needs real sites to prove |
| 110 | Save the signed copy on the load. | Done | Signed copy kept |
| 111 | Pull pickup and delivery numbers from the rate con. | Done | Numbers pulled |
| 112 | Pull dock addresses from the rate con. | Done | Addresses pulled |
| 113 | Pull special instructions (PPE, no-touch, appointments). | Done | Instructions pulled |
| 114 | Pull the broker's tracking app requirement. | Done | Tracking app pulled |
| 115 | Pull the commodity, weight and pieces. | Done | Commodity, weight, pieces |
| 116 | Pull the reefer temperature setting. | Done | Reefer setting |
| 117 | Flag a rate con that arrives from the wrong company. | Done | Wrong company held |
| 118 | Flag a rate con with a different load number. | Done | Another load number held |
| 119 | Flag a rate con for a load nobody agreed to. | Done | Unknown load reported |
| 120 | Book only after the rate con checks out. | Done | Booked only on a matching rate con |

## 7. Planning the week (121–140)

| # | Item | Status | Note |
|---|---|---|---|
| 121 | Plan two or three loads ahead for each truck. | Done | Up to three loads ahead |
| 122 | Plan the whole fleet together so trucks don't compete. | Done | Fleet planned together |
| 123 | Give the best load to the truck it fits best. | Done | Best truck per load |
| 124 | Re-plan when one load falls through. | Done | Rebooks when one falls through |
| 125 | Re-plan when a truck runs late. | Partly | Late notices; plan not rebuilt |
| 126 | Re-plan when a driver asks for time off. | Partly | Time off noted; plan not rebuilt |
| 127 | Line up the reload before delivery. | Done | Reload lined up before delivery |
| 128 | Chain loads to finish near home on home day. | Done | Ends near home on home day |
| 129 | Avoid sending a truck into a dead market on Friday. | Partly | Reload outlook; Friday not special |
| 130 | Reposition empty trucks toward strong markets. | Done | Repositions empty trucks |
| 131 | Pay attention to the 70-hour clock across the week. | Done | 70-hour clock |
| 132 | Plan the 34-hour restart at home or a good spot. | Partly | 34-hour restart planned, not where |
| 133 | Plan fuel stops into the week's plan. | Done | Fuel stops planned |
| 134 | Plan maintenance into slow days. | Done | Service due and the truck's next free day in the reminders |
| 135 | Plan inspections before they expire. | Done | Inspection reminders |
| 136 | Show the week's plan as one simple timeline per truck. | Partly | Plan lines and lineup; no timeline view |
| 137 | Let the owner lock a load into the plan. | To build | Owner can't lock a load into the plan |
| 138 | Let the owner block a day for a truck. | Done | Owner blocks days per truck on the Fleet page; loads running into them are skipped |
| 139 | Show expected weekly revenue per truck. | Partly | This week's money per truck, not expected |
| 140 | Show expected weekly empty miles per truck. | Partly | Empty miles this week, not expected |

## 8. Hours of service and availability (141–160)

| # | Item | Status | Note |
|---|---|---|---|
| 141 | Read hours from the ELD every round. | Done | Hours read every round |
| 142 | Know the 11-hour, 14-hour and 70-hour clocks. | Done | 11, 14 and 70 |
| 143 | Know the 30-minute break rule. | Done | 30-minute break in trip timing |
| 144 | Know split sleeper rules. | Done | Split sleeper |
| 145 | Know short-haul exemptions. | Done | Short-haul exception in the AI's hours knowledge |
| 146 | Know adverse driving conditions extensions. | Done | Adverse driving extension in the AI's hours knowledge |
| 147 | Know personal conveyance rules. | Done | Personal conveyance in the AI's hours knowledge |
| 148 | Know yard move rules. | Done | Yard moves in the AI's hours knowledge |
| 149 | Plan the 10-hour break location in advance. | Partly | Parking near where hours run out |
| 150 | Find truck parking near where hours run out. | Done | Parking found |
| 151 | Book truck parking when the driver asks. | Done | Parking booked when asked |
| 152 | Warn the driver before hours run out. | Done | Hours warnings |
| 153 | Warn the broker when hours will make the truck late. | Done | Broker told when hours make it late |
| 154 | Never book a load the driver can't legally make. | Done | Never books what can't be legally run |
| 155 | Account for real dock time from history. | Done | Dock time from history |
| 156 | Account for traffic in big cities. | Done | Traffic (HERE) |
| 157 | Account for weather slowdowns. | Done | Weather |
| 158 | Account for mountain grades. | Done | Mountain passes on the lane named in the driver's text, with chain laws Oct-Apr |
| 159 | Account for team drivers' combined hours. | Done | Team hours |
| 160 | Keep a log of every hours decision for audits. | Done | Driver's clocks at booking and what the load needs, on the load's timeline |

## 9. Home time and driver preferences (161–180)

| # | Item | Status | Note |
|---|---|---|---|
| 161 | Know each driver's home day. | Done | Home day |
| 162 | Know each driver's home base. | Done | Home base |
| 163 | Know states each driver won't go to. | Done | States avoided |
| 164 | Know cities each driver avoids (NYC, LA). | Done | Cities avoided |
| 165 | Know docks each driver dislikes. | To build | Docks a driver dislikes not kept |
| 166 | Know drivers who won't do touch freight. | Done | No touch freight |
| 167 | Know drivers who won't haul hazmat. | Done | Hazmat by endorsement |
| 168 | Know preferred run lengths per driver. | Done | Run types |
| 169 | Know preferred start times per driver. | Done | Driver's earliest pickup kept (said in a text or set on the profile) |
| 170 | Know religious and family days off. | Partly | Time off and remembered notes |
| 171 | Ask drivers new preferences in plain conversation. | Done | Asked and remembered in conversation |
| 172 | Remember preferences said in passing. | Done | Said in passing (remember, preferences) |
| 173 | Balance good loads fairly across drivers. | Partly | Split shown; not balanced in the choice |
| 174 | Track promised home time and keep it. | Done | Home time tracked |
| 175 | Tell the driver early if home time is at risk. | Partly | Owner told; driver not told early |
| 176 | Offer the driver a choice when two loads are close. | Done | Driver can pick between offers |
| 177 | Respect "no calls before 6 am." | Done | No calls before |
| 178 | Respect "text only" drivers. | Done | Text-only drivers |
| 179 | Respect quiet days after long weeks. | To build | No quiet day after a long week |
| 180 | Track how often each driver's wishes were met. | To build | Wishes met not tracked |

## 10. Dispatching the driver (181–200)

| # | Item | Status | Note |
|---|---|---|---|
| 181 | Send the load details the moment it's booked. | Done | Sent when booked |
| 182 | Send it in the driver's language. | Done | In their language |
| 183 | Send the pickup and delivery numbers. | Done | Pickup and delivery numbers |
| 184 | Send the dock address to the truck GPS app. | Done | Address to the truck GPS |
| 185 | Send the appointment times in the dock's time zone. | Done | Dock's time zone |
| 186 | Send special instructions in plain words. | Done | Instructions in plain words |
| 187 | Send the tracking app setup steps. | Done | Tracking app steps |
| 188 | Call the driver for loads that need a yes. | Done | Calls for loads |
| 189 | Accept a yes or no by text, call or app tap. | Done | Yes or no any way |
| 190 | Re-offer the load to another driver after a no. | To build | Not re-offered to another driver after a no |
| 191 | Confirm the driver has the paperwork before leaving. | Partly | Papers on the phone; not checked before leaving |
| 192 | Remind the driver of the pre-trip inspection. | Done | Pre-trip |
| 193 | Remind the driver to scale heavy loads. | Done | Scale step |
| 194 | Remind the driver to check the seal. | Partly | Seal recorded; no reminder |
| 195 | Remind the driver to get the BOL signed. | Done | BOL |
| 196 | Remind the driver to take load photos. | Done | Load photos |
| 197 | Remind the driver of the reefer temperature. | Done | Reefer setting |
| 198 | Send the next load before the current one delivers. | Done | Next load before delivery |
| 199 | Send a morning brief with the day's stops. | Done | Morning brief |
| 200 | Send an end-of-day note with tomorrow's plan. | Done | Evening text before a pickup day: where, when, how far, when to leave, the break |

## 11. Appointments and docks (201–220)

| # | Item | Status | Note |
|---|---|---|---|
| 201 | Book pickup appointments by phone. | Done | Pickup appointments by phone |
| 202 | Book delivery appointments by phone. | Done | Delivery appointments by phone |
| 203 | Book appointments in dock scheduling websites. | Needs real accounts | Built; needs real sites |
| 204 | Move appointments when the truck runs late. | Done | Moved when late |
| 205 | Ask for work-ins when the truck is early. | To build | No work-in asks when early |
| 206 | Confirm appointments the day before. | To build | No day-before confirmation |
| 207 | Know each dock's real hours. | Done | Dock hours |
| 208 | Know each dock's holiday closures. | Done | Holidays |
| 209 | Know docks that need appointments and those that don't. | Partly | Appointment needed read off the rate con |
| 210 | Know docks that make trucks wait overnight. | Partly | Slow docks known |
| 211 | Know docks with lumper fees. | Partly | Lumpers paid; docks not marked |
| 212 | Know docks with parking on site. | Partly | Dock tips |
| 213 | Know docks with check-in rules (PPE, ID). | Done | Check-in rules in tips |
| 214 | Know docks that load on a first come, first served basis. | Partly | FCFS read off the rate con |
| 215 | Collect dock tips from drivers after each visit. | Done | Tips collected |
| 216 | Share dock tips with the next driver going there. | Done | Tips shared |
| 217 | Track average wait time per dock. | Done | Wait per dock |
| 218 | Warn the owner about slow docks before booking. | Partly | Driver told; owner not before booking |
| 219 | Charge more for slow docks. | Done | Slow docks priced into the ask |
| 220 | Keep a dock directory per carrier. | Partly | Facility memory; no directory page |

## 12. Tracking and check calls (221–240)

| # | Item | Status | Note |
|---|---|---|---|
| 221 | Follow every truck on the ELD. | Done | ELD |
| 222 | Update the broker's tracking app. | Done | Broker tracking apps |
| 223 | Send check-call emails on the broker's schedule. | Done | Check-call emails |
| 224 | Answer "where's my truck?" in under a minute. | Done | Where's my truck |
| 225 | Send arrival and departure times to the broker. | Partly | Late notices; no arrival/departure notes |
| 226 | Send an ETA that uses traffic and hours. | Done | ETA with traffic and hours |
| 227 | Send a tracking link brokers can open without signing in. | Done | Tracking link |
| 228 | Text the driver only when the ELD can't answer. | Done | Texts only when needed |
| 229 | Notice when a truck stops in the wrong place. | Done | Stopped in the wrong place |
| 230 | Notice when a truck goes the wrong way. | Done | With an ELD, a truck getting 10+ miles farther from its stop gets a text |
| 231 | Notice when the ELD stops reporting. | Done | ELD quiet |
| 232 | Ask the driver for a location when GPS is missing. | Done | Asks the driver |
| 233 | Confirm pickup with the BOL photo. | Done | BOL photo |
| 234 | Confirm delivery with the POD photo. | Done | POD photo |
| 235 | Keep a full timeline on each load. | Done | Timeline |
| 236 | Show the broker only what they need. | Done | Broker sees only what they need |
| 237 | Show the owner everything in one line per truck. | Done | One line per truck |
| 238 | Stop updates after delivery. | Done | Stops after delivery |
| 239 | Learn each broker's preferred update style. | To build | Broker update style not learned |
| 240 | Never send a location without the driver being on duty. | Done | Only on duty |

## 13. Delays and exceptions (241–260)

| # | Item | Status | Note |
|---|---|---|---|
| 241 | Spot a late truck hours ahead. | Done | Late seen early |
| 242 | Tell the broker before they have to ask. | Done | Broker told first |
| 243 | Offer the broker a new arrival time. | Done | New time offered |
| 244 | Ask the dock to move the appointment. | Done | Dock asked to move |
| 245 | Tell the driver the new plan. | Done | Driver told |
| 246 | Tell the owner only when it costs money. | Partly | Owner told; not only when it costs money |
| 247 | Handle shipper not ready. | Partly | Detention covers it; no shipper-not-ready path |
| 248 | Handle receiver refusing the load. | Done | Receiver refusing: broker asked for instructions in writing, driver told to hold and note the BOL |
| 249 | Handle short or damaged freight. | Done | Shortage and damage |
| 250 | Handle wrong freight loaded. | Done | Wrong freight at pickup: broker asked to confirm, driver told not to sign for it |
| 251 | Handle overweight loads. | Partly | Scale checks; no overweight path |
| 252 | Handle reefer temperature problems. | Done | Reefer readings |
| 253 | Handle a cancelled load and claim TONU. | Done | Cancellations and TONU |
| 254 | Handle a load added at the last minute. | Partly | Loads added; no last-minute path |
| 255 | Handle an extra stop the broker asks for. | Done | Extra stop |
| 256 | Handle a reroute the broker asks for. | Done | Reroute |
| 257 | Handle road closures. | Partly | Weather; no closures |
| 258 | Handle snow and ice. | Done | Snow and ice warnings |
| 259 | Handle holidays that close docks. | Done | Holidays |
| 260 | Write down every exception for billing and learning. | Partly | Activity log; no exception record |

## 14. Breakdowns and emergencies (261–280)

| # | Item | Status | Note |
|---|---|---|---|
| 261 | Ask the driver what's wrong in plain words. | Done | Asked in plain words |
| 262 | Find the nearest truck repair shop that's open. | Done | Shops found |
| 263 | Find mobile repair for tires and small fixes. | Partly | Tire service searched; no mobile repair search |
| 264 | Find towing for heavy trucks. | Done | Towing |
| 265 | Call shops for price and time. | Done | Price asked |
| 266 | Check the warranty or roadside plan first. | Done | The carrier's roadside plan or warranty number goes to the driver first |
| 267 | Tell the broker about the delay with a new time. | Done | Broker told |
| 268 | Ask the broker about recovering the load if it's long. | Done | A long breakdown: the broker told the load won't move soon and offered a repower |
| 269 | Find another truck to recover the load. | Done | Closest free truck of the same type (300 mi) offered to the owner as a repower |
| 270 | Book a hotel for the driver if needed. | Done | Two hotels with truck room near the driver, in the evening or overnight |
| 271 | Track repair cost against the owner's limit. | Done | Repair limit |
| 272 | Ask the owner before big repairs. | Done | Owner asked over the limit |
| 273 | Call 911 guidance for accidents. | Done | 911 first |
| 274 | Alert the owner and support on accidents. | Done | Owner and support told |
| 275 | Collect accident photos and a police report number. | Partly | Claims paperwork; no police report number |
| 276 | Start the insurance claim. | Partly | Owner files with the insurer |
| 277 | Handle cargo theft reports. | Done | Theft: emergency to support, broker told, claim file started, driver told 911 and police report |
| 278 | Handle driver illness on the road. | Partly | Support; no illness path |
| 279 | Handle a driver who stops answering. | Done | Calls and the owner |
| 280 | Log every emergency step for the record. | Partly | Activity log |

## 15. Detention, layover, extras (281–300)

| # | Item | Status | Note |
|---|---|---|---|
| 281 | Start the detention clock from the ELD arrival time. | Done | ELD arrival |
| 282 | Tell the broker when free time runs out. | Done | Broker told when free time runs out with the truck still at the dock |
| 283 | Ask for detention approval in writing. | Partly | Claims sent; no approval asked |
| 284 | Bill detention with ELD times as proof. | Done | ELD times as proof |
| 285 | Claim layover when the truck is held overnight. | Done | Layover |
| 286 | Claim TONU on cancellations. | Done | TONU |
| 287 | Claim lumper reimbursement with the receipt. | Done | Lumper |
| 288 | Claim extra stop pay. | Done | Extra stop pay |
| 289 | Claim driver assist pay. | Done | Driver assist claimed at the rate con's or owner's price |
| 290 | Claim tarp pay. | Done | Tarping claimed at the rate con's or owner's price |
| 291 | Claim reefer fuel where the contract allows. | Done | Reefer fuel claimed from the receipt |
| 292 | Claim scale ticket fees. | Done | Scale tickets claimed from the receipt |
| 293 | Claim truck order not used fees. | Done | TONU |
| 294 | Claim redelivery fees. | Done | Redelivery claimed at the rate con's or owner's price |
| 295 | Claim out-of-route miles. | Done | Out-of-route miles claimed at the rate con's or the load's own rate a mile |
| 296 | Follow up on unpaid extras. | Partly | Invoices followed up; extras not separately |
| 297 | Track which brokers pay extras. | Partly | Detention paid % per broker |
| 298 | Price slow payers of extras higher next time. | To build | Slow payers of extras not priced |
| 299 | Share extras with drivers on their pay. | Done | Driver's share of extra pay for their work on the pay run |
| 300 | Show the owner how much extra money it recovered. | Done | Report card extras |

## 16. Paperwork and billing handoff (301–320)

| # | Item | Status | Note |
|---|---|---|---|
| 301 | Check the BOL for signatures. | Done | BOL checked |
| 302 | Check the POD for shortages or damage notes. | Done | POD checked |
| 303 | Ask the driver to retake bad photos. | Done | Retake asked |
| 304 | Build the invoice packet automatically. | Done | Packet built |
| 305 | Send the invoice to the broker the day it delivers. | Done | Same day |
| 306 | Send the packet to the factoring company. | Done | Factoring |
| 307 | Upload to broker portals that require it. | Needs real accounts | Built; needs real portals |
| 308 | Follow up on unpaid invoices. | Done | Follow-ups |
| 309 | Call about invoices over 30 days. | To build | No call about 30-day invoices |
| 310 | Match payments to invoices. | Done | Payments matched |
| 311 | Flag short pays with reasons. | Done | Short pays |
| 312 | Dispute short pays with proof. | Partly | Asked; no proof sent |
| 313 | Track quick pay offers. | To build | Quick pay not tracked |
| 314 | Put invoices in QuickBooks or Xero. | Done | QuickBooks and Xero |
| 315 | Track driver expenses per load. | Done | Driver expenses |
| 316 | Build driver pay runs. | Done | Pay runs |
| 317 | Send pay statements. | Done | Statements |
| 318 | Prepare IFTA miles and gallons. | Done | IFTA |
| 319 | Keep every paper on the load for audits. | Done | Papers kept |
| 320 | Send setup packets to new brokers. | Done | Setup packets |

## 17. Broker relationships (321–340)

| # | Item | Status | Note |
|---|---|---|---|
| 321 | Remember every broker rep by name. | Done | Reps by name |
| 322 | Remember who answers fast. | Partly | Response time known |
| 323 | Remember who pays fast. | Done | Pays fast |
| 324 | Remember who pays detention. | Done | Detention paid |
| 325 | Remember who cancels loads. | Done | Cancellations |
| 326 | Remember each rep's lanes. | Partly | Lanes per broker |
| 327 | Thank brokers after good loads. | Partly | Thanks on the rate con |
| 328 | Ask good brokers for repeat freight. | Done | Asks for reloads |
| 329 | Offer capacity to good brokers first. | Done | Capacity to good brokers |
| 330 | Rate each broker after each load. | Partly | Scorecards |
| 331 | Drop brokers with bad records. | Partly | Owner blocks; not automatic |
| 332 | Warn the owner about brokers on watch. | Partly | Credit and checks |
| 333 | Keep notes per broker. | To build | No notes per broker |
| 334 | Keep contacts per broker (several reps). | To build | One contact per broker |
| 335 | Notice when a broker's contact details change. | Done | Contact changes held |
| 336 | Check broker authority before every booking. | Done | Authority |
| 337 | Check broker credit before every booking. | Done | Credit |
| 338 | Get set up with new brokers fast. | Done | Setup fast |
| 339 | Keep setup profiles current on carrier networks. | Partly | Profiles linked |
| 340 | Build dedicated lanes with the best brokers. | Partly | Contract lanes |

## 18. Direct shippers (341–360)

| # | Item | Status | Note |
|---|---|---|---|
| 341 | Handle direct shipper orders by email. | Partly | Shippers' emails read like brokers' |
| 342 | Handle contract lanes on a schedule. | Done | Contract lanes |
| 343 | Make loads from contract lanes a week ahead. | Done | Loads made ahead |
| 344 | Send shippers tracking links. | Done | Tracking links |
| 345 | Send shippers PODs. | Done | PODs |
| 346 | Send shippers invoices on their terms. | Partly | Terms kept |
| 347 | Follow up on shipper payments. | Done | Payment follow-up |
| 348 | Send shippers a weekly summary. | To build | No weekly summary to shippers |
| 349 | Ask shippers for more lanes. | To build | No ask for more lanes |
| 350 | Quote new lanes for shippers. | To build | No lane quotes |
| 351 | Handle shipper appointment changes. | Partly | Appointment changes |
| 352 | Handle shipper complaints. | To build | No complaint handling |
| 353 | Track on-time percentage per shipper. | To build | No on-time per shipper |
| 354 | Track profit per shipper. | Partly | Lanes and customers pages |
| 355 | Keep shipper contacts. | Done | Contacts |
| 356 | Keep shipper dock rules. | Partly | Dock tips |
| 357 | Fill empty backhauls from shipper lanes. | Partly | Contract loads |
| 358 | Warn the owner when a contract lane loses money. | To build | No warning when a contract lane loses money |
| 359 | Renew contract rates on time. | To build | No contract renewal reminder |
| 360 | Give shippers their own page. | Done | Shipper page |

## 19. Driver communication and care (361–380)

| # | Item | Status | Note |
|---|---|---|---|
| 361 | Talk to each driver in their language. | Done | Language |
| 362 | Use the driver's name and a friendly tone. | Done | Name and tone |
| 363 | Answer driver questions any hour. | Done | Any hour |
| 364 | Answer pay questions from the pay records. | Done | Pay answers |
| 365 | Answer load questions from the rate con. | Done | Load answers |
| 366 | Answer route questions from the truck GPS route. | Partly | Route from the trip map |
| 367 | Send voice answers to voice messages. | Done | Voice replies |
| 368 | Notice tired or upset drivers. | Done | Mood |
| 369 | Tell the owner when a driver may quit. | Done | Owner told |
| 370 | Check in weekly with each driver. | Done | Weekly check-in |
| 371 | Celebrate milestones (safe miles, anniversaries). | To build | No milestones |
| 372 | Remember family events drivers mention. | Done | Remembers |
| 373 | Keep promises made to drivers. | Partly | Notes; no promise tracking |
| 374 | Explain why a load was chosen. | Partly | Why on the load; not to the driver |
| 375 | Accept driver pushback and re-plan. | Partly | Pushback goes to the AI |
| 376 | Pass driver ideas to the owner. | To build | Driver ideas not passed on |
| 377 | Keep driver messages private from other drivers. | Done | Private threads |
| 378 | Respect driver rest time. | Done | Rest respected |
| 379 | Help new drivers with the app on day one. | Done | First day |
| 380 | Track driver happiness over time. | Partly | Mood kept per check-in |

## 20. Owner communication and trust (381–400)

| # | Item | Status | Note |
|---|---|---|---|
| 381 | Send a short daily summary. | Done | Evening text |
| 382 | Send a weekly review with one thing to change. | Done | Weekly review |
| 383 | Ask the owner only when it really matters. | Done | Asks only when it matters |
| 384 | Explain every money decision in one line. | Done | Why-lines |
| 385 | Show what it did while the owner was away. | Done | While you were away |
| 386 | Let the owner approve from a notification. | Done | Answer from notification |
| 387 | Let the owner undo a decision for a few seconds. | Done | Undo |
| 388 | Learn from every owner approval and refusal. | Done | Learns from approvals |
| 389 | Turn repeated owner answers into rules. | Done | Rules from repeated answers |
| 390 | Tell the owner about risks before they happen. | Partly | Deadlines and late risks |
| 391 | Tell the owner about good news (a big load booked). | Partly | Activity; no good-news push |
| 392 | Speak to the owner in their language. | Partly | Owner's language partly |
| 393 | Answer the owner's questions about any load. | Done | Load questions |
| 394 | Answer the owner's questions about money. | Done | Money questions |
| 395 | Answer the owner's questions about drivers. | Done | Driver questions |
| 396 | Let the owner call the AI and talk it through. | Done | Owner calls |
| 397 | Let the owner set goals (revenue, home time). | Partly | Weekly revenue goal; no home-time goal |
| 398 | Report progress against those goals. | Done | Report card against the goal |
| 399 | Admit mistakes and say what it changed. | To build | Doesn't admit mistakes |
| 400 | Show a clear log of everything it did. | Done | Activity and changes log |

## 21. Learning and memory (401–420)

| # | Item | Status | Note |
|---|---|---|---|
| 401 | Remember every load the carrier ever ran. | Done | Every load kept |
| 402 | Learn rates from the carrier's history. | Done | Rates from history |
| 403 | Learn dock times from the carrier's history. | Done | Dock times |
| 404 | Learn broker behavior from the carrier's history. | Done | Broker behavior |
| 405 | Learn driver habits from the carrier's history. | Partly | Run types and notes |
| 406 | Learn from loads it lost to other carriers. | Partly | Ask learning |
| 407 | Learn from loads it won too cheaply. | Done | Won too cheaply |
| 408 | Learn from late deliveries. | Partly | Late deliveries counted |
| 409 | Learn from owner overrides. | Done | Owner overrides |
| 410 | Learn from driver complaints. | Partly | Mood and feedback |
| 411 | Learn from broker complaints. | To build | Broker complaints not learned |
| 412 | Share anonymous lane rates across carriers (with permission). | Needs people | Needs carriers' permission |
| 413 | Share anonymous dock times across carriers. | Done | Dock times shared |
| 414 | Share anonymous broker pay times across carriers. | Needs people | Needs carriers' permission |
| 415 | Forget data the owner asks it to forget. | Partly | Account deletion; no single forget |
| 416 | Keep memory per carrier separate. | Done | Per carrier |
| 417 | Show the owner what it learned this week. | Partly | Weekly review |
| 418 | Let the owner correct what it learned. | To build | Owner can't correct what it learned |
| 419 | Test new strategies on a small share of loads. | To build | No strategy tests |
| 420 | Keep the strategies that make more money. | To build | No strategy keeping |

## 22. Fraud and risk (421–440)

| # | Item | Status | Note |
|---|---|---|---|
| 421 | Catch double brokering from the rate con MC. | Done | Double brokering |
| 422 | Catch lookalike email domains. | Done | Lookalike domains |
| 423 | Catch requests to change bank details. | Done | Bank change requests |
| 424 | Catch fake broker phone numbers. | To build | Phone numbers not checked |
| 425 | Catch brokers with new authority. | Needs real accounts | Needs authority dates from FMCSA |
| 426 | Catch brokers with authority changes. | Partly | Re-checked on use |
| 427 | Catch loads that are too good to be true. | Done | Too good to be true |
| 428 | Catch freight scams (fictitious pickups). | Partly | Fee scams; fictitious pickups not |
| 429 | Catch cargo theft patterns (high-value, unusual drops). | To build | No theft patterns |
| 430 | Catch identity theft of the carrier's MC. | Needs real accounts | Needs FMCSA monitoring |
| 431 | Catch fake rate cons. | Partly | Rate con checks |
| 432 | Catch fake PODs. | Partly | POD checks |
| 433 | Hold suspicious loads and ask the owner. | Done | Held for the owner |
| 434 | Verify brokers by calling their listed number. | To build | No call to the listed number |
| 435 | Check fraud lists daily. | Needs real accounts | Needs a fraud list service |
| 436 | Never send carrier bank details by email. | Done | Never by email |
| 437 | Never change pay details without the owner. | Done | Never without the owner |
| 438 | Log every fraud check on the load. | Partly | Broker check noted |
| 439 | Share fraud warnings across carriers (anonymous). | Needs people | Needs carriers' permission |
| 440 | Teach the owner about new scams. | To build | No scam lessons |

## 23. Autonomy, rules and safety rails (441–460)

| # | Item | Status | Note |
|---|---|---|---|
| 441 | Let the owner set how much it does alone. | Done | Autopilot |
| 442 | Let the owner set a lowest rate. | Done | Lowest rate |
| 443 | Let the owner set the most empty miles. | Done | Empty miles |
| 444 | Let the owner set brokers to avoid. | Done | Brokers to avoid |
| 445 | Let the owner set lanes to avoid. | Done | Lanes the carrier won't run, in Settings |
| 446 | Let the owner set a spending limit for repairs. | Done | Repair limit |
| 447 | Let the owner set rules in plain words. | Partly | Teach on each load |
| 448 | Never break a rule, even if a broker pushes. | Done | Rules hold |
| 449 | Ask before anything new it hasn't done before. | Partly | New brokers checked |
| 450 | Ask before anything over a money limit. | Done | Lowest rate |
| 451 | Ask before anything with legal risk. | Partly | Claims ask first |
| 452 | Stop all actions with one owner switch. | Done | Pause |
| 453 | Practice mode where nothing is sent. | Done | Practice mode |
| 454 | Shadow mode where it suggests and the owner acts. | Done | Within my rules |
| 455 | Full mode where it acts and reports. | Done | Full autopilot |
| 456 | Show the current mode clearly. | Done | Shown |
| 457 | Hand off to human support for emergencies. | Done | Support for emergencies |
| 458 | Hand off to human support for broker portals it can't handle. | Done | Support for portals |
| 459 | Keep a limit on calls and texts per day. | To build | No daily contact limit |
| 460 | Keep a limit on AI cost per carrier. | Partly | Cost counted, not capped |

## 24. Languages and voice quality (461–480)

| # | Item | Status | Note |
|---|---|---|---|
| 461 | Speak English, Spanish, Punjabi, Hindi, Russian, Ukrainian and French. | Done | Seven languages |
| 462 | Add Portuguese. | Needs people | Needs native speakers |
| 463 | Add Romanian. | Needs people | Needs native speakers |
| 464 | Add Serbian and Bosnian. | Needs people | Needs native speakers |
| 465 | Add Somali. | Needs people | Needs native speakers |
| 466 | Add Amharic. | Needs people | Needs native speakers |
| 467 | Add Arabic. | Needs people | Needs native speakers |
| 468 | Add Vietnamese. | Needs people | Needs native speakers |
| 469 | Switch languages mid-call when the driver does. | Needs real accounts | Needs real calls |
| 470 | Use natural voices per language. | Needs real accounts | Needs voice accounts |
| 471 | Use trucking words drivers actually use. | Done | Trucking words |
| 472 | Understand CB-style slang. | Done | CB slang |
| 473 | Understand numbers said in any language. | Partly | Numbers in some languages |
| 474 | Understand addresses said aloud. | Partly | Addresses read on calls |
| 475 | Answer faster on calls (under a second). | Needs real accounts | Needs real calls |
| 476 | Handle background road noise. | Needs real accounts | Needs real calls |
| 477 | Handle bad cell signals with patience. | Needs real accounts | Needs real calls |
| 478 | Read back numbers to confirm them. | Done | Numbers read back on calls |
| 479 | Spell names and numbers when asked. | Done | Names and numbers spelled on request |
| 480 | Have native speakers review every language. | Needs people | Needs native speakers |

## 25. Measuring the AI against a human dispatcher (481–500)

| # | Item | Status | Note |
|---|---|---|---|
| 481 | Track revenue per truck per week. | Done | Revenue per truck |
| 482 | Track empty mile percentage. | Done | Empty miles |
| 483 | Track rate per mile against market. | Done | Against market |
| 484 | Track on-time pickups and deliveries. | Done | On time |
| 485 | Track time from empty to booked. | To build | Empty to booked not tracked |
| 486 | Track loads booked per hour of AI work. | To build | Loads per hour of AI work |
| 487 | Track owner time saved. | To build | Owner time saved |
| 488 | Track driver satisfaction. | Partly | Mood |
| 489 | Track broker satisfaction. | To build | Broker satisfaction |
| 490 | Track extras recovered. | Done | Extras |
| 491 | Track invoices paid on time. | Partly | Days to get paid |
| 492 | Track mistakes and fixes. | To build | Mistakes not tracked |
| 493 | Compare each week with the carrier's past dispatcher. | Partly | Before Backroute rate |
| 494 | Compare with human dispatchers on the same lanes. | Needs real accounts | Needs human dispatchers' numbers |
| 495 | Run a simulated week before each new version. | Done | Simulated week |
| 496 | Score calls for sounding human. | Needs real accounts | Needs the real AI and calls |
| 497 | Score emails for being short and clear. | Partly | Short emails by template |
| 498 | Publish a monthly report card to the owner. | Partly | On screen, not sent monthly |
| 499 | Set targets the AI must beat before full mode. | Done | Readiness marks |
| 500 | Keep improving until it beats a good human dispatcher on every number. | Needs real accounts | Needs real loads over time |
