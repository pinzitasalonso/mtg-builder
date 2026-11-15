// Winning without combat damage (Thassa's Oracle, Laboratory Maniac, a
// storm turn with Vivi), the red damage multipliers, and the AI countering
// the player's winning spell. Card text is Scryfall's (fixtures/wincons.json).

import { describe, expect, it } from "vitest";
import { fallbackPlan } from "./ai";
import { scaleDamage } from "./damage";
import {
  aiResponds,
  applyAction,
  cardId,
  declareAttackers,
  newGame,
  playerCast,
  resolveCombat,
  setBlocks,
  threatens,
  type DeckCard,
} from "./game";
import type { CardBook, CardInfo, PlanAction, PracticeGame, Seat } from "./types";
import CARDS from "./fixtures/wincons.json";

const keep = <T,>(a: T[]) => [...a];
function info(name: string, o: Partial<CardInfo> = {}): CardInfo {
  return { name, imageUri: "", typeLine: "Creature — Test", manaCost: null, manaValue: 0, oracleText: "", power: null, toughness: null, keywords: [], producedMana: [], ...o };
}
const land = (name: string, color: string, type: string) => info(name, { typeLine: `Basic Land — ${type}`, producedMana: [color] });
const BOOK: CardBook = Object.fromEntries(
  [
    land("Island", "U", "Island"),
    land("Swamp", "B", "Swamp"),
    land("Mountain", "R", "Mountain"),
    land("Forest", "G", "Forest"),
    info("Grizzly Bears", { typeLine: "Creature — Bear", manaCost: "{1}{G}", manaValue: 2, power: 2, toughness: 2 }),
    info("Goblin Guide", { typeLine: "Creature — Goblin Scout", manaCost: "{R}", manaValue: 1, power: 2, toughness: 2, keywords: ["Haste"], oracleText: "Haste" }),
    info("Opt", { typeLine: "Instant", manaCost: "{U}", manaValue: 1, oracleText: "Scry 1.\nDraw a card." }),
    info("Counterspell", { typeLine: "Instant", manaCost: "{U}{U}", manaValue: 2, oracleText: "Counter target spell." }),
    ...CARDS.map((c) => info(c.name, { typeLine: c.typeLine, manaCost: c.manaCost, manaValue: c.manaValue, oracleText: c.oracleText, power: c.power, toughness: c.toughness, keywords: c.keywords })),
  ].map((c) => [c.name.toLowerCase(), c])
);
const deck = (...names: string[]): DeckCard[] => names.map((name) => ({ name, imageUri: "", typeLine: BOOK[name.toLowerCase()]!.typeLine }));
const action = (kind: PlanAction["kind"], iid: number, o: Partial<PlanAction> = {}): PlanAction => ({ kind, card: cardId(iid), x: null, tap_card: null, sacrifice_card: null, mana: null, life: null, effects: [], ...o });
const texts = (g: PracticeGame) => g.log.map((l) => l.text);

/** A game laid out by hand, turn 5. Libraries hold `lib` more cards. */
function table(o: { you?: { field?: string[]; hand?: string[] }; opp?: { field?: string[]; hand?: string[] }; active?: Seat; lib?: number; life?: Partial<Record<Seat, number>> }): PracticeGame {
  const names = (x?: { field?: string[]; hand?: string[] }) => [...(x?.field ?? []), ...(x?.hand ?? [])];
  const lib = o.lib ?? 20;
  let g = newGame({ you: { cards: deck(...names(o.you), ...Array(lib).fill("Forest")) }, opp: { cards: deck(...names(o.opp), ...Array(lib).fill("Island")) }, commanderGame: true, first: "opp", shuffle: keep });
  for (const seat of ["you", "opp"] as const) {
    const x = o[seat];
    const all = [...g.sides[seat].hand, ...g.sides[seat].library];
    const take = (n: string) => all.splice(all.findIndex((c) => c.name === n), 1)[0]!;
    const field = (x?.field ?? []).map((n) => ({ ...take(n), enteredTurn: 0 }));
    const hand = (x?.hand ?? []).map(take);
    g.sides[seat] = { ...g.sides[seat], battlefield: field, hand, library: all, life: o.life?.[seat] ?? 40 };
  }
  return { ...g, turn: 5, active: o.active ?? "opp", landPlayed: true };
}
const at = (g: PracticeGame, seat: Seat, name: string, zone: "battlefield" | "hand" | "graveyard" = "battlefield") => g.sides[seat][zone].find((c) => c.name === name)!;
const run = (g: PracticeGame) => {
  let after = g;
  const plan = fallbackPlan(g, BOOK, "opp");
  for (const a of plan.main) after = applyAction(after, "opp", a, BOOK).game;
  return { plan, after, names: plan.main.map((a) => g.sides.opp.hand.find((c) => cardId(c.iid) === a.card)?.name) };
};

