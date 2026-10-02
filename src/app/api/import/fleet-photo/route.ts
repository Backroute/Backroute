import { dbConfigured } from "@/lib/agent/db";
import { caller } from "@/lib/agent/user";
import { readFleetPhoto } from "@/lib/ai/fleet-photo";
import { aiConfigured } from "@/lib/ai/server";

export const maxDuration = 120;

const TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * A photo of the owner's fleet list, read into trucks and drivers (lib/ai/fleet-photo). Nothing is saved here: the
 * app shows the rows to check, and the owner saves them. The owner or a dispatcher only.
 */
export async function POST(request: Request) {
  if (!dbConfigured()) return Response.json({ error: "not_set_up" }, { status: 503 });
  const who = await caller(request);
  if (!who || who.me.role === "driver" || who.me.role === "bookkeeper") return Response.json({ error: "sign_in" }, { status: 401 });
  if (!aiConfigured()) return Response.json({ error: "ai_off" }, { status: 503 });
  const form = await request.formData().catch(() => null);
  const file = form?.get("photo");
  if (!file || typeof file === "string" || !TYPES.has(file.type) || file.size > 8 * 1024 * 1024) return Response.json({ error: "bad_photo" }, { status: 400 });
  try {
    return Response.json(await readFleetPhoto(Buffer.from(await file.arrayBuffer()), file.type as "image/jpeg" | "image/png" | "image/webp"));
  } catch (e) {
    console.error("[import] fleet photo failed", e);
    return Response.json({ error: "read_failed" }, { status: 500 });
  }
}
