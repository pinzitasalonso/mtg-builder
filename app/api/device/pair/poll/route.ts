import { NextResponse } from "next/server";
import { jsonBody } from "@/lib/api";
import { pollPairing } from "@/lib/device";
import { clientIp, rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";

// POST /api/device/pair/poll — the dial asks whether its code was claimed.
// 202 while it waits, 200 with its token once (and only once), 404 when the
// code expired or the secret isn't its own. A dial polls every few seconds
// for ten minutes at most.
export async function POST(req: Request) {
  if (!rateLimit(`dial-pair-poll:${clientIp(req)}`, 90, 60_000)) {
    return NextResponse.json({ error: "too many requests" }, { status: 429 });
  }
  const body = await jsonBody(req);
  const result = await pollPairing(body.code, body.secret);
  if (result.status === "pending") return NextResponse.json({ status: "pending" }, { status: 202 });
  if (result.status === "gone") return NextResponse.json({ error: "pairing code expired — start again" }, { status: 404 });
  return NextResponse.json(result);
}
