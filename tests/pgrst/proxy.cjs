// Stands in for Supabase's gateway: /rest/v1 → PostgREST, /auth/v1/user → the user in the bearer token, and the admin
// API's "delete a user" (recorded in tests/fakes/auth-admin.jsonl).
const http = require("http");
const fs = require("fs");
http.createServer((req, res) => {
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
  if (req.url.startsWith("/auth/") && req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
  if (req.url.startsWith("/auth/v1/logout")) { res.writeHead(204, cors); return res.end(); }
  if (req.url.startsWith("/auth/v1/user")) {
    const tok = (req.headers.authorization || "").replace("Bearer ", "");
    const claims = JSON.parse(Buffer.from(tok.split(".")[1], "base64url").toString());
    res.writeHead(200, { "content-type": "application/json", ...cors });
    return res.end(JSON.stringify({ id: claims.sub, phone: claims.phone, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() }));
  }
  const admin = req.url.match(/^\/auth\/v1\/admin\/users\/([\w-]+)/);
  if (admin && req.method === "DELETE") {
    fs.appendFileSync(`${__dirname}/../fakes/auth-admin.jsonl`, JSON.stringify({ id: admin[1], auth: req.headers.authorization }) + "\n");
    res.writeHead(200, { "content-type": "application/json", ...cors });
    return res.end("{}");
  }
  if (!req.url.startsWith("/rest/v1")) { res.writeHead(404); return res.end(); }
  const p = http.request({ host: "localhost", port: 3001, path: req.url.slice("/rest/v1".length) || "/", method: req.method, headers: { ...req.headers, host: "localhost:3001" } }, (r) => {
    res.writeHead(r.statusCode, r.headers);
    r.pipe(res);
  });
  req.pipe(p);
}).listen(3002, () => console.log("proxy on 3002"));
