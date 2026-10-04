"use client";

import { supabase } from "./client";

/**
 * Two-step sign-in and the devices someone is signed in on. Two-step uses an authenticator app (Google
 * Authenticator, 1Password, Authy): after the texted code, a 6-digit code from the app. Once it's on, the database
 * itself keeps the account's data out of reach of a session that hasn't entered it (migration 20261012000000).
 */

export interface TwoStepFactor {
  id: string;
  name: string;
  verified: boolean;
  createdAt: string;
}

export async function twoStepFactors(): Promise<TwoStepFactor[]> {
  const { data, error } = await supabase().auth.mfa.listFactors();
  if (error) throw error;
  return (data?.totp ?? []).map((f) => ({ id: f.id, name: f.friendly_name ?? "Authenticator app", verified: f.status === "verified", createdAt: f.created_at }));
}

/** Signed in with the text code, but the account has two-step on and this session hasn't passed it. */
export async function needsSecondStep(): Promise<boolean> {
  const { data } = await supabase().auth.mfa.getAuthenticatorAssuranceLevel();
  return data?.nextLevel === "aal2" && data.currentLevel !== "aal2";
}

/** The code from the authenticator app, for this sign-in. */
export async function passSecondStep(code: string): Promise<boolean> {
  const factor = (await twoStepFactors()).find((f) => f.verified);
  if (!factor) return true;
  const { error } = await supabase().auth.mfa.challengeAndVerify({ factorId: factor.id, code: code.trim() });
  return !error;
}

/** Starts turning it on: the QR code (an image) and the key to type in by hand. */
export async function startTwoStep(): Promise<{ factorId: string; qr: string; secret: string }> {
  // A half-finished one from before is cleared first: Supabase allows one unverified app at a time per name.
  for (const f of await twoStepFactors()) if (!f.verified) await supabase().auth.mfa.unenroll({ factorId: f.id });
  const { data, error } = await supabase().auth.mfa.enroll({ factorType: "totp", friendlyName: `Authenticator ${new Date().toISOString().slice(0, 10)}` });
  if (error || !data) throw error ?? new Error("enroll");
  return { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
}

/** The first code from the app proves it's set up; from then on it's asked for at each sign-in. */
export async function confirmTwoStep(factorId: string, code: string): Promise<boolean> {
  const { error } = await supabase().auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
  return !error;
}

export async function turnOffTwoStep(factorId: string): Promise<boolean> {
  const { error } = await supabase().auth.mfa.unenroll({ factorId });
  return !error;
}

// ─── Devices ─────────────────────────────────────────────────────────────────

const DEVICE_KEY = "backroute.device";

function deviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = `dev_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return "dev_unknown_browser";
  }
}

/** "Chrome on Mac", "Safari on iPhone". */
function deviceLabel(ua = typeof navigator === "undefined" ? "" : navigator.userAgent): string {
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "a device";
  const browser = /Edg\//.test(ua) ? "Edge" : /CriOS|Chrome\//.test(ua) ? "Chrome" : /FxiOS|Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const standalone = typeof window !== "undefined" && window.matchMedia?.("(display-mode: standalone)").matches;
  return `${standalone ? "Backroute app" : browser} on ${os}`;
}

/** Notes this device as signed in (once a session is up). */
export async function registerDevice(): Promise<void> {
  const id = deviceId();
  await supabase()
    .from("devices")
    .upsert({ id, label: deviceLabel(), last_seen_at: new Date().toISOString() }, { onConflict: "user_id,id" })
    .then(() => undefined, () => undefined);
}

export interface Device {
  id: string;
  label: string;
  lastSeenAt: string;
  createdAt: string;
  current: boolean;
}

export async function listDevices(): Promise<Device[]> {
  const mine = deviceId();
  const { data, error } = await supabase().from("devices").select("id, label, last_seen_at, created_at").order("last_seen_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((d) => ({ id: d.id as string, label: d.label as string, lastSeenAt: d.last_seen_at as string, createdAt: d.created_at as string, current: d.id === mine }));
}

/** Signs out everywhere but here: the other sessions can't renew, and they drop off the list. */
export async function signOutOthers(): Promise<boolean> {
  const { error } = await supabase().auth.signOut({ scope: "others" });
  if (error) return false;
  await supabase().from("devices").delete().neq("id", deviceId());
  return true;
}