describe("red damage multipliers", () => {
  const bolt = (field: string[], youField: string[] = []) => {
    const g0 = table({ opp: { field: ["Mountain", ...field], hand: ["Lightning Bolt"] }, you: { field: youField } });
    const g = applyAction(g0, "opp", action("cast", at(g0, "opp", "Lightning Bolt", "hand").iid, { effects: [{ type: "damage", target: "player", player: null, amount: 3, name: null, power: null, toughness: null, keywords: [], to: null, tapped: null, text: null }] }), BOOK).game;
    return 40 - g.sides.you.life;
  };
  it("Torbran adds 2, Fiery Emancipation triples, both stack the best way", () => {
    expect(bolt([])).toBe(3);
    expect(bolt(["Torbran, Thane of Red Fell"])).toBe(5);
    expect(bolt(["Fiery Emancipation"])).toBe(9);
    expect(bolt(["Torbran, Thane of Red Fell", "Fiery Emancipation"])).toBe(15);
    // Furnace of Rath doubles everyone's, the player's too.
    expect(bolt([], ["Furnace of Rath"])).toBe(6);
    // Gratuitous Violence: a creature's damage only.
    expect(bolt(["Gratuitous Violence"])).toBe(3);
  });

  it("Solphim doubles noncombat damage only; Ojer Axonil raises a small hit to its power", () => {
    const g = table({ opp: { field: ["Solphim, Mayhem Dominus", "Ojer Axonil, Deepest Might // Temple of Power", "Grizzly Bears"] } });
    const bears = at(g, "opp", "Grizzly Bears");
    expect(scaleDamage(g, BOOK, "opp", bears, "you", 2, true)).toBe(2);
    // A red Vivi ping of 1: Ojer makes it 4, Solphim doubles it.
    const vivi = { iid: 9, name: "Vivi Ornitier", imageUri: "", typeLine: "Legendary Creature — Wizard", tapped: false, commander: false };
    expect(scaleDamage(g, BOOK, "opp", vivi, "you", 1)).toBe(8);
  });

  it("combat damage goes through Fiery Emancipation", () => {
    const g0 = table({ opp: { field: ["Grizzly Bears", "Fiery Emancipation"] } });
    const g = resolveCombat(setBlocks(declareAttackers(g0, "opp", [at(g0, "opp", "Grizzly Bears").iid], BOOK), {}, BOOK), BOOK);
    expect(g.sides.you.life).toBe(34);
  });
});

