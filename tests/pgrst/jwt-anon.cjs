const crypto = require("crypto");
const b = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const body = `${b({ alg: "HS256", typ: "JWT" })}.${b({ role: "anon", exp: Math.floor(Date.now() / 1000) + 86400 * 365 })}`;
process.stdout.write(`${body}.${crypto.createHmac("sha256", "backroute-local-test-secret-at-least-32-chars").update(body).digest("base64url")}`);
