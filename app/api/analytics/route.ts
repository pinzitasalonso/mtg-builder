import { NextResponse } from "next/server";
import { CLIENT_EVENTS, EventType, recordEvent } from "@/lib/analytics";

export const runtime = "nodejs";

// Record a client event (e.g. a page visit). Accepts only a whitelisted event
// name and nothing else — no body data is stored, no identifiers are read.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const type = body?.type as EventType | undefined;
  if (!type || !CLIENT_EVENTS.has(type)) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  await recordEvent(type);
  return NextResponse.json({ ok: true });
}
