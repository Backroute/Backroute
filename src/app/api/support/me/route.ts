import { dbConfigured } from "@/lib/agent/db";
import { supportCaller } from "@/lib/agent/support";

/** Whether the signed-in person is on Backroute's support team. */
export async function GET(request: Request) {
  if (!dbConfigured()) return Response.json({ support: false });
  const me = await supportCaller(request);
  return Response.json(me ? { support: true, name: me.name } : { support: false });
}
