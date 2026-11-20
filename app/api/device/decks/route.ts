import { NextResponse } from "next/server";
import { decksForDevice, deviceFromRequest } from "@/lib/device";
import { jsonWithEtag } from "@/lib/http-cache";
import { clientIp, rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";

// GET /api/device/decks — the decks sent to this dial, with what its
// screens show. Signed with the dial's token. Sent with an ETag: a sync that
// finds nothing new costs a 304.
export async function GET(req: Request) {
  if (!rateLimit(`dial:${clientIp(req)}`, 120, 60_000)) return NextResponse.json({ error: "too many requests" }, { status: 429 });
  const device = await deviceFromRequest(req);
  if (!device) return NextResponse.json({ error: "unknown dial — pair it again", code: "unpaired" }, { status: 401 });
  return jsonWithEtag(req, { device: { id: device.id, name: device.name }, player: device.player, decks: await decksForDevice(device.id) });
}
