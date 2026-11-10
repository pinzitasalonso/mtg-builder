import { rateLimit } from "@/lib/ratelimit";
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { EDHREC_LEVELS, fetchAverageDeck, type EdhrecLevel } from "@/lib/edhrec";

export const runtime = "nodejs";

export interface CommanderLevel {
  level: EdhrecLevel;
  bracket: number;
  label: string;
  /** Decks registered at this bracket. */
  decks: number;
}

// A commander to practise against: whether EDHREC has decks for it, and at
// which brackets. The picker shows those, and the start route loads the one
// picked (lib/practice/decks.ts deckFromEdhrec).
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in to play against the AI." }, { status: 401 });
  const name = (new URL(req.url).searchParams.get("name") ?? "").trim();
  if (!name || name.length > 200) return NextResponse.json({ error: "name required" }, { status: 400 });
  // Each new name is a request to EDHREC.
  if (!rateLimit(`practice-commander:${user.id}`, 20, 60_000)) return NextResponse.json({ error: "Too many searches. Try again in a minute." }, { status: 429 });
  const avg = await fetchAverageDeck(name, null);
  if (!avg) return NextResponse.json({ error: `EDHREC has no decks for ${name}. Is it a commander?` }, { status: 404 });
  const levels: CommanderLevel[] = (Object.keys(EDHREC_LEVELS) as EdhrecLevel[]).flatMap((level) => {
    const { bracket, label } = EDHREC_LEVELS[level];
    const decks = avg.bracketCounts[bracket] ?? 0;
    return decks ? [{ level, bracket, label, decks }] : [];
  });
  return NextResponse.json({ commander: avg.commanders.join(" + "), decks: avg.decks, levels });
}
