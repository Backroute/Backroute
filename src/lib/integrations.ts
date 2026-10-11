/**
 * Everything a carrier connects Backroute to, in one place: what each one does for them, how it connects, and the
 * steps. Each entry's `flow` says which setup panel it opens. Nothing here claims a connection that isn't real:
 * services without an API Backroute can sign into show "Ask us to connect it", which goes to Backroute's support team.
 */

export type HubFlow =
  | { type: "eld_key"; kind: "samsara" | "motive" }
  | { type: "geotab" }
  | { type: "email" }
  | { type: "quickbooks" }
  | { type: "xero" }
  | { type: "dat" }
  | { type: "truckstop" }
  | { type: "custom_board" }
  | { type: "load_feed" }
  | { type: "statement"; kind: "fuel_feed" | "toll_feed" }
  | { type: "factoring" }
  | { type: "payouts" }
  | { type: "exports" }
  | { type: "portals" }
  | { type: "phone" }
  | { type: "builtin"; href?: string; hrefLabel?: string }
  | { type: "request" };

export interface HubEntry {
  id: string;
  name: string;
  category: HubCategory;
  /** One line: what it does for the carrier. */
  does: string;
  /** What Backroute does with it, once it's connected. */
  gets: string[];
  /** How it connects, in a few words ("Sign in with Google", "API key from Samsara"). */
  how: string;
  /** The steps, in order. */
  steps: string[];
  flow: HubFlow;
  /** Words people search with besides the name. */
  keywords?: string;
}

export type HubCategory =
  | "Email"
  | "ELD & GPS"
  | "Load boards"
  | "Fuel cards"
  | "Tolls"
  | "Accounting"
  | "Factoring"
  | "Driver pay"
  | "Broker tracking"
  | "Carrier setup"
  | "Phone & text"
  | "Navigation"
  | "Compliance";

export const HUB_CATEGORIES: { name: HubCategory; why: string }[] = [
  { name: "Email", why: "Rate cons, load offers and broker replies reach Backroute first." },
  { name: "ELD & GPS", why: "Where trucks are, drivers' hours, miles by state and safety events." },
  { name: "Load boards", why: "Where Backroute finds and books loads, and posts empty trucks." },
  { name: "Fuel cards", why: "Fuel on each load's profit, gallons by state for IFTA." },
  { name: "Tolls", why: "Tolls on each load's profit." },
  { name: "Accounting", why: "Invoices and payments in your books without typing them." },
  { name: "Factoring", why: "Invoices go to your factor with the right papers." },
  { name: "Driver pay", why: "Pay runs to drivers' bank accounts." },
  { name: "Broker tracking", why: "The tracking apps brokers ask for on their rate cons." },
  { name: "Carrier setup", why: "Broker onboarding networks and their websites." },
  { name: "Phone & text", why: "How drivers, brokers and docks reach Backroute." },
  { name: "Navigation", why: "Truck-safe directions on the driver's phone." },
  { name: "Compliance", why: "Authority, safety records and the yearly checks." },
];

const statement = (kind: "fuel_feed" | "toll_feed", name: string, site: string): Omit<HubEntry, "id" | "category"> => ({
  name,
  does: kind === "fuel_feed" ? `${name} purchases put on the load each truck was on.` : `${name} tolls put on the load each truck was on.`,
  gets:
    kind === "fuel_feed"
      ? ["Each fill-up matched to the truck and the load by date and unit or card number", "Each load's real profit counts its fuel", "Gallons bought by state for the IFTA return"]
      : ["Each toll matched to the truck and the load", "Each load's real profit counts its tolls"],
  how: "A statement file (CSV), uploaded or read from a report address",
  steps: [
    `On ${site}, export the transactions as a CSV (or set up a scheduled report and copy its address).`,
    "Upload it under Money → Fuel & tolls, or paste the report address here so Backroute reads it every round.",
    "Backroute finds the columns by name, matches each line to a truck and a load, and shows what it couldn't match.",
  ],
  flow: { type: "statement", kind },
});

