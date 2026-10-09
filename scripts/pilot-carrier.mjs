// Sets up and steps a pilot carrier, for Backroute's team (it uses the service role key, so run it from a trusted
// machine, never a browser). See PILOT.md for the plan it follows.
//
//   node scripts/pilot-carrier.mjs create --name "Lone Star Hauling" --mc 123456 --dot 1234567 --owner-phone "+1 214 555 0100"
//                                   [--fleet fleet.csv] [--owner-operator] [--drivers-agreed]
//   node scripts/pilot-carrier.mjs stage <carrier-id> shadow|ask|rules|full
//   node scripts/pilot-carrier.mjs status <carrier-id>
//   node scripts/pilot-carrier.mjs pause <carrier-id>        (back to practice mode: nothing leaves)
//   node scripts/pilot-carrier.mjs resume <carrier-id>       (back to the stage it was paused from)
//   node scripts/pilot-carrier.mjs list                      (every carrier, its stage, live or practice)
//   node scripts/pilot-carrier.mjs pause-all                 (the stop button: every live carrier to practice mode)
//   node scripts/pilot-carrier.mjs resume-all                (each carrier back to where pause-all found it)
//   node scripts/pilot-carrier.mjs export <carrier-id> [--out dir]   (everything of theirs: JSON per table, and the files)
//   node scripts/pilot-carrier.mjs delete <carrier-id> --confirm "<exact company name>"
//                                   (on the owner's written request: cancels the subscription, deletes the carrier and
//                                    everything of theirs, and removes sign-ins that were only for them. Can't be undone.)
//
// --drivers-agreed records that the owner has each driver's written OK to texts and calls (docs/legal); without it,
// each driver's first text asks them to confirm.
//
// fleet.csv, one truck per line: unit,driver name,driver phone,equipment,home city,home state,run type
//   101,Marcus Hill,+12145550148,Dry Van,Dallas,TX,regional
//
// Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (from .env.local, or set them for the command).
import fs from "node:fs";
import crypto from "node:crypto";

// .env.local, if it's there and the variables aren't already set.
if (fs.existsSync(".env.local"))
  for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }

const URL_ = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const [cmd, ...rest] = process.argv.slice(2);
const positional = rest.filter((a, i) => !a.startsWith("--") && !rest[i - 1]?.startsWith("--"));
const args = Object.fromEntries(rest.reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : "true"]] : acc), []));

// The app's own id for a carrier inside its objects (lib/mock-data PRIMARY_CARRIER_ID); the database keeps the real one.
const APP_CARRIER = "carrier-titan";
const EQUIPMENT = ["Dry Van", "Reefer", "Flatbed", "Step Deck", "Power Only", "Box Truck"];
const RUN_TYPES = { intown: "Home every night", local: "Home every night", regional: "Home by Friday", otr: "Home in 2 weeks" };

/** How far the AI goes on its own at each stage of the pilot (PILOT.md). */
const STAGES = {
  shadow: { sandbox: true, autonomy: "ask", note: "Practice: the AI reads and decides everything, nothing leaves. The owner sees what it would have sent." },
  ask: { sandbox: false, autonomy: "ask", note: "Live, ask first: every email to a broker waits for the owner's Send." },
  rules: { sandbox: false, autonomy: "rules", note: "Live, within the owner's rules: bookings and paperwork at or over the lowest rate go on their own." },
  full: { sandbox: false, autonomy: "full", note: "Full autopilot: the AI's own replies go too." },
};

