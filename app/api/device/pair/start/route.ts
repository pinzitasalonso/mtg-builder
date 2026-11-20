import { NextResponse } from "next/server";
import { jsonBody } from "@/lib/api";
import { PAIRING_POLL_SECONDS, startPairing } from "@/lib/device";
import { clientIp, rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";

// POST /api/device/pair/start — a dial asks to be paired. No account yet: it
// gets a code to show and a secret to collect its token with. A dial asks
// once when it's set up, so a handful per address is plenty.
export async function POST(req: Request) {
  if (!rateLimit(`dial-pair-start:${clientIp(req)}`, 10, 10 * 60_000)) {
    return NextResponse.json({ error: "too many pairing codes — try again in a few minutes" }, { status: 429 });
  }
  const body = await jsonBody(req);
  const made = await startPairing(body.firmware);
  if (!made) return NextResponse.json({ error: "could not make a pairing code" }, { status: 500 });
  return NextResponse.json({
    code: made.code,
    secret: made.secret,
    expiresIn: Math.round((made.expiresAt.getTime() - Date.now()) / 1000),
    pollEvery: PAIRING_POLL_SECONDS,
    // Where its owner types the code.
    url: "spellpool.com/dial",
  });
}
