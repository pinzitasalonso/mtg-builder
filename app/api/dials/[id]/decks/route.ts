import { NextResponse } from "next/server";
import { jsonBody, parseId } from "@/lib/api";
import { currentUser } from "@/lib/auth";
import { MAX_DECKS_PER_DEVICE, setDeckOnDial } from "@/lib/device";

export const runtime = "nodejs";

// POST /api/dials/<id>/decks { deck, on } — send one of your decks to a
// dial, or take it off. The dial picks the change up at its next sync.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "auth required" }, { status: 401 });
  const id = parseId((await params).id);
  const body = await jsonBody(req);
  const deck = typeof body.deck === "string" ? body.deck : "";
  const result = id === null ? "no-dial" : await setDeckOnDial(user.id, id, deck, body.on !== false);
  if (result === "ok") return NextResponse.json({ ok: true });
  if (result === "full") return NextResponse.json({ error: `A dial holds ${MAX_DECKS_PER_DEVICE} decks. Take one off first.` }, { status: 409 });
  return NextResponse.json({ error: result === "no-dial" ? "dial not found" : "deck not found" }, { status: 404 });
}