const factoring = (name: string): Omit<HubEntry, "id" | "category"> => ({
  name,
  does: `Invoices go to ${name} with the rate con, BOL and POD, the way they ask for them.`,
  gets: [
    `Each delivered load's invoice packet emailed to the submission address from your ${name} agreement`,
    "The Notice of Assignment sent with setup packets, so brokers pay the factor",
    "Payments tracked against each invoice when the factor's remittance comes in",
  ],
  how: "Your submission email and Notice of Assignment",
  steps: [
    `Find the email your ${name} agreement says to send invoices to (it's on your welcome papers or their portal).`,
    "Enter it here; Backroute never guesses it.",
    "Upload the Notice of Assignment (NOA) they gave you.",
    "Every invoice from then on goes to that address instead of the broker.",
  ],
  flow: { type: "factoring" },
  keywords: "factor factoring invoices",
});

const request = (name: string, does: string, why: string): Omit<HubEntry, "id" | "category"> => ({
  name,
  does,
  gets: [why],
  how: "Set up by Backroute's support team",
  steps: ["Tap Ask us to connect it and add anything we should know (your account ID, a contact).", "Backroute's support team reaches out to set it up with you, and it shows here once it's working."],
  flow: { type: "request" },
});

const e = (id: string, category: HubCategory, x: Omit<HubEntry, "id" | "category">): HubEntry => ({ id, category, ...x });