async function rest_(method, path, body, prefer = "return=representation") {
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    method,
    headers: { apikey: KEY, authorization: `Bearer ${KEY}`, "content-type": "application/json", prefer },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

const uid = (p) => `${p}-${Date.now().toString(36)}${crypto.randomBytes(3).toString("hex")}`;
const digits = (p) => String(p ?? "").replace(/\D/g, "");
const e164 = (p) => {
  const d = digits(p);
  return d.length === 10 ? `+1${d}` : d.length === 11 && d.startsWith("1") ? `+${d}` : null;
};

function fleetFrom(file) {
  const rows = fs.readFileSync(file, "utf8").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^unit\s*,/i.test(l));
  return rows.map((line, n) => {
    const [unit, name, phone, equipment = "Dry Van", city = "", state = "", runType = "regional"] = line.split(",").map((s) => s.trim());
    if (!unit || !name || !e164(phone)) throw new Error(`fleet line ${n + 1}: needs unit, driver name and a US phone number`);
    const eq = EQUIPMENT.find((e) => e.toLowerCase() === equipment.toLowerCase()) ?? "Dry Van";
    const rt = RUN_TYPES[runType.toLowerCase()] ? runType.toLowerCase() : "regional";
    const truckId = uid("truck");
    const driverId = uid("driver");
    const homeBase = `${city}, ${state.toUpperCase()}`;
    const now = new Date().toISOString();
    return {
      truck: { id: truckId, unitNumber: unit, driverId, carrierId: APP_CARRIER, equipmentType: eq, status: "available", currentCity: city, currentState: state.toUpperCase(), homeBase, currentLoadId: null, nextLoadId: null, mpg: 6.5, odometer: 0, lastServiceMiles: 0, serviceIntervalMiles: 25000, nextInspectionDue: new Date(Date.now() + 365 * 86400000).toISOString() },
      driver: { id: driverId, name, phone: e164(phone), email: "", truckId, carrierId: APP_CARRIER, hosStatus: "off_duty", hoursRemaining: 11, cdl: "", rating: 5, hireDate: now, homeBase, runType: rt, homeTimeTarget: RUN_TYPES[rt], payType: rt === "local" ? "hourly" : rt === "intown" ? "per_move" : "percentage", payRate: rt === "local" ? 28 : rt === "intown" ? 75 : 0.28 },
    };
  });
}

async function carrier(id) {
  const rows = await rest_("GET", `carriers?id=eq.${encodeURIComponent(id)}&select=id,name,mc,dot,owner_phone,inbound_key,settings,created_at`);
  if (!rows?.length) throw new Error(`No carrier ${id}`);
  return rows[0];
}

async function setStage(id, stage, { pausing = false } = {}) {
  const s = STAGES[stage];
  if (!s) throw new Error(`Stage is one of: ${Object.keys(STAGES).join(", ")}`);
  const c = await carrier(id);
  const before = c.settings ?? {};
  const settings = { ...before, sandbox: s.sandbox, autonomy: s.autonomy, pilotStage: stage, pilotStageAt: new Date().toISOString() };
  // A pause remembers exactly how the carrier ran (a carrier that signed up on its own has no pilot stage), so resume
  // puts it back; moving a stage on purpose forgets it.
  if (pausing && !before.sandbox) settings.pausedFrom = { sandbox: false, autonomy: before.autonomy ?? "ask", pilotStage: before.pilotStage ?? null, pilotStageAt: before.pilotStageAt ?? null };
  else if (!pausing) delete settings.pausedFrom;
  await rest_("PATCH", `carriers?id=eq.${encodeURIComponent(id)}`, { settings });
  console.log(`${c.name}: ${stage}. ${s.note}${pausing && settings.pausedFrom ? ` (was live, autopilot ${settings.pausedFrom.autonomy}: resume puts it back)` : ""}`);
}

async function resume(id) {
  const c = await carrier(id);
  const back = c.settings?.pausedFrom;
  if (!back) return console.log(`${c.name}: wasn't paused from live; nothing to resume (use stage to move it).`);
  const { pausedFrom, ...rest } = c.settings;
  const settings = { ...rest, sandbox: back.sandbox, autonomy: back.autonomy };
  if (back.pilotStage) Object.assign(settings, { pilotStage: back.pilotStage, pilotStageAt: back.pilotStageAt });
  else delete settings.pilotStage, delete settings.pilotStageAt;
  await rest_("PATCH", `carriers?id=eq.${encodeURIComponent(id)}`, { settings });
  console.log(`${c.name}: live again, autopilot ${back.autonomy}${back.pilotStage ? ` (${back.pilotStage})` : ""}.`);
}

async function all() {
  return rest_("GET", "carriers?select=id,name,settings&order=created_at");
}

async function list() {
  for (const c of await all()) {
    const s = c.settings ?? {};
    console.log(`${c.id}  ${s.sandbox ? "practice" : "LIVE    "}  ${(s.pilotStage ?? "-").padEnd(6)}  autopilot ${(s.autonomy ?? "ask").padEnd(5)}  ${c.name}${s.pausedFrom ? "  (paused: resume puts it back)" : ""}`);
  }
}

