import { createHash } from "node:crypto";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { accessibleDeckByPublicId, currentUser, viewableDeckByPublicId } from "@/lib/auth";
import { findCombos } from "@/lib/combos";

export const runtime = "nodejs";

// Combos this deck can assemble, via Commander Spellbook.
//
// The DECK board only, matching iOS: a combo you could build if you promoted
// three cards out of the pool is not a combo the deck has.
//
// Best-effort. Spellbook being slow or down returns an empty list, not an
// error — the deck page simply shows no combos, which is also what a deck
// without any looks like.
// A deck's combos, remembered for a while by its exact list: every view of a
// public deck used to ask Commander Spellbook again. Capped, oldest out
// first. A new list (one changed card) is a new entry.
const TTL_MS = 10 * 60_000;
const EMPTY_TTL_MS = 60_000;
const CACHE_MAX = 500;
const cache = new Map<string, { at: number; result: Awaited<ReturnType<typeof findCombos>> }>();
// Uncached lookups one address may start a minute.
const LOOKUPS_PER_MINUTE = 20;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await currentUser();
  const deck = await viewableDeckByPublicId((await params).id, user?.id ?? null);
  if (!deck) return NextResponse.json({ error: "deck not found" }, { status: 404 });

  const rows = await prisma.poolCard.findMany({
    where: { deckId: deck.id, board: "deck" },
    select: { name: true, quantity: true },
  });

  // Commanders are sent separately because Spellbook treats them as always
  // available rather than as cards that have to be drawn. The deck stores one
  // or two joined by " + ", the same form the iOS app writes.
  const commanderKeys = new Set(
    (deck.commander ?? "")
      .split("+")
      .map((n) => n.trim().toLowerCase())
      .filter(Boolean)
  );

  const cards = rows.map((r) => ({
    name: r.name,
    quantity: Math.max(1, r.quantity),
    isCommander: commanderKeys.has(r.name.trim().toLowerCase()),
  }));
  const key = createHash("sha256")
    .update(JSON.stringify(cards.map((c) => [c.name, c.quantity, c.isCommander]).sort()))
    .digest("hex");
  const hit = cache.get(key);
  // "No combos" is also what a Spellbook that's down looks like, so that
  // answer is only kept a minute.
  if (hit && Date.now() - hit.at < (hit.result.combos.length ? TTL_MS : EMPTY_TTL_MS)) return NextResponse.json(hit.result);
  // Past the limit: no combos shown, the same answer as when Spellbook is down.
  if (!rateLimit(`combos:${clientIp(req)}`, LOOKUPS_PER_MINUTE, 60_000)) return NextResponse.json({ combos: [], hasTwoCardCombo: false }, { status: 429 });

  const result = await findCombos(cards);
  cache.delete(key);
  cache.set(key, { at: Date.now(), result });
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
  return NextResponse.json(result);
}
