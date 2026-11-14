// Wheels (Wheel of Fortune and friends), what stops them (Narset, Notion
// Thief, Hullbreacher), and the cards that make Treasures. Card text is
// Scryfall's (fixtures/wheels-treasures.json).

import { afterEach, describe, expect, it } from "vitest";
import { wheelAbilityOf, wheelOnHitOf, wheelSpellOf } from "./cards";
import {
  applyAction,
  availableMana,
  cardId,
  coin,
  declareAttackers,
  newGame,
  playerCast,
  playerSpellResolves,
  playerWheelAbility,
  resolveChoice,
  resolveCombat,
  setBlocks,
  startTurn,
  type DeckCard,
} from "./game";
import { manaTotal } from "./mana";
import { treasureSpellOf } from "./treasure";
import type { CardBook, CardInfo, PlanAction, PracticeGame } from "./types";
import CARDS from "./fixtures/wheels-treasures.json";

const keep = <T,>(a: T[]) => [...a];
function info(name: string, o: Partial<CardInfo> = {}): CardInfo {
  return { name, imageUri: "", typeLine: "Creature — Test", manaCost: null, manaValue: 0, oracleText: "", power: null, toughness: null, keywords: [], producedMana: [], ...o };
}
const land = (name: string, color: string, type: string) => info(name, { typeLine: `Basic Land — ${type}`, producedMana: [color] });

const BOOK: CardBook = Object.fromEntries(
  [
    land("Forest", "G", "Forest"),
    land("Island", "U", "Island"),
    land("Swamp", "B", "Swamp"),
    land("Mountain", "R", "Mountain"),
    land("Plains", "W", "Plains"),
    info("Sol Ring", { typeLine: "Artifact", manaCost: "{1}", oracleText: "{T}: Add {C}{C}.", producedMana: ["C"] }),
    info("Grizzly Bears", { typeLine: "Creature — Bear", manaCost: "{1}{G}", manaValue: 2, power: 2, toughness: 2 }),
    info("Hill Giant", { typeLine: "Creature — Giant", manaCost: "{3}{R}", manaValue: 4, power: 3, toughness: 3 }),
    info("Opt", { typeLine: "Instant", manaCost: "{U}", manaValue: 1, oracleText: "Scry 1. Draw a card." }),
    ...CARDS.map((c) => info(c.name, { typeLine: c.typeLine, manaCost: c.manaCost, oracleText: c.oracleText, power: c.power, toughness: c.toughness, keywords: /Flying/.test(c.oracleText) ? ["Flying"] : [] })),
  ].map((c) => [c.name.toLowerCase(), c])
);
const deck = (...names: string[]): DeckCard[] => names.map((name) => ({ name, imageUri: "", typeLine: BOOK[name.toLowerCase()]!.typeLine }));
const action = (kind: PlanAction["kind"], iid: number, o: Partial<PlanAction> = {}): PlanAction => ({ kind, card: cardId(iid), x: null, tap_card: null, sacrifice_card: null, mana: null, life: null, effects: [], ...o });
const texts = (g: PracticeGame) => g.log.map((l) => l.text);
const card = (name: string) => ({ iid: 1, name, imageUri: "", typeLine: BOOK[name.toLowerCase()]!.typeLine, tapped: false, commander: false });

/** A game laid out by hand: it's `active`'s turn 3. Each library holds 30
    more Plains or Forests under the named top cards. */
function table(o: {
  you?: { field?: string[]; hand?: string[]; grave?: string[]; top?: string[] };
  opp?: { field?: string[]; hand?: string[]; grave?: string[]; top?: string[] };
  active?: "you" | "opp";
}): PracticeGame {
  const names = (x: typeof o.you) => [...(x?.field ?? []), ...(x?.hand ?? []), ...(x?.grave ?? []), ...(x?.top ?? [])];
  let g = newGame({
    you: { cards: deck(...names(o.you), ...Array(30).fill("Forest")) },
    opp: { cards: deck(...names(o.opp), ...Array(30).fill("Plains")) },
    commanderGame: true,
    first: o.active ?? "opp",
    shuffle: keep,
  });
  for (const seat of ["you", "opp"] as const) {
    const x = o[seat];
    const all = [...g.sides[seat].hand, ...g.sides[seat].library];
    const take = (n: string) => all.splice(all.findIndex((c) => c.name === n), 1)[0]!;
    const field = (x?.field ?? []).map((n) => ({ ...take(n), enteredTurn: 0 }));
    const hand = (x?.hand ?? []).map(take);
    const graveyard = (x?.grave ?? []).map(take);
    const top = (x?.top ?? []).map(take);
    g.sides[seat] = { ...g.sides[seat], battlefield: field, hand, graveyard, library: [...top, ...all], life: 40 };
  }
  g = { ...g, turn: 3, active: o.active ?? "opp" };
  return g;
}
const at = (g: PracticeGame, seat: "you" | "opp", name: string, zone: "battlefield" | "hand" | "graveyard" | "library" | "exile" = "battlefield") =>
  g.sides[seat][zone].find((c) => c.name === name)!;