describe("winning without combat", () => {
  it("Thassa's Oracle wins with devotion at least the library, not otherwise", () => {
    const g0 = table({ opp: { field: ["Island", "Island"], hand: ["Thassa's Oracle"] }, lib: 1 });
    const g = applyAction(g0, "opp", action("cast", at(g0, "opp", "Thassa's Oracle", "hand").iid), BOOK).game;
    expect(g.winner).toBe("opp");
    const n0 = table({ opp: { field: ["Island", "Island"], hand: ["Thassa's Oracle"] }, lib: 10 });
    const n = applyAction(n0, "opp", action("cast", at(n0, "opp", "Thassa's Oracle", "hand").iid), BOOK).game;
    expect(n.winner).toBeNull();
  });

  it("the planner casts Demonic Consultation, then Thassa's Oracle, and wins", () => {
    const { names, after } = run(table({ opp: { field: ["Island", "Island", "Swamp"], hand: ["Thassa's Oracle", "Demonic Consultation", "Grizzly Bears"] }, lib: 30 }));
    expect(names).toEqual(["Demonic Consultation", "Thassa's Oracle"]);
    expect(after.winner).toBe("opp");
    expect(texts(after)).toContain("Demonic Consultation: The opponent names a card that isn't in its library and exiles the whole library (30 cards).");
  });

  it("the Oracle isn't cast as a plain 1/3 when it can't win", () => {
    const { names } = run(table({ opp: { field: ["Island", "Island"], hand: ["Thassa's Oracle"] }, lib: 30 }));
    expect(names).toEqual([]);
  });

  it("Tainted Pact with no way to win is a tutor: the first card that isn't a land", () => {
    const g0 = table({ opp: { field: ["Swamp", "Swamp"], hand: ["Tainted Pact"] }, lib: 3 });
    g0.sides.opp.library = [...g0.sides.opp.library, { iid: 777, name: "Grizzly Bears", imageUri: "", typeLine: "Creature — Bear", tapped: false, commander: false }];
    const g = applyAction(g0, "opp", action("cast", at(g0, "opp", "Tainted Pact", "hand").iid), BOOK).game;
    expect(g.sides.opp.hand.map((c) => c.name)).toEqual(["Grizzly Bears"]);
    expect(g.sides.opp.exile).toHaveLength(3);
  });

  it("Laboratory Maniac: drawing from an empty library wins", () => {
    const t = table({ opp: { field: ["Laboratory Maniac", "Island"], hand: ["Opt"] }, lib: 0 });
    const opt = at(t, "opp", "Opt", "hand").iid;
    const won = applyAction(t, "opp", action("cast", opt, { effects: [{ type: "draw", target: null, player: "ai", amount: 1, name: null, power: null, toughness: null, keywords: [], to: null, tapped: null, text: null }] }), BOOK).game;
    expect(won.winner).toBe("opp");
  });

  it("a storm turn with Vivi: rituals first, every spell, when the pings are lethal", () => {
    const g = table({
      opp: { field: ["Vivi Ornitier", "Mountain", "Swamp"], hand: ["Dark Ritual", "Pyretic Ritual", "Lightning Bolt", "Opt", "Seething Song"] },
      life: { you: 7 },
    });
    const { names, after } = run(g);
    expect(names).toContain("Dark Ritual");
    expect(names).toContain("Lightning Bolt");
    expect(after.winner).toBe("opp");
    // Not when it isn't lethal: the rituals stay in hand.
    const safe = run({ ...g, sides: { ...g.sides, you: { ...g.sides.you, life: 40 } } });
    expect(safe.names).not.toContain("Dark Ritual");
  });
});

describe("the AI counters a winning spell", () => {
  it("Demonic Consultation and Thassa's Oracle are threats; a plain one-drop isn't", () => {
    const g = table({ active: "you", you: { hand: ["Demonic Consultation", "Opt"] } });
    expect(threatens(g, at(g, "you", "Demonic Consultation", "hand"), BOOK)).toBe(true);
    expect(threatens(g, at(g, "you", "Opt", "hand"), BOOK)).toBe(false);
  });

  it("counters a one-mana haste creature that makes the attack lethal, and lets it be otherwise", () => {
    const lethal = table({ active: "you", you: { field: ["Mountain", "Grizzly Bears", "Grizzly Bears"], hand: ["Goblin Guide"] }, opp: { field: ["Island", "Island"], hand: ["Counterspell"] }, life: { opp: 6 } });
    const cast = playerCast(lethal, at(lethal, "you", "Goblin Guide", "hand").iid, BOOK);
    const answered = aiResponds(cast, at(lethal, "you", "Goblin Guide", "hand").iid, BOOK);
    expect(answered.sides.you.graveyard.map((c) => c.name)).toContain("Goblin Guide");
    expect(texts(answered)).toContain("The opponent counters Goblin Guide with Counterspell.");
    const safe = { ...lethal, sides: { ...lethal.sides, opp: { ...lethal.sides.opp, life: 40 } } };
    const cast2 = playerCast(safe, at(safe, "you", "Goblin Guide", "hand").iid, BOOK);
    expect(aiResponds(cast2, at(safe, "you", "Goblin Guide", "hand").iid, BOOK)).toBe(cast2);
  });
});
