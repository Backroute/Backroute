import { admin, dbConfigured } from "@/lib/agent/db";
import { validMediaLink } from "@/lib/channels/voice-notes";

/**
 * The AI's spoken answer to a driver's voice message, for WhatsApp to fetch and deliver. The link is signed and
 * lasts two hours; only spoken answers can be opened this way, nothing else a carrier keeps.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(request.url);
  if (!dbConfigured() || !validMediaLink(id, url.searchParams.get("e"), url.searchParams.get("s"))) return new Response("Not found", { status: 404 });
  const { data } = await admin().from("carrier_files").select("content_type, data").eq("id", id).eq("kind", "voice_reply").maybeSingle();
  if (!data) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(Buffer.from(data.data as string, "base64")), { headers: { "content-type": data.content_type as string, "cache-control": "private, max-age=600" } });
}
