// The deck-builder brief, server-side, so both clients ask for a deck the same
// way.
//
// WHY THIS MOVED. It began as Swift, in DeckPrompts.buildPrompt, and the web
// had nothing. Porting it would have left two copies of a prompt that changed
// four times in a single afternoon — partner pairs, basic-land counts, the
// deck-size arithmetic, the nickname rule — each fix landing twice or the two
// apps quietly building different decks from the same words.
//
// So the prompt lives here and both clients call /api/build. iOS's copy stays
// only until it is switched over; when it is, delete it rather than leave a
// second version to drift.
//
// Every rule below was earned by a bad deck. The comments say which, because
// the next person to tidy this needs to know what each sentence is holding up.

export type CollectionUse = "only" | "favor" | "free";

export interface DeckFormatSpec {
  label: string;
  usesCommander: boolean;
  deckSize: number;
}

/** Mirrors Swift's DeckFormat. Anything unknown is treated as a 60-card format. */
export const DECK_FORMATS: Record<string, DeckFormatSpec> = {
  commander: { label: "Commander", usesCommander: true, deckSize: 100 },
  brawl: { label: "Brawl", usesCommander: true, deckSize: 60 },
  standard: { label: "Standard", usesCommander: false, deckSize: 60 },
  pioneer: { label: "Pioneer", usesCommander: false, deckSize: 60 },
  modern: { label: "Modern", usesCommander: false, deckSize: 60 },
  legacy: { label: "Legacy", usesCommander: false, deckSize: 60 },
  vintage: { label: "Vintage", usesCommander: false, deckSize: 60 },
  pauper: { label: "Pauper", usesCommander: false, deckSize: 60 },
};

export function formatSpec(format: string): DeckFormatSpec {
  return DECK_FORMATS[format.toLowerCase()] ?? { label: "Standard", usesCommander: false, deckSize: 60 };
}

/**
 * The off-color trap, stated the same way to both flows.
 *
 * The builder filters suggestions through a colour-identity check, so an
 * off-colour card is silently dropped and the player just loses a slot with no
 * explanation.
 */
export const IDENTITY_CAVEAT =
  "Every card's color identity must fit ENTIRELY within the commander's — this includes off-color lands and cards with off-color mana symbols in their rules text.";

/**
 * How copy counts are written.
 *
 * A numbered list used to become copy counts: "2. [[Arcane Signet]]" built two
 * of them. The parser was fixed; this closes the same hole at the prompt end.
 */
export const COUNT_GRAMMAR =
  'When a line needs more than one copy, put the number immediately before the card — "4 [[Lightning Bolt]]" or "4x [[Lightning Bolt]]". Never number the lines themselves: a leading "1." or "2)" reads as a copy count, not as a list marker.';

export interface BuildBrief {
  format: string;
  /** One name, or a pair joined by "+". Empty means the model chooses. */
  commander?: string;
  use?: CollectionUse;
  describe?: string;
  /** Commanders the player already builds around, so the model picks another. */
  excludedCommanders?: string[];
}

