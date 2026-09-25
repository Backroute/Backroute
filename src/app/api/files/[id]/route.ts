import { caller } from "@/lib/agent/user";

/** Opens a stored file for someone allowed to see it (the access rules decide), e.g. the POD on a load page. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const who = await caller(request);
  if (!who) return new Response("Sign in", { status: 401 });
  const { data } = await who.db.from("carrier_files").select("name, content_type, data").eq("id", id).maybeSingle();
  if (!data) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(data.data as string, "base64"), {
    headers: { "content-type": data.content_type as string, "content-disposition": `inline; filename="${String(data.name).replace(/"/g, "")}"` },
  });
}
