import "server-only";
import crypto from "node:crypto";
import { admin } from "../agent/db";

/**
 * The carrier's logins to other companies' websites (a broker's setup portal, a load board's scheduling site), and
 * answers the owner gave the AI for them (a bank routing number, how many trucks). Every secret is encrypted here,
 * before it reaches the database, with AES-256-GCM and a key only the server has (PORTAL_VAULT_KEY: 32 random bytes,
 * base64). Each one is tied to its carrier, kind and site, so a secret copied to another row won't open. The owner
 * sees the site and user name, never the password; the AI never sees a secret at all: it writes a placeholder
 * ({{password}}) and the worker gets the real value for that one field, and only on that website.
 *
 * To change the key: set the new one as PORTAL_VAULT_KEY and the old as PORTAL_VAULT_KEY_OLD. Everything still
 * opens, and each secret is re-sealed with the new key the next time it's used.
 */

const keyFrom = (v: string | undefined) => {
  if (!v) return null;
  const k = Buffer.from(v.trim(), /^[0-9a-f]{64}$/i.test(v.trim()) ? "hex" : "base64");
  return k.length === 32 ? k : null;
};
const key = () => keyFrom(process.env.PORTAL_VAULT_KEY);
export const vaultConfigured = () => key() !== null;

const b64 = (b: Buffer) => b.toString("base64url");

