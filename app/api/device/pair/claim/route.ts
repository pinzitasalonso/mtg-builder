import { NextResponse } from "next/server";
import { jsonBody } from "@/lib/api";
import { currentUser } from "@/lib/auth";
import { claimPairing, MAX_DEVICES_PER_USER } from "@/lib/device";
import { clientIp, rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";

// POST /api/device/pair/claim — you, signed in, type the code your dial
// shows. The dial becomes yours at its next poll. A guess-brake per account
// and per address: the code space is the game codes'.
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in to pair a dial.", code: "sign_in" }, { status: 401 });
  if (!rateLimit(`dial-claim:u${user.id}`, 10, 10 * 60_000) || !rateLimit(`dial-claim:${clientIp(req)}`, 20, 10 * 60_000)) {
    return NextResponse.json({ error: "Too many tries — wait a few minutes." }, { status: 429 });
  }
  const body = await jsonBody(req);
  const result = await claimPairing(user.id, body.code, body.name);
  if (result === "ok") return NextResponse.json({ ok: true });
  if (result === "too-many") return NextResponse.json({ error: `An account holds ${MAX_DEVICES_PER_USER} dials at most. Remove one first.` }, { status: 409 });
  if (result === "taken") return NextResponse.json({ error: "That code was already used. Restart pairing on the dial." }, { status: 409 });
  return NextResponse.json({ error: "No dial is showing that code. Check it, or restart pairing on the dial." }, { status: 404 });
}
