import { NextResponse } from "next/server";
import { gameChangerNames } from "@/lib/gamechangers";

export const runtime = "nodejs";

// The Game Changer name list, so a deck page can work out its bracket without
// every visitor's browser hitting Scryfall. Cached in-process for a day; the
// list changes when Wizards updates it, which is a few times a year.
//
// Public on purpose: it is a published card list with nothing account-specific
// in it, and a signed-out player reading a shared deck should see the same
// bracket the owner does.
export async function GET() {
  const names = await gameChangerNames();
  return NextResponse.json(
    { names },
    // A stale-while-revalidate hint for any CDN in front of this; the real
    // cache is the module-level one behind gameChangerNames.
    { headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" } }
  );
}