export function buildPrompt(brief: BuildBrief): string {
  const format = formatSpec(brief.format);
  const commander = (brief.commander ?? "").trim();
  const use: CollectionUse = brief.use ?? "free";
  const describe = (brief.describe ?? "").trim();
  const excluded = (brief.excludedCommanders ?? []).map((s) => s.trim()).filter(Boolean);

  const lines: string[] = [`Build me a complete, ready-to-play ${format.label} deck.`];
  if (describe) lines.push(`What I'm after: ${describe}`);
  lines.push("");
  lines.push("Rules:");

  // Collection prose is builder-only: the assistant is handed the collection
  // array but told nothing about it.
  if (use === "only") {
    lines.push("- Use ONLY cards from my collection, plus basic lands as needed. Never include a card I don't own.");
  } else if (use === "favor") {
    lines.push("- Use as many cards from my collection as possible, filling the rest with efficient, on-theme staples.");
  } else {
    lines.push("- Pick the best cards for the plan; my collection doesn't constrain you here.");
  }
  lines.push("- Output ONLY the decklist. No introduction, no explanations, no prose, no section headings.");

  if (format.usesCommander) {
    if (!commander) {
      lines.push('- First choose the best commander for the deck, and put it on the FIRST line as "Commander: [[Exact Name]]".');
      // "The single best commander" made a partner pair unsayable, so a request
      // for a two-card deck came back as the nearest one-card substitute:
      // asked for RogSi (Rograkh + Silas Renn), it answered Kess.
      lines.push('- If the deck is led by a PARTNER PAIR, name both on that line as "Commander: [[First Name]] + [[Second Name]]". Do this whenever the archetype I asked for is a known pair — never swap a pair for a single commander that happens to share its colors.');
      // cEDH decks are known by portmanteau almost exclusively, and the
      // near-misses are all plausible: asked for RogSi it has answered Kess
      // (right colors, one commander) and Tevesh+Kraum (right colors, right
      // format, wrong pair). Every substitution is a deck nobody asked for.
      lines.push('- If I named the deck by a community nickname, shorthand or portmanteau — cEDH decks nearly always are, like "RogSi", "TnT" or "Blue Farm" — work out exactly which commander or commanders that name means and use THOSE. The name IS the request. Never substitute a different commander or a different partner pair because it shares the colors, the format or the strategy, and look the nickname up if you are not certain what it refers to.');
      if (excluded.length > 0) {
        lines.push(`- I already have decks led by these commanders, so pick a DIFFERENT one — do not choose any of: ${excluded.join(", ")}.`);
      }
    } else {
      // A pair arrives already joined by "+", so bracket each name rather than
      // the whole string — "[[A + B]]" resolves to nothing on Scryfall.
      const named = commander.split("+").map((s) => s.trim()).filter(Boolean);
      const bracketed = named.map((n) => `[[${n}]]`).join(" + ");
      const noun = named.length > 1 ? "commanders" : "commander";
      const pronoun = named.length > 1 ? "them" : "it";
      lines.push(`- Build around my ${noun} ${bracketed}; put ${pronoun} on the FIRST line as "Commander: ${bracketed}".`);
    }
    lines.push('- Then one card per line as "{count} [[Exact Card Name]]". Singleton, so the count is 1 for every nonbasic card.');
    // Basics were the hole. "One of each except basic lands" told the model
    // what NOT to do and never said what to do instead, so it listed the spells
    // and stopped — no mana base, and a count nowhere near legal.
    lines.push('- Basic lands are the exception and they are REQUIRED: give the deck a complete mana base and put each basic on its own line with its real count, like "12 [[Mountain]]" or "9 [[Island]]". Never list a basic without a count, and never leave the lands out.');
    lines.push(`- CRITICAL: every card must be legal in the commander's color identity. ${IDENTITY_CAVEAT}`);
    // "The commander plus 99 cards" is right for one commander and one too many
    // for a pair — two commanders leading 99 others is a 101-card deck.
    lines.push(`- Aim for a full ${format.deckSize}-card deck. The commander COUNTS toward that total, so a single commander leads ${format.deckSize - 1} other cards and a partner pair leads ${format.deckSize - 2} — both of them take a slot.`);
    lines.push(`- The COUNTS are what add up, not the lines: "12 [[Forest]]" is twelve of those cards, not one. Total them before you finish and make the deck come out at exactly ${format.deckSize} cards.`);
  } else {
    lines.push('- One card per line as "{count} [[Exact Card Name]]", up to 4 copies of any nonbasic card.');
    lines.push('- Include a complete mana base, with each basic land on its own line and its real count, like "9 [[Mountain]]".');
    lines.push(`- Aim for a ${format.deckSize}-card main deck. No sideboard.`);
    lines.push(`- The COUNTS must add up to ${format.deckSize}: a line of "4 [[Lightning Bolt]]" is four cards, not one. Add them up before you finish.`);
  }
  lines.push(`- ${COUNT_GRAMMAR}`);
  return lines.join("\n");
}
