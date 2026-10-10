// The "fix everything" round: one TONU everywhere, the rate kept from drivers, broker answers coming back to the
// carrier, the owner's mailbox read for freight only, and the email setup's own mail.
import { DEFAULT_TONU, tonuFor, tonuOnRateCon } from "../../src/lib/tonu.ts";
import { driverSeesLoadPay } from "../../src/lib/pay-view.ts";
import { replyTo } from "../../src/lib/agent/outbox.ts";
import { isFreightMail, mailboxConnectUrl, readMailboxState } from "../../src/lib/agent/mailbox.ts";
import { setupMail, viaOf } from "../../src/lib/agent/inbox.ts";

let pass = 0, fail = 0;
const ok = (label: string, c: boolean, x?: unknown) => { if (c) { pass++; console.log("PASS", label); } else { fail++; console.log("FAIL", label, x === undefined ? "" : JSON.stringify(x)); } };

// TONU: the rate con's number, else the carrier's, else $150. Never two numbers for one load.
const plain = { rateConReading: null } as any;
const withTonu = { rateConReading: { finesAndFees: ["TONU $250 if cancelled after dispatch"], otherConcerns: [], summary: "" } } as any;
ok("no TONU anywhere: the default", tonuFor(plain) === DEFAULT_TONU && DEFAULT_TONU === 150, tonuFor(plain));
ok("the carrier's own fee beats the default", tonuFor(plain, 200) === 200);
ok("the rate con's TONU beats both", tonuOnRateCon(withTonu) === 250 && tonuFor(withTonu, 200) === 250);

// The rate: owner-operators see it, percentage drivers see it, others see their own pay unless the owner says so.
const d = (x: object) => ({ payType: "per_mile", ...x }) as any;
ok("a per-mile company driver doesn't see what the load pays", !driverSeesLoadPay(d({}), false));
ok("a percentage driver does (their pay is worked from it)", driverSeesLoadPay(d({ payType: "percentage" }), false));
ok("an owner-operator always does", driverSeesLoadPay(d({ seesLoadPay: false }), true));
ok("the owner can turn it on for one driver", driverSeesLoadPay(d({ seesLoadPay: true }), false));
ok("…or off for a percentage driver", !driverSeesLoadPay(d({ payType: "percentage", seesLoadPay: false }), false));

// Reply-To: every broker email answers to the carrier's Backroute address; a bill also to the payments email.
process.env.EMAIL_INBOUND_ADDRESS = "abc123@inbound.postmarkapp.com";
const ctx = { carrier: { inbound_key: "k7" }, settings: { remitEmail: "billing@titan.test" } } as any;
ok("a book request answers to the carrier's own address", replyTo(ctx, "book_request") === "abc123+k7@inbound.postmarkapp.com", replyTo(ctx, "book_request"));
ok("an invoice answers to billing and the carrier's address", replyTo(ctx, "invoice") === "billing@titan.test, abc123+k7@inbound.postmarkapp.com", replyTo(ctx, "invoice"));
ok("no inbound address set: only billing on a bill, nothing otherwise", (delete process.env.EMAIL_INBOUND_ADDRESS, replyTo(ctx, "invoice") === "billing@titan.test" && replyTo(ctx, "reply") === undefined));

// The mailbox: freight only.
const brokers = ["loads@tql.test", "kim@coastalfreight.test"];
const own = "owner@titanfreight.test";
ok("mail from a known broker", isFreightMail({ from: "loads@tql.test", subject: "Hi", attachments: [] }, brokers, own));
ok("mail from someone else at a broker's company", isFreightMail({ from: "ap@coastalfreight.test", subject: "Question", attachments: [] }, brokers, own));
ok("a rate con from a new broker, by its subject", isFreightMail({ from: "ops@newbroker.test", subject: "Rate Confirmation #4411", attachments: [] }, brokers, own));
ok("…or by its file name", isFreightMail({ from: "ops@newbroker.test", subject: "Load", attachments: ["RateCon_4411.pdf"] }, brokers, own));
ok("a gmail.com sender doesn't count as a broker's company", !isFreightMail({ from: "friend@gmail.com", subject: "Dinner", attachments: [] }, ["dispatch@gmail.com"], own));
ok("personal mail is skipped", !isFreightMail({ from: "bank@chase.test", subject: "Your statement is ready", attachments: ["statement.pdf"] }, brokers, own));
ok("a phone bill's invoice is skipped (only brokers' invoices count)", !isFreightMail({ from: "billing@phoneco.test", subject: "Your invoice is ready", attachments: ["invoice.pdf"] }, brokers, own));
ok("the owner's own mail is skipped…", !isFreightMail({ from: own, subject: "Rate con for my records", attachments: [] }, brokers, own));
ok("…except their test", isFreightMail({ from: own, subject: "Backroute test", attachments: [] }, brokers, own));

// Connecting: the signed state names the mailbox and the carrier, and can't be changed or reused late.
process.env.GOOGLE_CLIENT_ID = "g-id";
process.env.PUBLIC_BASE_URL = "https://app.test";
const url = new URL(mailboxConnectUrl("gmail", "c1", "u1", 1_000_000));
const state = url.searchParams.get("state")!;
ok("Gmail is asked for read-only, offline", url.searchParams.get("scope") === "https://www.googleapis.com/auth/gmail.readonly" && url.searchParams.get("access_type") === "offline" && url.searchParams.get("redirect_uri") === "https://app.test/api/integrations/mailbox/callback");
ok("the state reads back", JSON.stringify(readMailboxState(state, 1_000_000)) === JSON.stringify({ kind: "gmail", carrierId: "c1", userId: "u1" }));
ok("a changed state is refused", readMailboxState(state.replace(/^./, (c) => (c === "e" ? "f" : "e")), 1_000_000) === null);
ok("a state after 15 minutes is refused", readMailboxState(state, 1_000_000 + 16 * 60_000) === null);

// The setup's own mail never reaches the AI.
ok("the owner's test", setupMail(own, "Backroute test", "")?.kind === "test");
const g = setupMail("forwarding-noreply@google.com", "(#123456789) Gmail Forwarding Confirmation - Receive Mail from owner@gmail.com", "Confirmation code: 123456789\nhttps://mail-settings.google.com/mail/vf-%5BANGjdJ9%5D-abc");
ok("Gmail's forwarding code and link", g?.kind === "forward_confirm" && g.code === "123456789" && /^https:\/\/mail-settings\.google\.com\/mail\/vf-/.test(g.link ?? ""), g);
ok("a broker's email isn't setup mail", setupMail("loads@tql.test", "Load TQL-5501", "") === null);
ok("sent to the Backroute address: direct", viaOf({ To: "abc123+k7@inbound.postmarkapp.com" } as any, "inbound.postmarkapp.com") === "direct");
ok("forwarded from the owner's inbox: forward", viaOf({ To: "owner@gmail.com" } as any, "inbound.postmarkapp.com") === "forward");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
