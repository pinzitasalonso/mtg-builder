import { NextResponse } from "next/server";
import { buildPrompt, type BuildBrief, type CollectionUse } from "@/lib/deck-prompts";

export const runtime = "nodejs";

// The deck-builder brief, so both clients ask for a deck with the same words.
//
// This route does NOT call the model. It hands back the prompt, and the client
// posts that to /api/chat exactly as it always has — which keeps the streaming,
// the AI metering, the research and the recent-set grounding in one place
// instead of forking them.
//
// The point is only that the WORDING lives on the server. It changed four
// times in one afternoon — partner pairs, basic-land counts, deck-size
// arithmetic, the nickname rule — and a copy in each client means every future
// fix lands twice or the two apps quietly build different decks.
//
// Unauthenticated on purpose: it is a pure function of the brief, touches no
// account data, and the ask it produces is metered where it is spent.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.format !== "string") {
    return NextResponse.json({ error: "format required" }, { status: 400 });
  }

  const use: CollectionUse =
    body.use === "only" || body.use === "favor" || body.use === "free" ? body.use : "free";

  const brief: BuildBrief = {
    format: body.format,
    commander: typeof body.commander === "string" ? body.commander : "",
    use,
    describe: typeof body.describe === "string" ? body.describe.slice(0, 2000) : "",
    excludedCommanders: Array.isArray(body.excludedCommanders)
      ? body.excludedCommanders.filter((n: unknown): n is string => typeof n === "string").slice(0, 40)
      : [],
  };

  return NextResponse.json({ prompt: buildPrompt(brief) });
}