const treasuresOf = (g: PracticeGame, seat: "you" | "opp") => g.sides[seat].battlefield.filter((c) => c.name === "Treasure").length;
const tokensOf = (g: PracticeGame, seat: "you" | "opp", name: string) => g.sides[seat].battlefield.filter((c) => c.name === name).length;
/** You cast a spell from your hand, and it resolves. */
const youCast = (g: PracticeGame, name: string) => {
  const iid = at(g, "you", name, "hand").iid;
  return playerSpellResolves(playerCast(g, iid, BOOK), iid, BOOK);
};

const saved = { ...coin };
afterEach(() => Object.assign(coin, saved));

describe("which cards are wheels", () => {
  it("reads the wheels whole, and leaves the ones that do more", () => {
    expect(wheelSpellOf(BOOK, card("Wheel of Fortune"))).toEqual({ kind: "discard", draw: 7 });
    expect(wheelSpellOf(BOOK, card("Reforge the Soul"))).toEqual({ kind: "discard", draw: 7 });
    expect(wheelSpellOf(BOOK, card("Windfall"))).toEqual({ kind: "discard", draw: "greatest" });
    expect(wheelSpellOf(BOOK, card("Timetwister"))).toEqual({ kind: "twister", draw: 7 });
    expect(wheelSpellOf(BOOK, card("Echo of Eons"))).toEqual({ kind: "twister", draw: 7 });
    expect(wheelSpellOf(BOOK, card("Winds of Change"))).toEqual({ kind: "shuffle", draw: "same" });
    expect(wheelSpellOf(BOOK, card("Dark Deal"))).toEqual({ kind: "discard", draw: "less1" });
    // Ends the turn, untaps lands, deals damage: more than the table does.
    for (const n of ["Day's Undoing", "Time Spiral", "Molten Psyche"]) expect(wheelSpellOf(BOOK, card(n))).toBeNull();
    expect(wheelAbilityOf(BOOK, card("Magus of the Wheel"))).toEqual({ kind: "discard", draw: 7, mana: "{1}{R}", tap: true, sacrifice: true });
    expect(wheelAbilityOf(BOOK, card("Jace's Archivist"))).toEqual({ kind: "discard", draw: "greatest", mana: "{U}", tap: true, sacrifice: false });
    expect(wheelOnHitOf(BOOK, card("Dragon Mage"))).toEqual({ kind: "discard", draw: 7 });
  });
});

