import { supabase } from "./client";

export type Role = "owner" | "dispatcher" | "driver";

/** One carrier this person belongs to, and as whom. */
export interface Membership {
  carrierId: string;
  role: Role;
  /** The driver row this person is: set for drivers and owner-operators. */
  driverId: string | null;
  carrierName: string;
  ownerOperator: boolean;
}

/** Turns any invites waiting for this phone number into memberships. Safe to call on every sign-in. */
export async function claimInvites(): Promise<number> {
  const { data, error } = await supabase().rpc("claim_invites");
  if (error) throw error;
  return (data as number) ?? 0;
}

export async function myMemberships(): Promise<Membership[]> {
  const db = supabase();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return [];
  const { data, error } = await db
    .from("members")
    .select("carrier_id, role, driver_id, carriers(name, owner_operator)")
    .eq("user_id", auth.user.id)
    .order("created_at");
  if (error) throw error;
  return (data ?? []).map((m) => {
    const c = (Array.isArray(m.carriers) ? m.carriers[0] : m.carriers) as { name: string; owner_operator: boolean } | null;
    return { carrierId: m.carrier_id, role: m.role as Role, driverId: m.driver_id, carrierName: c?.name ?? "", ownerOperator: !!c?.owner_operator };
  });
}

/** Where someone lands after signing in: drivers and owner-operators get the app, the office gets the dashboard. */
export function homeFor(m: Membership): "/driver" | "/carrier" {
  return m.role === "driver" || (m.ownerOperator && m.driverId) ? "/driver" : "/carrier";
}

/** Sign-up: creates the carrier with the signed-in person as its owner. */
export async function createCarrierAccount(p: { name: string; mc: string; dot: string; ownerOperator: boolean; driverId: string | null }): Promise<Membership> {
  const id = crypto.randomUUID();
  const { error } = await supabase().rpc("create_carrier", {
    p_id: id,
    p_name: p.name,
    p_mc: p.mc,
    p_dot: p.dot,
    p_owner_operator: p.ownerOperator,
    p_driver_id: p.driverId,
  });
  if (error) throw error;
  return { carrierId: id, role: "owner", driverId: p.driverId, carrierName: p.name, ownerOperator: p.ownerOperator };
}

/** Lets a driver (or dispatcher) sign in with their own phone number. They see only what their role allows. */
export async function invite(carrierId: string, phone: string, role: Role, driverId: string | null) {
  const { error } = await supabase().from("invites").upsert({ carrier_id: carrierId, phone, role, driver_id: driverId }, { onConflict: "carrier_id,phone" });
  if (error) throw error;
}

/** Everyone who can sign in to this carrier, and the invites nobody has used yet. Owners only. */
export async function team(carrierId: string) {
  const db = supabase();
  const [members, invites] = await Promise.all([
    db.from("members").select("user_id, role, driver_id").eq("carrier_id", carrierId),
    db.from("invites").select("phone, role, driver_id").eq("carrier_id", carrierId),
  ]);
  if (members.error) throw members.error;
  if (invites.error) throw invites.error;
  return { members: members.data ?? [], invites: invites.data ?? [] };
}
