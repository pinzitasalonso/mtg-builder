import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { strArr } from "@/lib/ai";

export const runtime = "nodejs";

const SPELLBOOK_URL = "https://backend.commanderspellbook.com/find-my-combos";
const MAX_NAMES = 500;
const MAX_COMBOS = 25; // per bucket, keeps the payload and the UI sane

export interface ComboOut {
  id: string;
  cards: string[];
  produces: string[];
  missing: string[]; // empty for complete combos
  description: string;
}

interface SpellbookCombo {
  id: string;
  uses?: { card?: { name?: string } }[];
  produces?: { feature?: { name?: string } }[];
  description?: string;
}

function trimCombo(c: SpellbookCombo, owned: Set<string>): ComboOut {
  const cards = (c.uses ?? []).map((u) => u.card?.name).filter((n): n is string => Boolean(n));
  return {
    id: String(c.id),
    cards,
    produces: (c.produces ?? []).map((p) => p.feature?.name).filter((n): n is string => Boolean(n)),
    missing: cards.filter((n) => !owned.has(n.toLowerCase())),
    description: typeof c.description === "string" ? c.description : "",
  };
}

// Find combos in a card list via Commander Spellbook. Proxied server-side so
// the client only ever talks to our API.
export async function POST(req: Request) {
  if (!(await currentUser())) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }
  const body = await req.json();
  const names = strArr(body.cards).slice(0, MAX_NAMES);
  const commanders = strArr(body.commanders).slice(0, 2);
  if (names.length === 0) {
    return NextResponse.json({ error: "no cards to check" }, { status: 400 });
  }

  try {
    const res = await fetch(SPELLBOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        main: names.map((card) => ({ card, quantity: 1 })),
        commanders: commanders.map((card) => ({ card, quantity: 1 })),
      }),
    });
    if (!res.ok) {
      return NextResponse.json({ error: "combo lookup failed" }, { status: 502 });
    }
    const data = await res.json();
    const owned = new Set([...names, ...commanders].map((n) => n.toLowerCase()));
    const included: SpellbookCombo[] = data?.results?.included ?? [];
    const almost: SpellbookCombo[] = data?.results?.almostIncluded ?? [];
    return NextResponse.json({
      included: included.slice(0, MAX_COMBOS).map((c) => trimCombo(c, owned)),
      almostIncluded: almost.slice(0, MAX_COMBOS).map((c) => trimCombo(c, owned)),
      totalIncluded: included.length,
      totalAlmost: almost.length,
    });
  } catch {
    return NextResponse.json({ error: "combo lookup failed" }, { status: 502 });
  }
}