describe("a wheel", () => {
  it("the AI's Wheel of Fortune: both hands go, both draw seven", () => {
    const g0 = table({ opp: { field: ["Mountain", "Mountain", "Mountain"], hand: ["Wheel of Fortune", "Hill Giant"] }, you: { hand: ["Grizzly Bears", "Opt", "Forest", "Forest"] } });
    const g = applyAction(g0, "opp", action("cast", at(g0, "opp", "Wheel of Fortune", "hand").iid), BOOK).game;
    expect(g.sides.opp.hand).toHaveLength(7);
    expect(g.sides.you.hand).toHaveLength(7);
    expect(g.sides.opp.graveyard.map((c) => c.name).sort()).toEqual(["Hill Giant", "Wheel of Fortune"]);
    expect(g.sides.you.graveyard.map((c) => c.name).sort()).toEqual(["Forest", "Forest", "Grizzly Bears", "Opt"]);
    expect(texts(g)).toContain("Wheel of Fortune: each player discards their hand (you 4, the opponent 1), then draws (you 7, the opponent 7).");
  });

  it("your Timetwister: hands and graveyards go back, and the Timetwister stays in your graveyard", () => {
    const g0 = table({ active: "you", you: { field: ["Island", "Island", "Island"], hand: ["Timetwister", "Opt"], grave: ["Grizzly Bears"] }, opp: { hand: ["Hill Giant"], grave: ["Sol Ring"] } });
    const g = youCast(g0, "Timetwister");
    expect(g.sides.you.graveyard.map((c) => c.name)).toEqual(["Timetwister"]);
    expect(g.sides.opp.graveyard).toEqual([]);
    expect(g.sides.you.hand).toHaveLength(7);
    expect(g.sides.opp.hand).toHaveLength(7);
    // Everything else went back into the libraries: 30 + the 2 that went back, less 7.
    expect(g.sides.you.library).toHaveLength(32 - 7);
  });

  it("Windfall draws as many as the biggest hand; Dark Deal one less than your own", () => {
    const g0 = table({ active: "you", you: { field: ["Island", "Island", "Island"], hand: ["Windfall", "Opt"] }, opp: { hand: ["Hill Giant", "Sol Ring", "Opt", "Grizzly Bears", "Plains"] } });
    const g = youCast(g0, "Windfall");
    expect(g.sides.you.hand).toHaveLength(5);
    expect(g.sides.opp.hand).toHaveLength(5);
    const d0 = table({ active: "you", you: { field: ["Swamp", "Swamp", "Swamp"], hand: ["Dark Deal", "Opt", "Opt"] }, opp: { hand: ["Hill Giant", "Sol Ring", "Opt"] } });
    const d = youCast(d0, "Dark Deal");
    expect(d.sides.you.hand).toHaveLength(1);
    expect(d.sides.opp.hand).toHaveLength(2);
  });

  it("Magus of the Wheel: paid, tapped and sacrificed from its menu", () => {
    const g0 = table({ active: "you", you: { field: ["Magus of the Wheel", "Mountain", "Mountain"], hand: ["Opt"] }, opp: { hand: ["Hill Giant"] } });
    const g = playerWheelAbility(g0, at(g0, "you", "Magus of the Wheel").iid, BOOK);
    expect(g.sides.you.graveyard.map((c) => c.name).sort()).toEqual(["Magus of the Wheel", "Opt"]);
    expect(g.sides.you.battlefield.filter((c) => c.tapped).map((c) => c.name)).toEqual(["Mountain", "Mountain"]);
    expect(g.sides.you.hand).toHaveLength(7);
    expect(g.sides.opp.hand).toHaveLength(7);
  });

  it("Dragon Mage wheels when it hits", () => {
    const g0 = table({ active: "opp", opp: { field: ["Dragon Mage"], hand: ["Hill Giant"] }, you: { hand: ["Opt", "Opt"] } });
    const g = resolveCombat(setBlocks(declareAttackers(g0, "opp", [at(g0, "opp", "Dragon Mage").iid], BOOK), {}, BOOK), BOOK);
    expect(g.sides.you.life).toBe(35);
    expect(g.sides.opp.hand).toHaveLength(7);
    expect(g.sides.you.hand).toHaveLength(7);
  });
});

describe("what stops a wheel", () => {
  it("the AI's Narset: your wheel gives you one card, the AI seven", () => {
    const g0 = table({ active: "you", you: { field: ["Mountain", "Mountain", "Mountain"], hand: ["Wheel of Fortune", "Opt"] }, opp: { field: ["Narset, Parter of Veils"], hand: ["Hill Giant"] } });
    const g = youCast(g0, "Wheel of Fortune");
    expect(g.sides.you.hand).toHaveLength(1);
    expect(g.sides.opp.hand).toHaveLength(7);
    expect(texts(g)).toContain("You can't draw more than one card a turn: 6 draws are skipped.");
    // The turn after, the count starts again: the draw step's card comes.
    const next = startTurn({ ...g, active: "you", turn: 5 }, BOOK);
    expect(next.sides.you.hand).toHaveLength(2);
  });

  it("the AI's Notion Thief takes your wheel's seven; Hullbreacher makes Treasures of them", () => {
    const thief = table({ active: "you", you: { field: ["Mountain", "Mountain", "Mountain"], hand: ["Wheel of Fortune"] }, opp: { field: ["Notion Thief"], hand: ["Hill Giant"] } });
    const t = youCast(thief, "Wheel of Fortune");
    expect(t.sides.you.hand).toHaveLength(0);
    expect(t.sides.opp.hand).toHaveLength(14);
    const hull = table({ active: "you", you: { field: ["Mountain", "Mountain", "Mountain"], hand: ["Wheel of Fortune"] }, opp: { field: ["Hullbreacher"] } });
    const h = youCast(hull, "Wheel of Fortune");
    expect(h.sides.you.hand).toHaveLength(0);
    expect(treasuresOf(h, "opp")).toBe(7);
  });

  it("not the first card of your draw step", () => {
    const g0 = table({ active: "you", opp: { field: ["Notion Thief"] } });
    const g = startTurn({ ...g0, turn: 5 }, BOOK);
    expect(g.sides.you.hand).toHaveLength(1);
    expect(g.sides.opp.hand).toHaveLength(0);
  });
});

