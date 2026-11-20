import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { dialsOf } from "@/lib/device";

export const runtime = "nodejs";

// GET /api/dials — your Spellpool Dials, and which decks are on each.
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "auth required" }, { status: 401 });
  return NextResponse.json({ dials: await dialsOf(user.id) });
}
