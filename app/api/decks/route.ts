import { NextResponse } from "next/server";
import { DECK_TEXT_MAX, jsonBody } from "@/lib/api";
import { jsonWithEtag } from "@/lib/http-cache";
import prisma from "@/lib/prisma";
import { currentUser } from "@/lib/auth";
import { newPublicId } from "@/lib/deck-id";
import { backfillPublicIds, tileDecks } from "@/lib/deck-list";
import { SIGN_IN_FOR_DECKS_MSG } from "@/lib/limits";
import { recordEvent } from "@/lib/analytics";
import { sweepEmptyPublicDecks } from "@/lib/public-sweep";
import { pickPublicBrews } from "@/lib/public-brews";

// Public decks (userId null) are listed for everyone; signed-in users see
// their own private decks by default. ?public=1 forces the public gallery
// (used for the "public brews" section while signed in).
export async function GET(req: Request) {
  const user = await currentUser();
  await backfillPublicIds();
  const wantPublic = new URL(req.url).searchParams.get("public") === "1";
  const listingPublic = !(user && !wantPublic);
  if (listingPublic) sweepEmptyPublicDecks();
  const decks = await prisma.deck.findMany({
    // The public gallery shows only decks with something in them: an empty
    // one is an abandoned start, not a brew (and the sweep deletes it after
    // a day).
    where: listingPublic ? { userId: null, cards: { some: {} } } : { userId: user!.id },
    orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
    // The public pool is cut down to its finished brews below, so read all
    // of it (it no longer grows: new decks need an account).
    take: listingPublic ? 1000 : 100,
  });
  const listed = await tileDecks(decks);
  if (!listingPublic) return jsonWithEtag(req, listed);
  // The public pool: only its finished brews, best first (lib/public-brews.ts).
  const brews = pickPublicBrews(
    listed.map((d) => ({ ...d, deckCount: d._count.cards, score: d.scan?.score ?? null })),
  );
  return jsonWithEtag(req, brews.map(({ deckCount: _n, score: _s, ...d }) => d));
}

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: SIGN_IN_FOR_DECKS_MSG, code: "sign_in" }, { status: 401 });
  const body = await jsonBody(req);
  const name = typeof body.name === "string" ? body.name.trim().slice(0, DECK_TEXT_MAX.name) : "";
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  const format = typeof body.format === "string" && body.format.trim() ? body.format.trim().slice(0, DECK_TEXT_MAX.format) : "commander";
  const commander = typeof body.commander === "string" && body.commander.trim() ? body.commander.trim().slice(0, DECK_TEXT_MAX.commander) : null;
  const deck = await prisma.deck.create({ data: { name, format, commander, userId: user.id, publicId: newPublicId() } });
  await recordEvent("deck_created");
  return NextResponse.json(deck, { status: 201 });
}
