// Part of `npm run practice:bench`: for each list in decks/, the instants
// and sorceries the table can't carry out by itself. The model has to
// describe those in effects (and often can't: "look at the top five…"),
// and the built-in planner never casts them. A long list here is a deck
// playing with dead cards.

import fs from "node:fs";
import path from "node:path";
import { it } from "vitest";
import { spellKnown } from "@/lib/practice/coverage";
import type { CardBook } from "@/lib/practice/types";

const DIR = path.join(__dirname, "decks");
const ONLY = process.env.DECK;

it("lists the spells the table can't carry out", () => {
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".json") && (!ONLY || f.startsWith(ONLY)));
  for (const f of files) {
    const deck = JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8")) as { name: string; cards: { name: string }[]; book: CardBook };
    const spells = deck.cards.map((c) => deck.book[c.name.toLowerCase()]).filter((i) => !!i && /\b(Instant|Sorcery)\b/.test((i.typeLine ?? "").split(" // ")[0]!));
    const unknown = spells.filter((i) => !spellKnown(i!, deck.book));
    console.log(`${deck.name}: ${spells.length} instants and sorceries, ${unknown.length} the table can't carry out`);
    for (const i of unknown) console.log(`  ${i!.name} ${i!.manaCost ?? ""} — ${(i!.oracleText ?? "").replace(/\s*\n\s*/g, " ").slice(0, 150)}`);
  }
});