describe("Treasure tokens", () => {
  it("Dockside Extortionist: one for each artifact and enchantment on the other side", () => {
    const g0 = table({ opp: { field: ["Mountain", "Mountain"], hand: ["Dockside Extortionist"] }, you: { field: ["Sol Ring", "Revel in Riches", "Grizzly Bears"] } });
    const g = applyAction(g0, "opp", action("cast", at(g0, "opp", "Dockside Extortionist", "hand").iid, { effects: [{ type: "token", target: null, player: null, amount: 2, name: "Treasure", power: null, toughness: null, keywords: [], to: null, tapped: null, text: null }] }), BOOK).game;
    // The plan's own Treasures aren't made as well.
    expect(treasuresOf(g, "opp")).toBe(2);
    // A Treasure is mana of any colour, used up when spent.
    expect(manaTotal(availableMana(g, "opp", BOOK))).toBe(2);
  });

  it("Xorn adds one to each batch; Academy Manufactor makes one of each", () => {
    const g0 = table({ opp: { field: ["Mountain", "Mountain", "Xorn"], hand: ["Dockside Extortionist"] }, you: { field: ["Sol Ring"] } });
    const g = applyAction(g0, "opp", action("cast", at(g0, "opp", "Dockside Extortionist", "hand").iid), BOOK).game;
    expect(treasuresOf(g, "opp")).toBe(2);
    const m0 = table({ opp: { field: ["Mountain", "Mountain", "Academy Manufactor"], hand: ["Dockside Extortionist"] }, you: { field: ["Sol Ring"] } });
    const m = applyAction(m0, "opp", action("cast", at(m0, "opp", "Dockside Extortionist", "hand").iid), BOOK).game;
    expect([treasuresOf(m, "opp"), tokensOf(m, "opp", "Food"), tokensOf(m, "opp", "Clue")]).toEqual([1, 1, 1]);
  });

  it("Goldspan Dragon makes one as it attacks, and its Treasures make two mana", () => {
    const g0 = table({ opp: { field: ["Goldspan Dragon"] } });
    const g = declareAttackers(g0, "opp", [at(g0, "opp", "Goldspan Dragon").iid], BOOK);
    expect(treasuresOf(g, "opp")).toBe(1);
    expect(manaTotal(availableMana(g, "opp", BOOK))).toBe(2);
  });

  it("combat damage: Ragavan's, Face-Breaker's once for the team, Old Gnawbone's that many", () => {
    const fight = (field: string[], attackers: string[]) => {
      const g0 = table({ opp: { field }, you: { top: ["Hill Giant"] } });
      return resolveCombat(setBlocks(declareAttackers(g0, "opp", attackers.map((n) => at(g0, "opp", n).iid), BOOK), {}, BOOK), BOOK);
    };
    const r = fight(["Ragavan, Nimble Pilferer"], ["Ragavan, Nimble Pilferer"]);
    expect(treasuresOf(r, "opp")).toBe(1);
    expect(r.sides.you.exile.map((c) => c.name)).toEqual(["Hill Giant"]);
    const f = fight(["Professional Face-Breaker", "Grizzly Bears", "Hill Giant"], ["Professional Face-Breaker", "Grizzly Bears", "Hill Giant"]);
    expect(treasuresOf(f, "opp")).toBe(1);
    const o = fight(["Old Gnawbone", "Grizzly Bears", "Hill Giant"], ["Grizzly Bears", "Hill Giant"]);
    expect(treasuresOf(o, "opp")).toBe(5);
    coin.d20 = () => 13;
    const d = fight(["Ancient Copper Dragon"], ["Ancient Copper Dragon"]);
    expect(treasuresOf(d, "opp")).toBe(13);
    expect(texts(d)).toContain("Ancient Copper Dragon: the opponent makes 13 Treasures (rolled 13).");
  });

  it("Big Score: you pick the discard, then draw two and make two Treasures", () => {
    const g0 = table({ active: "you", you: { field: ["Mountain", "Mountain", "Mountain", "Mountain"], hand: ["Big Score", "Hill Giant", "Opt"] } });
    const asked = youCast(g0, "Big Score");
    expect(asked.choice).toMatchObject({ kind: "discard", source: "Big Score", then: { draw: 2, treasures: 2 } });
    const g = resolveChoice(asked, at(asked, "you", "Hill Giant", "hand").iid, BOOK);
    expect(g.sides.you.hand.map((c) => c.name)).toEqual(["Opt", "Forest", "Forest"]);
    expect(treasuresOf(g, "you")).toBe(2);
  });

  it("the AI's Deadly Dispute sacrifices what it would rather lose; Brass's Bounty counts lands", () => {
    const g0 = table({ opp: { field: ["Swamp", "Swamp", "Sol Ring", "Hill Giant"], hand: ["Deadly Dispute"] } });
    const g = applyAction(g0, "opp", action("cast", at(g0, "opp", "Deadly Dispute", "hand").iid), BOOK).game;
    expect(g.sides.opp.graveyard.map((c) => c.name).sort()).toEqual(["Deadly Dispute", "Sol Ring"]);
    expect(g.sides.opp.hand).toHaveLength(2);
    expect(treasuresOf(g, "opp")).toBe(1);
    expect(treasureSpellOf(BOOK, card("Brass's Bounty"))).toEqual({ draw: 0, treasures: "lands" });
    expect(treasureSpellOf(BOOK, card("Strike It Rich"))).toEqual({ draw: 0, treasures: 1 });
  });

  it("Revel in Riches: a Treasure when your creature dies, and ten win at its upkeep", () => {
    const g0 = table({ active: "you", you: { field: ["Grizzly Bears"] }, opp: { field: ["Revel in Riches"] } });
    g0.sides.you.battlefield[0]!.damage = 5;
    const g = startTurn({ ...g0, active: "you", turn: 5 }, BOOK);
    expect(treasuresOf(g, "opp")).toBe(1);
    const rich = table({ opp: { field: ["Revel in Riches"] } });
    const withTen: PracticeGame = { ...rich, sides: { ...rich.sides, opp: { ...rich.sides.opp, battlefield: [...rich.sides.opp.battlefield, ...Array.from({ length: 10 }, (_, i) => ({ iid: 90000 + i, name: "Treasure", imageUri: "", typeLine: "Token Artifact — Treasure", tapped: false, commander: false, token: { power: 0, toughness: 0, keywords: [], kind: "artifact" as const } }))] } } };
    expect(startTurn({ ...withTen, active: "opp", turn: 5 }, BOOK).winner).toBe("opp");
  });

  it("Lotho: a Treasure, and a life, for anyone's second spell in a turn", () => {
    const g0 = table({ active: "you", you: { field: ["Island", "Island"], hand: ["Opt", "Opt"] }, opp: { field: ["Lotho, Corrupt Shirriff"] } });
    let g = playerCast(g0, g0.sides.you.hand[0]!.iid, BOOK);
    expect(treasuresOf(g, "opp")).toBe(0);
    g = playerCast(g, g.sides.you.hand.find((c) => c.name === "Opt")!.iid, BOOK);
    expect(treasuresOf(g, "opp")).toBe(1);
    expect(g.sides.opp.life).toBe(39);
  });
});

