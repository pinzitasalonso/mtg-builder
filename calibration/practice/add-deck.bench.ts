// Adds a list to decks/ from MTGTop8's cEDH metagame: its best recent
// finish, each card's text from Scryfall, and its combos from Commander
// Spellbook. Needs the network, so it only runs when asked:
//
//   ADD="Kinnan, Bonder Prodigy" SLUG=kinnan npm run practice:bench
//
// ADD is the archetype's name as MTGTop8 lists it (a commander, or
// "Partner UBR" for a pair).

import fs from "node:fs";
import path from "node:path";
import { it } from "vitest";
import { findCombos } from "@/lib/combos";
import { fetchMetagame } from "@/lib/mtgtop8";
import { deckCombos } from "@/lib/practice/combos";
import { deckFromMtgtop8 } from "@/lib/practice/decks";

const ADD = process.env.ADD;

it.skipIf(!ADD)("adds a list", async () => {
  const meta = await fetchMetagame("cedh");
  const arch = meta?.meta.archetypes.find((a) => a.name.toLowerCase() === ADD!.toLowerCase());
  if (!arch) throw new Error(`No cEDH archetype named "${ADD}". There are: ${meta?.meta.archetypes.slice(0, 40).map((a) => a.name).join(" · ")}`);
  const deck = await deckFromMtgtop8("cedh", arch.id);
  if (!deck) throw new Error("Couldn't load that list.");
  const commanders = new Set((deck.commander ?? "").split("+").map((n) => n.trim().toLowerCase()));
  const found = await findCombos(deck.cards.map((c) => ({ name: c.name, quantity: c.quantity, isCommander: commanders.has(c.name.toLowerCase()) })));
  const slug = process.env.SLUG ?? ADD!.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const file = {
    name: deck.commander ?? deck.label,
    source: { kind: "mtgtop8", detail: deck.detail, fetchedAt: new Date().toISOString().slice(0, 10) },
    commander: deck.commander,
    cards: deck.cards.map((c) => ({ name: c.name, quantity: c.quantity, typeLine: c.typeLine })),
    book: Object.fromEntries(Object.entries(deck.book).map(([k, v]) => [k, { ...v, imageUri: "" }])),
    combos: deckCombos(found.combos),
  };
  fs.writeFileSync(path.join(__dirname, "decks", `${slug}.json`), JSON.stringify(file, null, 1));
  console.log(`\nAdded ${file.name}: ${file.cards.length} cards, ${file.combos.length} combos → decks/${slug}.json\n`);
});
