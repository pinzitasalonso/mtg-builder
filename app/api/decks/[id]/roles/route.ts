import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import prisma from "@/lib/prisma";
import { accessibleDeckByPublicId, currentUser } from "@/lib/auth";
import { ANON_LIMIT_MSG, anonAiAllowed } from "@/lib/ratelimit";
import { extractJson, messageText } from "@/lib/ai";

export const runtime = "nodejs";

export const ROLES = ["land", "ramp", "draw", "removal", "wincon", "utility"] as const;
type Role = (typeof ROLES)[number];

// Cap one tagging batch — beyond this only abuse, and the client re-calls
// anyway since rows stay role=null until tagged.
const MAX_BATCH = 150;

const isRole = (v: unknown): v is Role => typeof v === "string" && (ROLES as readonly string[]).includes(v);

// Tag every untagged card in the deck with a deckbuilding role. Lands are
// tagged locally; the rest go to haiku in one batch. Idempotent.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await currentUser();
  const deck = await accessibleDeckByPublicId((await params).id, user?.id ?? null);
  if (!deck) return NextResponse.json({ error: "deck not found" }, { status: 404 });
  const deckId = deck.id;

  const untagged = await prisma.poolCard.findMany({
    where: { deckId, role: null },
    select: { id: true, name: true, typeLine: true, oracleText: true },
    take: MAX_BATCH,
  });
  if (untagged.length === 0) return NextResponse.json({ tagged: 0 });

  // Lands need no AI.
  let tagged = 0;
  const needAi: typeof untagged = [];
  for (const c of untagged) {
    if (/\bLand\b/.test(c.typeLine ?? "")) {
      await prisma.poolCard.update({ where: { id: c.id }, data: { role: "land" } });
      tagged++;
    } else {
      needAi.push(c);
    }
  }

  if (needAi.length === 0 || !process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ tagged, aiSkipped: needAi.length > 0 });
  }

  // Anonymous visitors share one small AI budget; lands above were still
  // tagged locally, so report rather than 429 — the client retries later.
  if (!user && !anonAiAllowed()) {
    return NextResponse.json({ tagged, aiSkipped: true, limited: ANON_LIMIT_MSG });
  }

  const list = needAi
    .map((c) => `- ${c.name} · ${c.typeLine ?? "?"} · ${(c.oracleText ?? "").slice(0, 220)}`)
    .join("\n");

  try {
    const anthropic = new Anthropic();
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2000,
      system:
        "You classify Magic: The Gathering cards into exactly one deckbuilding role. " +
        "Roles: ramp (mana acceleration/fixing), draw (card advantage/selection/tutors), " +
        "removal (spot removal, board wipes, counterspells, bounce), wincon (primary win " +
        "conditions, big threats, combo pieces), utility (everything else: protection, " +
        "recursion, hate pieces, value engines that don't fit the above).\n" +
        'Respond with ONLY a JSON object mapping each exact card name to its role, e.g. {"Sol Ring": "ramp"}.',
      messages: [{ role: "user", content: `Classify these cards:\n${list}` }],
    });
    const parsed = extractJson(messageText(msg));
    const map = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    // Case-insensitive name match — the model occasionally re-cases names.
    const byLower = new Map(Object.entries(map).map(([k, v]) => [k.toLowerCase(), v]));
    for (const c of needAi) {
      const role = byLower.get(c.name.toLowerCase());
      if (!isRole(role)) continue;
      await prisma.poolCard.update({ where: { id: c.id }, data: { role } });
      tagged++;
    }
    return NextResponse.json({ tagged });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    // Lands may already be tagged; report what happened.
    return NextResponse.json({ tagged, error: "AI tagging failed", details: detail }, { status: 502 });
  }
}