/** The stop button: every carrier that sends anything goes to practice mode at once. Each remembers its stage. */
async function pauseAll() {
  const live = (await all()).filter((c) => !c.settings?.sandbox);
  if (!live.length) return console.log("No live carriers: nothing to pause.");
  for (const c of live) await setStage(c.id, "shadow", { pausing: true });
  console.log(`\n${live.length} carrier${live.length === 1 ? "" : "s"} in practice mode: nothing goes to brokers or drivers until they're resumed.`);
}

async function resumeAll() {
  const paused = (await all()).filter((c) => c.settings?.pausedFrom);
  if (!paused.length) return console.log("Nothing paused by pause-all.");
  for (const c of paused) await resume(c.id);
}

async function create() {
  const name = args.name;
  const owner = e164(args["owner-phone"]);
  if (!name || !owner) throw new Error('Needs --name "Company" and --owner-phone (a US number).');
  const fleet = args.fleet ? fleetFrom(args.fleet) : [];
  const id = crypto.randomUUID();
  const ownerOperator = args["owner-operator"] === "true";
  const settings = { sandbox: true, autonomy: "ask", pilotStage: "shadow", pilotStageAt: new Date().toISOString(), ownerOperator, dailyText: true, rateFloorPct: 96, ownerLanguage: "en" };
  const [c] = await rest_("POST", "carriers", { id, name, mc: args.mc ? digits(args.mc) : null, dot: args.dot ? digits(args.dot) : null, owner_operator: ownerOperator, owner_phone: owner, settings });
  // The owner becomes the owner when they first sign in with that phone (claim_invites).
  await rest_("POST", "invites", { carrier_id: id, phone: owner, role: "owner", driver_id: ownerOperator && fleet[0] ? fleet[0].driver.id : null }, "return=minimal");
  for (const { truck, driver } of fleet) {
    await rest_("POST", "drivers", { id: driver.id, carrier_id: id, name: driver.name, phone: driver.phone, data: driver }, "return=minimal");
    await rest_("POST", "trucks", { id: truck.id, carrier_id: id, unit_number: truck.unitNumber, driver_id: driver.id, data: truck }, "return=minimal");
    // Drivers sign in to the driver app with their own phone.
    if (!(ownerOperator && driver.phone === owner)) await rest_("POST", "invites", { carrier_id: id, phone: driver.phone, role: "driver", driver_id: driver.id }, "return=minimal");
    // The same words the owner checks in the app (lib/consent-words OWNER_ATTESTS), kept as the record.
    if (args["drivers-agreed"] === "true")
      await rest_("POST", "driver_consents", { carrier_id: id, driver_id: driver.id, phone: driver.phone, granted: true, via: "owner", version: "2026-10-01", wording: `This driver has agreed, in writing, to get texts and calls from ${name}'s dispatch line, run by Backroute, about their loads and work, including automated texts and calls from an AI dispatcher. I'll keep a copy of that agreement. (Recorded by Backroute's team at setup.)` }, "return=minimal");
  }
  const inbound = process.env.EMAIL_INBOUND_ADDRESS ? process.env.EMAIL_INBOUND_ADDRESS.replace("@", `+${c.inbound_key}@`) : `(set EMAIL_INBOUND_ADDRESS to see it; key ${c.inbound_key})`;
  console.log(`Pilot carrier created: ${name}
  id:             ${id}
  stage:          shadow (practice: nothing leaves)
  owner signs in: ${owner}
  trucks:         ${fleet.length}${fleet.length ? ` (${fleet.map((f) => f.truck.unitNumber).join(", ")})` : " (the owner adds them at first sign-in)"}
  drivers' OK:    ${args["drivers-agreed"] === "true" ? "recorded (the owner has it in writing)" : "not recorded: each driver's first text asks them to confirm"}
  broker email:   ${inbound}

Next (PILOT.md, day 0):
  1. The owner signs in at /login with ${owner}, checks the fleet, sets the lowest rate per mile, uploads W-9 and COI.
  2. In their email, forward (or CC) broker load emails to the broker email above.
  3. Watch Needs you and the log for a week in practice mode, then: node scripts/pilot-carrier.mjs stage ${id} ask`);
}

