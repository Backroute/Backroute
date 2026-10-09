import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Addresses an owner types in (a load feed, a fuel or toll statement, a load board's search) are fetched by the
 * server, so they're held to the public internet: https, and a host that isn't this machine, the private network or
 * link-local (where cloud metadata lives). Each redirect is checked again. Outside production the test stand-ins on
 * http://localhost are allowed.
 */

export class UnsafeUrl extends Error {}

const v4 = (ip: string) => ip.split(".").map(Number);

/** This machine, a private or shared network, link-local, multicast or reserved: never fetched for an owner. */
export function privateAddress(ip: string): boolean {
  const mapped = ip.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return privateAddress(mapped[1]);
  if (isIP(ip) === 4) {
    const [a, b] = v4(ip);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  if (isIP(ip) === 6) {
    const s = ip.toLowerCase();
    return s === "::" || s === "::1" || /^f[cd]/.test(s) || /^fe[89ab]/.test(s) || /^ff/.test(s);
  }
  return true;
}

/** Throws UnsafeUrl when the address mustn't be fetched for an owner. */
export async function checkOwnerUrl(raw: string | URL, strict = process.env.NODE_ENV === "production"): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new UnsafeUrl("That isn't a web address.");
  }
  if (!strict) return u;
  if (u.protocol !== "https:") throw new UnsafeUrl("The address has to start with https://.");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (/^localhost$|\.localhost$|\.local$|\.internal$/i.test(host)) throw new UnsafeUrl("That address isn't on the public internet.");
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (!addresses.length) throw new UnsafeUrl("That address doesn't exist.");
  if (addresses.some(privateAddress)) throw new UnsafeUrl("That address isn't on the public internet.");
  return u;
}

/** fetch() for an owner's address, following up to three redirects, each one checked. */
export async function fetchOwnerUrl(raw: string, init: RequestInit = {}, strict = process.env.NODE_ENV === "production"): Promise<Response> {
  let url = await checkOwnerUrl(raw, strict);
  let req = init;
  for (let hop = 0; hop < 4; hop++) {
    const res = await fetch(url, { ...req, redirect: "manual" });
    const to = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!to) return res;
    url = await checkOwnerUrl(new URL(to, url), strict);
    // A 303 (and, as browsers do, a 301/302 after a POST) goes on as a GET without the body.
    if (res.status === 303 || ((res.status === 301 || res.status === 302) && (req.method ?? "GET").toUpperCase() === "POST")) req = { ...req, method: "GET", body: undefined };
  }
  throw new UnsafeUrl("Too many redirects.");
}
