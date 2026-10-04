// Stands in for Supabase's gateway: /rest/v1 → PostgREST, /auth/v1/user → the user in the bearer token.
const http = require("http");
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
  if (!req.url.startsWith("/rest/v1")) { res.writeHead(404); return res.end(); }
  const p = http.request({ host: "localhost", port: 3001, path: req.url.slice("/rest/v1".length) || "/", method: req.method, headers: { ...req.headers, host: "localhost:3001" } }, (r) => {
    res.writeHead(r.statusCode, r.headers);
    r.pipe(res);
  });
  req.pipe(p);
}).listen(3002, () => console.log("proxy on 3002"));
