import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import prisma from "@/lib/prisma";
import { accessibleDeckByPublicId, currentUser, viewableDeckByPublicId } from "@/lib/auth";
import { findCombos } from "@/lib/combos";
import { gameChangerNames } from "@/lib/gamechangers";
import { suggestedBracket, BRACKET_NUMBER } from "@/lib/deck-insight";
import { cardFactsByIds } from "@/lib/scryfall";
import { manaValue, nameKey, type ScoredCard } from "@/lib/deck-score-classify";
import { scoreDeck } from "@/lib/deck-score-report";
import {
  ANALYSIS_INSTRUCTIONS,
  ANALYSIS_SCHEMA,
  MAX_NOTES_CHARS,
  MAX_PRIMER_CHARS,
  buildAnalysisPrompt,
  judgementFrom,
  parseAnalysis,
  type DeckScan,
} from "@/lib/deck-analysis";
import { SCAN_LIMIT_MSG } from "@/lib/limits";
import { consumeScan, refundScan } from "@/lib/limits-db";
import { extractJson, messageText } from "@/lib/ai";

export const runtime = "nodejs";

// A deck scan: the Score — Consistency, Resilience, Interaction, Speed, with
// the working under each axis — and the AI's written analysis, run on demand
// and stored on the deck.
//
// ON DEMAND, not on every visit. A scan is a Scryfall call, a Spellbook call,
// a few hundred goldfish hands and a model pass, and it is metered: one a day
// on the free plan, unlimited on Pro. GET reads what the last scan stored;
// POST runs a new one. The rubric half is deterministic, so a re-scan of an
// unchanged list moves only where the analysis and the judgement do.
//
// The meter is spent before the model runs and given back if the analysis
// fails — a scan that produced nothing is not one the player used.

/** The stored scan, or null when the deck has never been scanned. */
function readStored(raw: string | null): DeckScan | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as DeckScan;
    return parsed && typeof parsed === "object" && parsed.score && typeof parsed.score.index === "number" ? parsed : null;
  } catch {
    return null;
  }
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await currentUser();
  const deck = await viewableDeckByPublicId((await params).id, user?.id ?? null);
  if (!deck) return NextResponse.json({ error: "deck not found" }, { status: 404 });
  return NextResponse.json({ scan: readStored(deck.analysis) });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "sign in to scan a deck" }, { status: 401 });
  // Edit access: scanning writes to the deck.
  const deck = await accessibleDeckByPublicId((await params).id, user.id);
  if (!deck) return NextResponse.json({ error: "deck not found" }, { status: 404 });
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "AI is not configured." }, { status: 503 });
  }

  const body = await req.json().catch(() => ({}));
  // What guides the analysis: the player's notes if they wrote any, else the
  // deck's primer — which already says how the deck plays, so a deck with
  // one is never asked to describe itself again.
  const typed = typeof body?.notes === "string" ? body.notes.trim().slice(0, MAX_NOTES_CHARS) : "";
  const primer = (deck.primer ?? "").trim().slice(0, MAX_PRIMER_CHARS);
  const notes = typed || primer;
  const source: DeckScan["source"] = typed ? "notes" : primer ? "primer" : null;

  // The DECK board only. The pool is candidates, and scoring a pile of
  // maybes would describe a deck nobody is playing.
  const rows = await prisma.poolCard.findMany({
    where: { deckId: deck.id, board: "deck" },
    select: { scryfallId: true, name: true, typeLine: true, oracleText: true, manaCost: true, quantity: true },
    orderBy: { name: "asc" },
  });
  if (rows.length < 40) {
    return NextResponse.json({ error: "Promote at least 40 cards to the deck before scanning it." }, { status: 422 });
  }

  if (!(await consumeScan(user))) {
    return NextResponse.json({ error: SCAN_LIMIT_MSG, code: "scan_limit" }, { status: 429 });
  }

  try {
    const commanderKeys = new Set(
      (deck.commander ?? "")
        .split("+")
        .map((n) => nameKey(n))
        .filter(Boolean)
    );
    const [facts, combos, changers] = await Promise.all([
      cardFactsByIds(rows.map((r) => r.scryfallId)),
      findCombos(
        rows.map((r) => ({
          name: r.name,
          quantity: Math.max(1, r.quantity),
          isCommander: commanderKeys.has(nameKey(r.name)),
        }))
      ),
      gameChangerNames(),
    ]);

    const cards: ScoredCard[] = rows.map((r) => {
      const f = facts.get(r.scryfallId);
      return {
        name: r.name,
        typeLine: f?.typeLine ?? r.typeLine ?? "",
        oracleText: f?.oracleText ?? r.oracleText ?? "",
        manaCost: f?.manaCost ?? r.manaCost,
        manaValue: f ? f.manaValue : manaValue(r.manaCost),
        quantity: Math.max(1, r.quantity),
        power: f?.power ?? null,
        toughness: f?.toughness ?? null,
        keywords: f?.keywords ?? [],
        producedMana: f?.producedMana ?? [],
        isCommander: commanderKeys.has(nameKey(r.name)),
      };
    });

    const changerSet = new Set(changers);
    const gameChangers = new Set(cards.filter((c) => changerSet.has(nameKey(c.name))).map((c) => nameKey(c.name))).size;
    const rulesBracket = BRACKET_NUMBER[suggestedBracket(gameChangers, combos.hasTwoCardCombo)];

    // The counted read first; the model reads it and makes its two calls.
    const computed = scoreDeck(cards, combos.combos, rulesBracket);

    const anthropic = new Anthropic();
    const response = await anthropic.messages.create({
      model: "claude-opus-5",
      // A document of a few hundred words plus the thinking that precedes it.
      max_tokens: 8000,
      output_config: { effort: "medium", format: { type: "json_schema", schema: ANALYSIS_SCHEMA } },
      system: [{ type: "text", text: ANALYSIS_INSTRUCTIONS, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: buildAnalysisPrompt(cards, computed, combos.combos, notes || null) }],
    });
    if (response.stop_reason === "refusal") throw new Error("The analysis was declined.");
    const parsed = parseAnalysis(extractJson(messageText(response)));
    if (!parsed) throw new Error("The analysis came back in a shape the app could not read.");
    console.log(
      `[scan] deck=${deck.publicId} in=${response.usage.input_tokens} cache_read=${response.usage.cache_read_input_tokens ?? 0} out=${response.usage.output_tokens}`
    );

    // The Score again, with the judgement applied within bounds.
    const score = scoreDeck(cards, combos.combos, rulesBracket, judgementFrom(parsed, computed.fundamentalTurn));
    const scan: DeckScan = {
      score,
      analysis: parsed.analysis,
      notes: typed || null,
      source,
      scannedAt: new Date().toISOString(),
    };
    await prisma.deck.update({
      where: { id: deck.id },
      data: { analysis: JSON.stringify(scan), analyzedAt: new Date() },
    });
    return NextResponse.json({ scan });
  } catch (err) {
    await refundScan(user).catch(() => {});
    const message = err instanceof Error ? err.message : "The scan failed.";
    console.error("[scan] failed", message);
    return NextResponse.json({ error: `The scan didn't complete — ${message} Nothing was charged.` }, { status: 502 });
  }
}
