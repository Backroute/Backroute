// Stand-ins for other companies' websites (3021): a DocuSign-style signing site, a carrier setup network with sign-up,
// an emailed code and a company form, and a dock scheduling site. What each one received is in /state.
const http = require("http");
const crypto = require("crypto");
const APP = "http://localhost:3210";
const state = { signed: {}, accounts: {}, codes: {}, profiles: [], bookings: [], hits: [] };
const body = (req) => new Promise((r) => { const c = []; req.on("data", (x) => c.push(x)); req.on("end", () => r(Buffer.concat(c))); });
const page = (res, title, inner, status = 200) => {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><html><head><title>${title}</title></head><body style="font-family:sans-serif;padding:24px"><h1>${title}</h1>${inner}</body></html>`);
};
const go = (res, to) => { res.writeHead(303, { location: to }); res.end(); };
const form = (buf) => Object.fromEntries(new URLSearchParams(buf.toString()));
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
function multipart(buf, type) {
  const boundary = type.match(/boundary=(.+)$/)?.[1];
  const out = { files: {} };
  if (!boundary) return out;
  for (const part of buf.toString("latin1").split(`--${boundary}`)) {
    const name = part.match(/name="([^"]+)"/)?.[1];
    if (!name) continue;
    const value = part.split("\r\n\r\n").slice(1).join("\r\n\r\n").replace(/\r\n$/, "");
    const file = part.match(/filename="([^"]*)"/)?.[1];
    if (file !== undefined) out.files[name] = { name: file, size: value.length, pdf: value.startsWith("%PDF") };
    else out[name] = value;
  }
  return out;
}
const doc = (q) => `<div id="doc" style="border:1px solid #999;padding:12px;margin:12px 0"><b>RATE CONFIRMATION</b><br>Load ${esc(q.ref)}<br>Dallas, TX to Memphis, TN<br>Total rate: $${Number(q.rate).toLocaleString("en-US")}</div>`;

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const q = Object.fromEntries(url.searchParams);
  const buf = await body(req);
  state.hits.push(`${req.method} ${url.pathname}`);
  if (url.pathname === "/state") return res.end(JSON.stringify(state));

  // ── Signing site ──
  let m = url.pathname.match(/^\/sign\/([\w-]+)(\/\w+)?$/);
  if (m) {
    const [, id, stepRaw] = m;
    const step = stepRaw?.slice(1) ?? "";
    const qs = `?ref=${encodeURIComponent(q.ref ?? "")}&rate=${encodeURIComponent(q.rate ?? "")}`;
    const s = (state.signed[id] ??= { consent: false, name: null, finished: false, downloaded: false });
    if (!step) return page(res, "Please review and act on these documents", `<form method="post" action="/sign/${id}/consent${qs}"><input type="checkbox" id="c" name="c" required> <label for="c">I agree to use electronic records and signatures</label><br><br><button>Continue</button></form>`);
    if (step === "consent" && req.method === "POST") { s.consent = form(buf).c === "on"; return go(res, `/sign/${id}/doc${qs}`); }
    if (!s.consent) return page(res, "Consent needed", "<p>Go back and agree first.</p>", 400);
    if (step === "doc") return page(res, "Review the document", `${doc(q)}<a href="/sign/${id}/adopt${qs}"><button>Sign here</button></a>`);
    if (step === "adopt" && req.method === "GET") return page(res, "Adopt your signature", `${doc(q)}<form method="post" action="/sign/${id}/adopt${qs}"><label for="n">Full name</label> <input id="n" name="n"><br><br><button>Adopt and Sign</button></form>`);
    if (step === "adopt") { s.name = form(buf).n || null; return go(res, `/sign/${id}/finish${qs}`); }
    if (step === "finish" && req.method === "GET") return page(res, "Almost done", `${doc(q)}<p>Signed by ${esc(s.name)}. Click Finish to complete.</p><form method="post" action="/sign/${id}/finish${qs}"><button>Finish</button></form>`);
    if (step === "finish") { s.finished = true; return go(res, `/sign/${id}/done${qs}`); }
    if (step === "done") return page(res, "Signing complete", `<p>Signing complete. You're done.</p><a href="/sign/${id}/pdf${qs}">Download</a>`);
    if (step === "pdf") {
      s.downloaded = true;
      res.writeHead(200, { "content-type": "application/pdf", "content-disposition": `attachment; filename="ratecon-${id}-signed.pdf"` });
      return res.end("%PDF-1.4\n% signed copy\n%%EOF\n");
    }
  }

  // ── Carrier setup network (the path names the network, as a real invite's host would) ──
  m = url.pathname.match(/^\/mycarrierpackets\/(\w+)$/);
  if (m) {
    const step = m[1];
    if (step === "invite" && req.method === "GET") return page(res, "Sign in to MyCarrierPackets", `<p>${esc(q.broker ?? "A broker")} invited you to share your carrier profile.</p>${q.err ? "<p>Wrong email or password.</p>" : ""}<form method="post" action="/mycarrierpackets/invite"><label for="e">Email</label> <input id="e" name="e"><br><label for="p">Password</label> <input id="p" name="p" type="password"><br><button>Sign in</button></form><p><a href="/mycarrierpackets/register">Create an account</a></p>`);
    if (step === "invite") { const f = form(buf); const a = state.accounts[f.e]; return a && a.password === f.p ? (a.verified ? go(res, "/mycarrierpackets/company?e=" + encodeURIComponent(f.e)) : go(res, "/mycarrierpackets/verify?e=" + encodeURIComponent(f.e))) : go(res, "/mycarrierpackets/invite?err=1"); }
    if (step === "register" && req.method === "GET") return page(res, "Create your account", `<form method="post" action="/mycarrierpackets/register"><label for="e">Email</label> <input id="e" name="e"><br><label for="p">Password</label> <input id="p" name="p" type="password"><br><label for="p2">Confirm password</label> <input id="p2" name="p2" type="password"><br><button>Create account</button></form>`);
    if (step === "register") {
      const f = form(buf);
      if (!f.e || !f.p || f.p !== f.p2) return page(res, "Create your account", "<p>Passwords don't match.</p>", 400);
      const code = String(100000 + crypto.randomInt(899999));
      state.accounts[f.e] = { password: f.p, verified: false };
      state.codes[f.e] = code;
      // The code goes to the address they signed up with, the way a real site emails it.
      const key = f.e.match(/\+([^@]+)@/)?.[1];
      fetch(`${APP}/api/channels/email?token=email-hook-secret`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ MessageID: `mcp-${Date.now()}`, From: "no-reply@mycarrierpackets.com", FromName: "MyCarrierPackets", FromFull: { Email: "no-reply@mycarrierpackets.com", Name: "MyCarrierPackets" }, To: f.e, MailboxHash: key, Subject: "Your MyCarrierPackets verification code", TextBody: `Your verification code is ${code}. It expires in 10 minutes.`, Headers: [], Attachments: [] }) }).catch(() => {});
      return go(res, "/mycarrierpackets/verify?e=" + encodeURIComponent(f.e));
    }
    if (step === "verify" && req.method === "GET") return page(res, "Check your email", `<p>Enter the 6-digit code we emailed you.</p><form method="post" action="/mycarrierpackets/verify?e=${encodeURIComponent(q.e ?? "")}"><label for="v">Verification code</label> <input id="v" name="v"><br><button>Verify</button></form>`);
    if (step === "verify") { const f = form(buf); if (state.codes[q.e] && state.codes[q.e] === f.v) { state.accounts[q.e].verified = true; return go(res, "/mycarrierpackets/company?e=" + encodeURIComponent(q.e)); } return page(res, "Check your email", "<p>That code is wrong.</p>", 400); }
    if (step === "company" && req.method === "GET") return page(res, "Your company profile", `<form method="post" enctype="multipart/form-data" action="/mycarrierpackets/company?e=${encodeURIComponent(q.e ?? "")}"><label for="l">Legal company name</label> <input id="l" name="legal" required><br><label for="mc">MC number</label> <input id="mc" name="mc" required><br><label for="dot">USDOT number</label> <input id="dot" name="dot"><br><label for="ein">EIN (tax ID)</label> <input id="ein" name="ein" required><br><label for="ph">Phone</label> <input id="ph" name="phone"><br><label for="w9">Upload W-9</label> <input id="w9" name="w9" type="file"><br><input type="checkbox" id="ag" name="agree" required> <label for="ag">I agree to the Broker-Carrier Agreement</label><br><button>Submit profile</button></form>`);
    if (step === "company") { const f = multipart(buf, req.headers["content-type"] ?? ""); state.profiles.push({ email: q.e, legal: f.legal, mc: f.mc, dot: f.dot, ein: f.ein, phone: f.phone, agree: f.agree, w9: f.files.w9 ?? null }); return go(res, "/mycarrierpackets/complete"); }
    if (step === "complete") return page(res, "Setup complete", "<p>Setup complete. Acme Freight can now book you.</p>");
  }

  // ── Dock scheduling site ──
  m = url.pathname.match(/^\/dock\/([\w-]+)(\/\w+)?$/);
  if (m) {
    const [, id, stepRaw] = m;
    if (!stepRaw && req.method === "GET") {
      const d = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
      const slots = [`${d(1)} 06:00`, `${d(2)} 07:00`, `${d(2)} 09:30`, `${d(3)} 08:00`];
      return page(res, "Book a delivery appointment", `<form method="post" action="/dock/${id}"><label for="po">PO or load number</label> <input id="po" name="po"><br><label for="s">Time slot</label> <select id="s" name="slot">${slots.map((s) => `<option>${s}</option>`).join("")}</select><br><button>Book appointment</button></form>`);
    }
    if (!stepRaw) { const f = form(buf); const conf = "OD-" + (4400 + state.bookings.length); state.bookings.push({ id, po: f.po, slot: f.slot, conf }); return go(res, `/dock/${id}/done?c=${conf}&s=${encodeURIComponent(f.slot)}`); }
    if (stepRaw === "/done") return page(res, "Appointment booked", `<p>Appointment booked for ${esc(q.s)}. Confirmation #${esc(q.c)}</p>`);
  }
  page(res, "Not found", "<p>Nothing here.</p>", 404);
}).listen(3021);