describe("the built-in planner", () => {
  const BALLISTA = info("Walking Ballista", { typeLine: "Artifact Creature — Construct", manaCost: "{X}{X}", power: 0, toughness: 0, oracleText: "Walking Ballista enters with X +1/+1 counters on it." });
  const book: CardBook = { ...BOOK, "walking ballista": BALLISTA };

  it("casts a wheel when its hand is nearly empty, not when it's full", async () => {
    const { fallbackPlan } = await import("./ai");
    const cast = (hand: string[]) => {
      const g = table({ opp: { field: ["Mountain", "Mountain", "Mountain"], hand } });
      return fallbackPlan(g, book, "opp").main.map((a) => g.sides.opp.hand.find((c) => cardId(c.iid) === a.card)?.name);
    };
    expect(cast(["Wheel of Fortune", "Opt"])).toContain("Wheel of Fortune");
    expect(cast(["Wheel of Fortune", "Opt", "Opt", "Opt", "Hill Giant"])).not.toContain("Wheel of Fortune");
  });

  it("doesn't cast a 0/0 that would die at once (Walking Ballista at X = 0)", async () => {
    const { fallbackPlan } = await import("./ai");
    const g = table({ opp: { field: ["Mountain", "Mountain", "Mountain", "Mountain"] } });
    g.sides.opp.hand = [{ iid: 77777, name: "Walking Ballista", imageUri: "", typeLine: BALLISTA.typeLine, tapped: false, commander: false }];
    expect(fallbackPlan(g, book, "opp").main).toEqual([]);
  });
});