async function status(id) {
  const c = await carrier(id);
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const [loads, open, support, sent, held] = await Promise.all([
    rest_("GET", `loads?carrier_id=eq.${id}&select=stage&limit=2000`),
    rest_("GET", `escalations?carrier_id=eq.${id}&status=eq.open&select=id`),
    rest_("GET", `escalations?carrier_id=eq.${id}&status=eq.with_support&select=id`),
    rest_("GET", `channel_messages?carrier_id=eq.${id}&direction=eq.out&created_at=gte.${since}&select=channel`),
    rest_("GET", `outbound?carrier_id=eq.${id}&status=eq.held&created_at=gte.${since}&select=channel`),
  ]);
  const by = (list, key) => Object.entries(list.reduce((m, r) => ((m[r[key]] = (m[r[key]] ?? 0) + 1), m), {})).map(([k, v]) => `${k} ${v}`).join(", ") || "none";
  const s = c.settings ?? {};
  console.log(`${c.name} (${id})
  stage:        ${s.pilotStage ?? "?"} since ${s.pilotStageAt?.slice(0, 10) ?? "?"} · autopilot ${s.autonomy} · ${s.sandbox ? "practice mode (nothing leaves)" : "live"}
  loads:        ${by(loads, "stage")}
  needs owner:  ${open.length} · with support: ${support.length}
  last 7 days:  sent ${by(sent, "channel")}; held in practice ${by(held, "channel")}`);
}

// ─── A carrier leaving (the same as Settings → Your data; lib/account.ts has the app's copy of this list) ──────────
const EXPORT_TABLES = {
  drivers: ["id,name,phone,data,updated_at", "id"],
  trucks: ["id,unit_number,driver_id,second_driver_id,data,updated_at", "id"],
  loads: ["id,truck_id,stage,data,updated_at", "id"],
  escalations: ["id,load_id,status,data,updated_at", "id"],
  records: ["id,kind,driver_id,data,updated_at", "id"],
  activity: ["id,load_id,data,created_at", "id"],
  channel_messages: ["id,channel,direction,driver_id,counterparty,body,data,created_at", "id"],
  driver_messages: ["id,driver_id,data,created_at", "id"],
  dispatch_calls: ["id,driver_id,status,data,updated_at", "id"],
  driver_consents: ["id,driver_id,phone,granted,via,wording,version,at", "id"],
  held_sends: ["id,load_id,purpose,summary,draft,send_at,status,created_at", "id"],
  facility_notes: ["id,name_key,city,state,zip,note,hours,created_at", "id"],
  facility_visits: ["load_id,stop,name_key,city,state,minutes,at", "at"],
  weekly_reviews: ["week,data,created_at", "week"],
  audit_log: ["id,at,who,action,target", "id"],
  portal_tasks: ["id,kind,status,url,load_id,created_at,updated_at", "id"],
  portal_logins: ["id,kind,site,label,username,created_at", "id"],
  carrier_integrations: ["kind,status,checked_at", "kind"],
  carrier_files: ["id,kind,load_id,name,content_type,size,expires_on,note,created_at", "created_at"],
};

async function exportCarrier(id, out) {
  const c = await carrier(id);
  const dir = out ?? `export-${id}`;
  fs.mkdirSync(`${dir}/data`, { recursive: true });
  const [billing] = await rest_("GET", `carrier_billing?carrier_id=eq.${id}&select=status,trucks,current_period_end,trial_end`);
  fs.writeFileSync(`${dir}/data/carrier.json`, JSON.stringify({ ...c, inbound_key: undefined, billing: billing ?? null }, null, 1));
  for (const [table, [columns, order]] of Object.entries(EXPORT_TABLES)) {
    const rows = [];
    for (let page = 0; ; page++) {
      const got = await rest_("GET", `${table}?carrier_id=eq.${id}&select=${columns}&order=${order}&limit=1000&offset=${page * 1000}`);
      rows.push(...got);
      if (got.length < 1000) break;
    }
    fs.writeFileSync(`${dir}/data/${table}.json`, JSON.stringify(rows, null, 1));
    console.log(`  ${table.padEnd(22)} ${rows.length}`);
  }
  let files = 0;
  for (let page = 0; ; page++) {
    const got = await rest_("GET", `carrier_files?carrier_id=eq.${id}&select=id,kind,name,created_at,data&order=created_at&limit=20&offset=${page * 20}`);
    for (const f of got) {
      const safe = (x) => String(x).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").slice(0, 120) || "file";
      fs.mkdirSync(`${dir}/files/${safe(f.kind)}`, { recursive: true });
      const name = `${dir}/files/${safe(f.kind)}/${f.created_at.slice(0, 10)} ${f.id.slice(0, 8)} ${safe(f.name)}`;
      fs.writeFileSync(name, Buffer.from(f.data, "base64"));
      files++;
    }
    if (got.length < 20) break;
  }
  console.log(`${c.name}: exported to ${dir} (${files} files). Saved website passwords and connection keys aren't included.`);
}