export const HUB: HubEntry[] = [
  // ── Email ──
  e("gmail", "Email", {
    name: "Gmail or Google Workspace",
    does: "Backroute reads broker mail in your inbox: rate cons, load offers, replies.",
    gets: ["Rate cons reach Backroute the moment a broker sends them", "Load offers from broker emails turn into choices for your trucks", "Only freight mail is read; everything else is left alone"],
    how: "Sign in with Google (read-only)",
    steps: ["Tap Connect and sign in with the Google account brokers email.", "Allow read-only access.", "Backroute checks for broker mail every round and shows the last time it did."],
    flow: { type: "email" },
    keywords: "google mail inbox",
  }),
  e("outlook", "Email", {
    name: "Outlook or Microsoft 365",
    does: "Backroute reads broker mail in your Outlook inbox.",
    gets: ["Rate cons and load offers reach Backroute right away", "Only freight mail is read"],
    how: "Sign in with Microsoft (read-only)",
    steps: ["Tap Connect and sign in with the Microsoft account brokers email.", "Allow read-only access."],
    flow: { type: "email" },
    keywords: "microsoft hotmail office 365 inbox",
  }),
  e("forwarding", "Email", {
    name: "Forward to Backroute",
    does: "Any email: give brokers your Backroute address, or forward to it.",
    gets: ["Works with any email provider", "Broker emails get answers from your Backroute address"],
    how: "Your own Backroute email address",
    steps: ["Copy your Backroute address.", "Give it to brokers for rate cons, or set your email to forward broker mail to it.", "Send a test email; it shows here when it arrives."],
    flow: { type: "email" },
    keywords: "forward address",
  }),
  // ── ELD & GPS ──
  e("samsara", "ELD & GPS", {
    name: "Samsara",
    does: "Truck locations, drivers' hours, engine codes, odometer and safety events.",
    gets: ["Trucks on the map and late loads spotted early", "Hours left before Backroute books a load", "Miles by state for IFTA", "Harsh braking, speeding and other events to coach on", "Engine fault codes for maintenance"],
    how: "API token from Samsara",
    steps: ["In Samsara: Settings → Developer → API Tokens → Add token (read access to vehicles, drivers, HOS and safety).", "Paste the token here.", "Backroute reads it once right away and shows which trucks and drivers matched by name."],
    flow: { type: "eld_key", kind: "samsara" },
    keywords: "eld gps hos dash cam",
  }),
  e("motive", "ELD & GPS", {
    name: "Motive (KeepTruckin)",
    does: "Truck locations, drivers' hours, odometer and driver performance events.",
    gets: ["Trucks on the map and hours left before booking", "Miles by state for IFTA", "Speeding and hard-braking events to coach on"],
    how: "API key from Motive",
    steps: ["In the Motive dashboard: Admin → API Keys → Create (read-only).", "Paste the key here.", "Backroute reads it once right away and shows what matched."],
    flow: { type: "eld_key", kind: "motive" },
    keywords: "keeptruckin eld gps hos",
  }),
  e("geotab", "ELD & GPS", {
    name: "Geotab",
    does: "Truck locations from MyGeotab, for arrivals, late loads and IFTA miles.",
    gets: ["Trucks on the map", "Arrivals at docks for detention times", "Miles by state for IFTA"],
    how: "A MyGeotab user and database name",
    steps: ["In MyGeotab, add a user for Backroute with read-only access (best not your own login).", "Enter your database name, that user and its password.", "Backroute signs in once right away; the password is kept encrypted."],
    flow: { type: "geotab" },
    keywords: "mygeotab telematics",
  }),
  e("other-eld", "ELD & GPS", request("Another ELD", "Omnitracs, Verizon Connect, BigRoad and others.", "Backroute's support team checks what your ELD offers and connects what it can.")),
  // ── Load boards ──
  e("dat", "Load boards", {
    name: "DAT",
    does: "Search DAT for loads near each truck, see lane rates, and post empty trucks.",
    gets: ["Loads near each truck when it's about to be empty", "Rates to price against", "Your empty trucks posted, with brokers' calls reaching Backroute"],
    how: "Your DAT login email",
    steps: ["Enter the email you sign in to DAT with.", "Turn on posting trucks if you want brokers to find you.", "Backroute runs a test search from your first truck and shows what it found."],
    flow: { type: "dat" },
    keywords: "dat one power load board",
  }),
  e("truckstop", "Load boards", {
    name: "Truckstop",
    does: "Search Truckstop for loads near each truck and post empty trucks.",
    gets: ["Loads near each truck", "Your trucks posted where brokers look"],
    how: "Your Truckstop Integration ID",
    steps: ["In Truckstop, find your Integration ID under account settings (or ask Truckstop support for it).", "Paste it here.", "Backroute runs a test search and shows the result."],
    flow: { type: "truckstop" },
    keywords: "truckstop.com load board",
  }),
  e("123loadboard", "Load boards", request("123Loadboard", "Another board for regional freight.", "Backroute's support team connects your account; until then, use a custom board if you have API access.")),
  e("custom-board", "Load boards", {
    name: "Another board with an API",
    does: "Any load board or shipper portal that has a search API.",
    gets: ["Its loads searched like the others"],
    how: "The board's search address and field names",
    steps: ["Get the board's API details (address, key).", "Describe where the fields are in its answer.", "Backroute runs a test search before saving."],
    flow: { type: "custom_board" },
    keywords: "api json",
  }),
  e("load-feed", "Load boards", {
    name: "A shipper's or broker's load list",
    does: "A list of loads a shipper or broker publishes for you (JSON or CSV).",
    gets: ["Their loads offered to your trucks as they come in"],
    how: "The list's address",
    steps: ["Paste the address and any key it needs.", "Backroute reads it once and says how many usable loads it has."],
    flow: { type: "load_feed" },
    keywords: "feed csv json shipper",
  }),
  // ── Fuel cards ──
  e("wex", "Fuel cards", statement("fuel_feed", "WEX", "the WEX site")),
  e("comdata", "Fuel cards", statement("fuel_feed", "Comdata", "Comdata's iConnectData")),
  e("efs", "Fuel cards", statement("fuel_feed", "EFS", "EFS's online portal")),
  e("tcs", "Fuel cards", statement("fuel_feed", "TCS Fuel Card", "the TCS portal")),
  e("atob", "Fuel cards", statement("fuel_feed", "AtoB", "the AtoB dashboard")),
  e("mudflap", "Fuel cards", statement("fuel_feed", "Mudflap", "the Mudflap app or site")),
  e("other-fuel", "Fuel cards", statement("fuel_feed", "Another fuel card", "your fuel card's site")),
  // ── Tolls ──
  e("bestpass", "Tolls", statement("toll_feed", "BestPass", "the BestPass portal")),
  e("prepass", "Tolls", statement("toll_feed", "PrePass", "the PrePass account site")),
  e("ezpass", "Tolls", statement("toll_feed", "E-ZPass", "your E-ZPass agency's site")),
  e("other-toll", "Tolls", statement("toll_feed", "Another toll account", "your toll account's site")),
  // ── Accounting ──
  e("quickbooks", "Accounting", {
    name: "QuickBooks Online",
    does: "Invoices, payments and costs put in your books every hour.",
    gets: ["Each invoice sent to a broker, with one line per charge", "The payment when the broker pays", "Fuel, tolls and drivers' paid expenses as costs"],
    how: "Sign in with Intuit",
    steps: ["Tap Connect and sign in to QuickBooks.", "Pick your company.", "The first sync runs within the hour; Sync now runs it at once."],
    flow: { type: "quickbooks" },
    keywords: "qbo intuit books",
  }),
  e("xero", "Accounting", {
    name: "Xero",
    does: "Invoices and broker payments put in Xero every hour.",
    gets: ["Each invoice as a sales invoice, broker as the contact", "Payments recorded against the invoice when brokers pay"],
    how: "Sign in with Xero",
    steps: ["Check the account codes for sales and your bank (Xero's standard ones are 200 and 090).", "Tap Connect and sign in to Xero, then pick your organisation.", "The first sync runs within the hour."],
    flow: { type: "xero" },
    keywords: "books accounting",
  }),
  e("exports", "Accounting", {
    name: "Spreadsheet exports",
    does: "Loads, invoices, settlements and costs as CSV for any other software.",
    gets: ["Works with any bookkeeping software or your accountant's spreadsheet"],
    how: "Download CSV files",
    steps: ["Pick what and which dates.", "Download."],
    flow: { type: "exports" },
    keywords: "csv excel sage freshbooks wave",
  }),
  // ── Factoring ──
  e("rts", "Factoring", factoring("RTS Financial")),
  e("otr", "Factoring", factoring("OTR Solutions")),
  e("triumph", "Factoring", factoring("Triumph")),
  e("apex", "Factoring", factoring("Apex Capital")),
  e("tbs", "Factoring", factoring("TBS Factoring")),
  e("riviera", "Factoring", factoring("Riviera Finance")),
  e("ecapital", "Factoring", factoring("eCapital")),
  e("other-factor", "Factoring", factoring("your factoring company")),
  // ── Driver pay ──
  e("direct-deposit", "Driver pay", {
    name: "Direct deposit (bank file)",
    does: "Each week's pay runs as an ACH file your bank's business portal takes.",
    gets: ["One credit per driver for the net on their pay run", "Account numbers kept encrypted, shown only as the last four", "Drivers without an account on file listed, so nobody's missed"],
    how: "Your bank's ACH details and each driver's account",
    steps: [
      "Ask your bank for ACH origination on your business account; they give you a company ID.",
      "Enter the sending bank and that company ID.",
      "Add each driver's routing and account number (from a voided check or their direct deposit form).",
      "Each week, mark the pay runs right, download the bank file and upload it to your bank.",
    ],
    flow: { type: "payouts" },
    keywords: "ach nacha payroll bank",
  }),
  e("instant-pay", "Driver pay", request("Instant pay to a debit card", "Pay drivers the same day to their debit card.", "Instant pay needs a payments partner; Backroute's support team sets it up with one you choose.")),
  // ── Broker tracking ──
  e("tracking-apps", "Broker tracking", {
    name: "MacroPoint, Trucker Tools, FourKites, project44",
    does: "When a rate con asks for tracking, the driver is told what to accept and it's confirmed to the broker.",
    gets: ["The tracking ask spotted on the rate con or in the broker's email", "The driver texted the app and the load number", "Chased before pickup if it isn't on, so pay isn't held"],
    how: "Built in, nothing to connect",
    steps: ["Nothing to set up. Each load that needs tracking shows it on the load page."],
    flow: { type: "builtin", href: "/carrier/loads", hrefLabel: "See loads" },
    keywords: "macropoint descartes trucker tools fourkites p44 visibility",
  }),
  e("tracking-link", "Broker tracking", {
    name: "Backroute tracking link",
    does: "A link a broker or shipper opens to see where their load is, no app needed.",
    gets: ["Where the truck is (to the city, not the exact spot) and the ETA", "Stops when the load delivers"],
    how: "Built in",
    steps: ["On any load page, tap Share tracking and send the link."],
    flow: { type: "builtin", href: "/carrier/loads", hrefLabel: "Open a load" },
    keywords: "share location eta",
  }),
  // ── Carrier setup ──
  e("setup-networks", "Carrier setup", {
    name: "RMIS, MyCarrierPackets, Highway, Carrier Assure",
    does: "Broker onboarding: your packet is kept current on the networks brokers check.",
    gets: ["Your profile links sent with every setup packet", "Broker websites signed into with your saved logins (kept encrypted)"],
    how: "Your profile links and logins",
    steps: ["Add the profile link for each network you're on.", "Add logins for broker websites Backroute should use for you.", "Setup packets include them from then on."],
    flow: { type: "portals" },
    keywords: "onboarding packet docusign e-sign",
  }),
  // ── Phone & text ──
  e("phone-line", "Phone & text", {
    name: "Backroute phone line and texts",
    does: "One number drivers, brokers and docks call or text, answered right away.",
    gets: ["Calls and texts answered any hour", "WhatsApp for drivers who prefer it", "Calls to brokers and docks from your line"],
    how: "Built in",
    steps: ["Your number is in the panel; give it to drivers and put it on rate con replies."],
    flow: { type: "phone" },
    keywords: "twilio sms whatsapp voice",
  }),
  e("own-number", "Phone & text", request("Use your own business number", "Calls and texts go out from the number brokers already know.", "Backroute's support team moves or forwards your number and registers it for business texting.")),
  // ── Navigation ──
  e("truck-gps", "Navigation", {
    name: "Sygic Truck and CoPilot Truck",
    does: "Each stop opens in the driver's truck GPS app, routed for the truck's height and weight.",
    gets: ["Truck-safe routes, never car routes", "The truck's numbers shown to check before the trip"],
    how: "The driver picks their app",
    steps: ["Each driver picks their truck GPS app in the driver app; stops open in it."],
    flow: { type: "builtin" },
    keywords: "directions maps navigation",
  }),
  // ── Compliance ──
  e("fmcsa", "Compliance", {
    name: "FMCSA (SAFER and Licensing)",
    does: "Every broker checked before a load is booked: authority, bond, and how long they've been around.",
    gets: ["Brokers with no active authority or a recent change held for you", "Your own authority shown on setup packets"],
    how: "Built in",
    steps: ["Nothing to set up."],
    flow: { type: "builtin", href: "/carrier/brokers", hrefLabel: "See brokers" },
    keywords: "safer authority mc dot",
  }),
  e("clearinghouse", "Compliance", {
    name: "Drug & Alcohol Clearinghouse",
    does: "The yearly query for each driver, reminded before it's due.",
    gets: ["A reminder 30, 14 and 7 days before each driver's yearly query", "The date kept in each driver's file"],
    how: "Reminders (the Clearinghouse has no outside access)",
    steps: ["Run the query on the FMCSA Clearinghouse site.", "Mark it done on the driver's page; the next reminder is set for a year later."],
    flow: { type: "builtin", href: "/carrier/fleet", hrefLabel: "Open drivers" },
    keywords: "drug alcohol query",
  }),
  e("ifta-rates", "Compliance", {
    name: "IFTA tax rates",
    does: "The quarter's rate matrix, for the IFTA worksheet.",
    gets: ["Tax owed or credit by state, from ELD miles and fuel card gallons"],
    how: "Upload the matrix file from iftach.org",
    steps: ["Download the quarter's rate matrix (CSV) from iftach.org.", "Upload it on the Compliance page."],
    flow: { type: "builtin", href: "/carrier/compliance", hrefLabel: "Open Compliance" },
    keywords: "fuel tax",
  }),
];

export const hubEntry = (id: string) => HUB.find((x) => x.id === id);
