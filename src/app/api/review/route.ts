import { dbConfigured } from "@/lib/agent/db";
import { caller } from "@/lib/agent/user";
import { latestReview } from "@/lib/agent/review";

/** The owner's latest weekly review, for Home. */
export async function GET(request: Request) {
  if (!dbConfigured()) return Response.json({ review: null });
  const who = await caller(request);
  if (!who || who.me.role === "driver" || who.me.role === "bookkeeper") return Response.json({ error: "sign_in" }, { status: 401 });
  return Response.json({ review: await latestReview(who.me.carrierId) });
}