/** Encrypts a secret for one row ("carrier|kind|site"). */
export function seal(plain: string, bind: string): string {
  const k = key();
  if (!k) throw new Error("PORTAL_VAULT_KEY isn't set (32 random bytes, base64).");
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", k, iv);
  c.setAAD(Buffer.from(bind));
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1.${b64(iv)}.${b64(c.getAuthTag())}.${b64(body)}`;
}

/** Decrypts a secret sealed for this row; null when it can't be (wrong row, wrong key, tampered). */
export function open(sealed: string, bind: string): { value: string; stale: boolean } | null {
  const [v, iv, tag, body] = sealed.split(".");
  if (v !== "v1" || !iv || !tag || !body) return null;
  for (const [k, stale] of [
    [key(), false],
    [keyFrom(process.env.PORTAL_VAULT_KEY_OLD), true],
  ] as const) {
    if (!k) continue;
    try {
      const d = crypto.createDecipheriv("aes-256-gcm", k, Buffer.from(iv, "base64url"));
      d.setAAD(Buffer.from(bind));
      d.setAuthTag(Buffer.from(tag, "base64url"));
      return { value: Buffer.concat([d.update(Buffer.from(body, "base64url")), d.final()]).toString("utf8"), stale };
    } catch {
      // Not this key: try the old one.
    }
  }
  return null;
}

/** "https://www.MyCarrierPackets.com/x" → "mycarrierpackets.com". */
export function siteOf(url: string): string | null {
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    return u.hostname.toLowerCase().replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

/** Whether a page on `host` is that site (or one of its subdomains, e.g. login.rmis.com for rmis.com). */
export const onSite = (host: string, site: string) => host === site || host.endsWith(`.${site}`);

const bindOf = (carrierId: string, kind: "login" | "fact", site: string, field: "secret" | "totp" = "secret") => `${carrierId}|${kind}|${site}|${field}`;

export interface LoginSummary {
  id: string;
  site: string;
  label: string;
  username: string | null;
  twoStep: boolean;
  updatedAt: string;
  lastUsedAt: string | null;
}

/** The carrier's logins and saved answers as the owner may see them: never the secrets. */
export async function listVault(carrierId: string): Promise<{ logins: LoginSummary[]; answers: { id: string; key: string; label: string; updatedAt: string }[] }> {
  const { data, error } = await admin().from("portal_logins").select("id, kind, site, label, username, totp, updated_at, last_used_at").eq("carrier_id", carrierId).order("updated_at", { ascending: false });
  if (error) throw error;
  const rows = data ?? [];
  return {
    logins: rows.filter((r) => r.kind === "login").map((r) => ({ id: r.id as string, site: r.site as string, label: r.label as string, username: (r.username as string | null) ?? null, twoStep: !!r.totp, updatedAt: r.updated_at as string, lastUsedAt: (r.last_used_at as string | null) ?? null })),
    answers: rows.filter((r) => r.kind === "fact").map((r) => ({ id: r.id as string, key: r.site as string, label: r.label as string, updatedAt: r.updated_at as string })),
  };
}

/** Adds or replaces the login for a website. */
export async function saveLogin(carrierId: string, l: { site: string; label?: string; username: string; password: string; totp?: string | null; by?: string }) {
  const site = siteOf(l.site);
  if (!site) throw new Error("bad_site");
  const now = new Date().toISOString();
  const totp = l.totp?.replace(/\s+/g, "").toUpperCase() || null;
  const { error } = await admin()
    .from("portal_logins")
    .upsert(
      { id: `pl_${carrierId}_login_${site}`.slice(0, 200), carrier_id: carrierId, kind: "login", site, label: l.label?.trim() || site, username: l.username.trim(), secret: seal(l.password, bindOf(carrierId, "login", site)), totp: totp ? seal(totp, bindOf(carrierId, "login", site, "totp")) : null, created_by: l.by ?? null, updated_at: now },
      { onConflict: "carrier_id,kind,site" },
    );
  if (error) throw error;
  return site;
}

/** Keeps an answer the owner gave (or a value the AI must reuse), sealed like a password. */
export async function saveAnswer(carrierId: string, a: { key: string; label: string; value: string; by?: string }) {
  const k = a.key.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "answer";
  const { error } = await admin()
    .from("portal_logins")
    .upsert({ id: `pl_${carrierId}_fact_${k}`.slice(0, 200), carrier_id: carrierId, kind: "fact", site: k, label: a.label.slice(0, 200), secret: seal(a.value, bindOf(carrierId, "fact", k)), created_by: a.by ?? null, updated_at: new Date().toISOString() }, { onConflict: "carrier_id,kind,site" });
  if (error) throw error;
  return k;
}

export async function forget(carrierId: string, id: string) {
  const { error } = await admin().from("portal_logins").delete().eq("carrier_id", carrierId).eq("id", id);
  if (error) throw error;
}

export interface OpenLogin {
  site: string;
  username: string | null;
  password: string;
  totp: string | null;
}

/** The login for the website a page is on, decrypted: only for the worker's current step on that same site. */
export async function loginFor(carrierId: string, host: string): Promise<OpenLogin | null> {
  const { data, error } = await admin().from("portal_logins").select("id, site, username, secret, totp").eq("carrier_id", carrierId).eq("kind", "login");
  if (error) throw error;
  // The most specific site that matches (login.rmis.com before rmis.com).
  const row = (data ?? []).filter((r) => onSite(host, r.site as string)).sort((a, b) => (b.site as string).length - (a.site as string).length)[0];
  if (!row) return null;
  const site = row.site as string;
  const pw = open(row.secret as string, bindOf(carrierId, "login", site));
  if (!pw) return null;
  const totp = row.totp ? open(row.totp as string, bindOf(carrierId, "login", site, "totp")) : null;
  const patch: Record<string, unknown> = { last_used_at: new Date().toISOString() };
  // Opened with the old key: sealed again with the new one.
  if (pw.stale) patch.secret = seal(pw.value, bindOf(carrierId, "login", site));
  if (totp?.stale) patch.totp = seal(totp.value, bindOf(carrierId, "login", site, "totp"));
  await admin().from("portal_logins").update(patch).eq("id", row.id);
  return { site, username: (row.username as string | null) ?? null, password: pw.value, totp: totp?.value ?? null };
}

/** Whether there's a login for a site, without opening it. */
export async function hasLogin(carrierId: string, host: string): Promise<{ site: string; username: string | null; twoStep: boolean } | null> {
  const { data } = await admin().from("portal_logins").select("site, username, totp").eq("carrier_id", carrierId).eq("kind", "login");
  const row = (data ?? []).filter((r) => onSite(host, r.site as string)).sort((a, b) => (b.site as string).length - (a.site as string).length)[0];
  return row ? { site: row.site as string, username: (row.username as string | null) ?? null, twoStep: !!row.totp } : null;
}

/** The saved answers' keys and what they are (for the AI), without the values. */
export async function answerKeys(carrierId: string): Promise<{ key: string; label: string }[]> {
  const { data } = await admin().from("portal_logins").select("site, label").eq("carrier_id", carrierId).eq("kind", "fact");
  return (data ?? []).map((r) => ({ key: r.site as string, label: r.label as string }));
}

/** One saved answer, decrypted, for the worker's current step. */
export async function answerFor(carrierId: string, k: string): Promise<string | null> {
  const { data } = await admin().from("portal_logins").select("secret").eq("carrier_id", carrierId).eq("kind", "fact").eq("site", k).maybeSingle();
  return data ? (open(data.secret as string, bindOf(carrierId, "fact", k))?.value ?? null) : null;
}

/** A strong password for an account the AI opens on the carrier's behalf. */
export function newPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.randomBytes(18);
  const body = [...bytes].map((b) => chars[b % chars.length]).join("");
  // Most sites want a digit, an upper, a lower and a symbol.
  return `${body.slice(0, 16)}#7aQ`;
}

/** The 6-digit code from a 2-step key (RFC 6238: SHA-1, 30 seconds), the way an authenticator app makes it. */
export function totpCode(base32: string, at = Date.now()): string | null {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = base32.replace(/=+$/, "").replace(/\s+/g, "").toUpperCase();
  let bits = "";
  for (const ch of clean) {
    const v = alphabet.indexOf(ch);
    if (v < 0) return null;
    bits += v.toString(2).padStart(5, "0");
  }
  const bytes = Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)));
  if (!bytes.length) return null;
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const h = crypto.createHmac("sha1", bytes).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, "0");
}
