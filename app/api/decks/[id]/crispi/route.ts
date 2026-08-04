import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { accessibleDeckByPublicId, currentUser } from "@/lib/auth";
import { classify } from "@/lib/crispi-classify";
import {
  bracketFloor,
  consistencyScore,
  crispiScore,
  interactionScore,
  resilienceScore,
  speedFromFundamentalTurn,
} from "@/lib/crispi";

export const runtime = "nodejs";

// CRISPI for a deck — Consistency, Resilience, Interaction, Speed, and the
// Performance Index that averages them. DeckCheck's published rubrics, run over
// this deck's rows.
//
// PROVISIONAL, AND THE RESPONSE SAYS SO. The rubric maths in lib/crispi.ts is
// faithful and tested. What feeds it is not: card classification comes from
// oracle-text patterns rather than a curated database, and three inputs are not
// computed at all. `provisional` is true and `notes` names every estimate and
// every stub, so a client can label the number rather than presenting it as a
// verdict. Do not render this score without surfacing that.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await currentUser();
  const deck = await accessibleDeckByPublicId((await params).id, user?.id ?? null);
  if (!deck) return NextResponse.json({ error: "deck not found" }, { status: 404 });

  // The DECK board only. The pool is candidates, and scoring a pile of
  // maybes would describe a deck nobody is playing.
  const cards = await prisma.poolCard.findMany({
    where: { deckId: deck.id, board: "deck" },
    select: { name: true, typeLine: true, oracleText: true, manaCost: true, quantity: true },
  });

  if (cards.length === 0) {
    return NextResponse.json({ error: "deck has no cards on the deck board" }, { status: 422 });
  }

  const parts = classify(cards);
  const consistency = consistencyScore(parts.consistency);
  const interaction = interactionScore(parts.interaction);
  const resilience = resilienceScore(parts.resilience);
  const speed = speedFromFundamentalTurn(parts.fundamentalTurn);

  const result = crispiScore({ consistency, resilience, interaction, speed });

  return NextResponse.json({
    ...result,
    // Only ever bumps a deck UP, so a rules bracket of 1 is a safe floor to
    // pass when the caller has not computed one.
    bracketFloor: bracketFloor(result, 1),
    averageManaValue: Number(parts.averageManaValue.toFixed(2)),
    cardsScored: cards.reduce((n, c) => n + Math.max(1, c.quantity), 0),
    provisional: true,
    notes: parts.notes,
  });
}
