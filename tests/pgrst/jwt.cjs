const crypto = require("crypto");
const [sub, phone] = process.argv.slice(2);
const b = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const body = `${b({ alg: "HS256", typ: "JWT" })}.${b({ sub, phone, role: "authenticated", aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 })}`;
const sig = crypto.createHmac("sha256", "backroute-local-test-secret-at-least-32-chars").update(body).digest("base64url");
process.stdout.write(`${body}.${sig}`);
