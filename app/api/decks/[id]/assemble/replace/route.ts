import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { extractJson, messageText } from "@/lib/ai";
import { jsonBody } from "@/lib/api";
import { applyReplacements, cleanSwaps, legalIn, REPLACE_INSTRUCTIONS, REPLACE_SCHEMA, replaceContext, replacePrompt, type Swap } from "@/lib/assemble-replace";
import { accessibleDeckByPublicId, currentUser } from "@/lib/auth";
import { AI_LIMIT_MSG } from "@/lib/limits";
import { consumeAi, refundAi } from "@/lib/limits-db";
import { rateLimit } from "@/lib/ratelimit";
import { lookupCollection, normalizeCardKey as key } from "@/lib/scryfall";

export const runtime = "nodejs";

/* "Replace what I haven't found", from Assemble deck. Two steps, one address:

   POST {}                          → a plan: for each card of the deck that
                                      isn't ticked, a card from the player's
                                      collection to play instead (the model
                                      picks; it costs one AI ask).
   POST { swaps, as }               → make the swaps the player kept, in this
                                      deck ("deck": the list as it is now is
                                      saved as a version first) or in a new
                                      one ("copy").

   Only for the deck's owner: it is their collection the cards come from. */

/** A swap as the review screen shows it: the replacement with its picture. */
export interface PlannedSwap extends Swap {
  imageUri: string | null;
  typeLine: string | null;
  manaCost: string | null;
}

export interface ReplacePlan {
  swaps: PlannedSwap[];
  /** Missing cards nothing in the collection was found for. They stay. */
  unmatched: string[];
}

// Looking again costs an ask each time; this only stops a stuck button.
const PLANS_PER_10_MIN = 6;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in to do this.", code: "sign_in" }, { status: 401 });
  const deck = await accessibleDeckByPublicId((await params).id, user.id);
  if (!deck || deck.userId !== user.id) return NextResponse.json({ error: "deck not found" }, { status: 404 });
  const body = await jsonBody(req);

  if (Array.isArray(body.swaps)) {
    const wanted = (body.swaps as unknown[])
      .filter((s): s is { outId: number; in: string } => !!s && typeof s === "object" && Number.isInteger((s as { outId?: unknown }).outId) && typeof (s as { in?: unknown }).in === "string")
      .slice(0, 250)
      .map((s) => ({ outId: s.outId, in: s.in.slice(0, 200) }));
    const result = await applyReplacements(deck, user.id, wanted, body.as === "copy" ? "copy" : "deck");
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result, { status: body.as === "copy" ? 201 : 200 });
  }

  const ctx = await replaceContext(deck, user.id);
  if (!ctx.missing.length) return NextResponse.json({ error: "There's nothing to replace: every card that could be is ticked." }, { status: 400 });
  if (!ctx.collectionSize) {
    return NextResponse.json({ error: "Your collection is empty. Import it first, and the replacements come from there.", code: "no_collection" }, { status: 400 });
  }
  const names = ctx.missing.map((m) => m.name);
  // Nothing spare that fits this deck: no need to ask anyone.
  if (!ctx.candidates.length) return NextResponse.json({ swaps: [], unmatched: names } satisfies ReplacePlan);
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "The AI isn't set up on this server." }, { status: 503 });
  if (!rateLimit(`replace:${user.id}`, PLANS_PER_10_MIN, 10 * 60_000)) return NextResponse.json({ error: "That's a lot of looking. Wait a few minutes." }, { status: 429 });
  if (!(await consumeAi(user))) return NextResponse.json({ error: AI_LIMIT_MSG, code: "ai_limit" }, { status: 429 });

  let swaps: Swap[];
  try {
    const anthropic = new Anthropic();
    const res = await anthropic.messages.create(
      {
        model: "claude-opus-5-5",
        // A line for each missing card, after the thinking that picks it.
        max_tokens: 16000,
        output_config: { effort: "medium", format: { type: "json_schema", schema: REPLACE_SCHEMA } },
        system: [{ type: "text", text: REPLACE_INSTRUCTIONS, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: replacePrompt(ctx) }],
      },
      // One try: the player is watching a spinner, and a second slow answer
      // is worse than being told to try again.
      { timeout: 150_000, maxRetries: 0 }
    );
    console.log(
      `[replace] deck=${deck.publicId} missing=${ctx.missing.length} offered=${ctx.candidates.length} stop=${res.stop_reason} in=${res.usage.input_tokens} out=${res.usage.output_tokens}`
    );
    if (res.stop_reason !== "end_turn") throw new Error(`stopped: ${res.stop_reason}`);
    swaps = cleanSwaps(extractJson(messageText(res)), ctx);
  } catch (e) {
    // An ask that gave nothing isn't one the player used.
    await refundAi(user).catch(() => {});
    console.error("[replace] failed", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Couldn't find replacements just now. Nothing was changed, and it didn't count as an AI ask. Try again." }, { status: 502 });
  }

  // The replacements as real cards: their pictures for the review, and a
  // check that the format allows them (the collection doesn't know). When
  // Scryfall is down the plan still stands; making it checks again.
  const found = swaps.length ? await lookupCollection(swaps.map((s) => s.in)).catch(() => null) : null;
  const planned: PlannedSwap[] = [];
  for (const s of swaps) {
    const card = found?.found.get(key(s.in)) ?? null;
    if (card && !legalIn(card, ctx.format, ctx.identity)) continue;
    planned.push({ ...s, imageUri: card?.imageUri ?? null, typeLine: card?.typeLine ?? null, manaCost: card?.manaCost ?? null });
  }
  const replaced = new Set(planned.map((s) => s.outId));
  return NextResponse.json({ swaps: planned, unmatched: ctx.missing.filter((m) => !replaced.has(m.id)).map((m) => m.name) } satisfies ReplacePlan);
}