async function deleteCarrier(id, confirm) {
  const c = await carrier(id);
  const norm = (x) => String(x ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  if (norm(confirm) !== norm(c.name)) throw new Error(`To delete ${id}, add --confirm "${c.name}" (the exact company name).`);
  const [billing] = await rest_("GET", `carrier_billing?carrier_id=eq.${id}&select=subscription_id,status`);
  if (billing?.subscription_id && billing.status !== "canceled") {
    if (!process.env.STRIPE_SECRET_KEY) throw new Error("They have a subscription: set STRIPE_SECRET_KEY so it's cancelled first (or cancel it in Stripe and run this again).");
    const res = await fetch(`${(process.env.STRIPE_API_BASE ?? "https://api.stripe.com").replace(/\/$/, "")}/v1/subscriptions/${billing.subscription_id}`, { method: "DELETE", headers: { authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` } });
    if (!res.ok && res.status !== 404) throw new Error(`Stripe wouldn't cancel the subscription (${res.status}); nothing was deleted.`);
    console.log("  subscription cancelled");
  }
  const members = await rest_("GET", `members?carrier_id=eq.${id}&select=user_id`);
  await rest_("POST", "closed_accounts?on_conflict=carrier_id", { carrier_id: id, name: c.name, mc: c.mc, closed_by: `support (${process.env.USER ?? "script"})` }, "resolution=merge-duplicates,return=minimal");
  await rest_("DELETE", `carriers?id=eq.${encodeURIComponent(id)}`, null, "return=minimal");
  await rest_("DELETE", `service_heartbeats?name=eq.${encodeURIComponent(`rounds:${id}`)}`, null, "return=minimal");
  let removed = 0;
  for (const { user_id } of members) {
    const other = await rest_("GET", `members?user_id=eq.${user_id}&select=carrier_id&limit=1`);
    if (other.length) continue;
    const res = await fetch(`${URL_}/auth/v1/admin/users/${user_id}`, { method: "DELETE", headers: { apikey: KEY, authorization: `Bearer ${KEY}` } });
    if (res.ok) removed++;
    else console.log(`  couldn't remove sign-in ${user_id} (${res.status}); remove it in Supabase → Authentication`);
  }
  console.log(`${c.name} (${id}) deleted, with everything of theirs. ${removed} sign-in${removed === 1 ? "" : "s"} removed. Drivers' consent records were archived.`);
}

try {
  if (!URL_ || !KEY) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  if (cmd === "create") await create();
  else if (cmd === "stage") await setStage(positional[0], positional[1]);
  else if (cmd === "pause") await setStage(positional[0], "shadow", { pausing: true });
  else if (cmd === "resume") await resume(positional[0]);
  else if (cmd === "status") await status(positional[0]);
  else if (cmd === "list") await list();
  else if (cmd === "pause-all") await pauseAll();
  else if (cmd === "resume-all") await resumeAll();
  else if (cmd === "export") await exportCarrier(positional[0], args.out);
  else if (cmd === "delete") await deleteCarrier(positional[0], args.confirm);
  else console.log("Usage: create | stage <id> shadow|ask|rules|full | status <id> | pause <id> | resume <id> | list | pause-all | resume-all | export <id> | delete <id> --confirm <name>   (see the top of this file)");
} catch (e) {
  console.error(e.message ?? e);
  process.exit(1);
}
