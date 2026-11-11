// Fast mana by each card's own rules, sneak, loyalty counters, the hand
// size at the end of a turn, and a commander going back to its command
// zone. Card text is Scryfall's.

import { afterEach, describe, expect, it } from "vitest";
import { manaOutput, ninjutsuOf } from "./cards";
import {
  addLoyalty,
  applyAction,
  availableMana,
  cardId,
  castable,
  coin,
  declareAttackers,
  declineChoice,
  choiceTargets,
  endTurn,
  loyaltyOf,
  moveAnyCard,
  newGame,
  ninjutsu,
  ninjutsuOptions,
  playerCast,
  playerCleanup,
  playerEnters,
  playerPlay,
  resolveChoice,
  setBlocks,
  startTurn,
  type DeckCard,
} from "./game";
import { manaTotal } from "./mana";
import type { CardBook, CardInfo, PlanAction, PracticeGame } from "./types";

const keep = <T,>(a: T[]) => [...a];
function info(name: string, o: Partial<CardInfo> = {}): CardInfo {
  return { name, imageUri: "", typeLine: "Creature — Test", manaCost: null, manaValue: 0, oracleText: "", power: null, toughness: null, keywords: [], producedMana: [], ...o };
}
const land = (name: string, color: string, type: string) => info(name, { typeLine: `Basic Land — ${type}`, producedMana: [color] });
const ANY = ["B", "G", "R", "U", "W"];
const rock = (name: string, manaCost: string, oracleText: string, producedMana: string[] = ANY, typeLine = "Artifact") =>
  info(name, { typeLine, manaCost, manaValue: 0, oracleText, producedMana });

const BOOK: CardBook = Object.fromEntries(
  [
    land("Forest", "G", "Forest"),
    land("Island", "U", "Island"),
    land("Swamp", "B", "Swamp"),
    land("Mountain", "R", "Mountain"),
    land("Plains", "W", "Plains"),
    rock("Sol Ring", "{1}", "{T}: Add {C}{C}.", ["C"]),
    rock("Mana Crypt", "{0}", "At the beginning of your upkeep, flip a coin. If you lose the flip, this artifact deals 3 damage to you.\n{T}: Add {C}{C}.", ["C"]),
    rock(
      "Mana Vault",
      "{1}",
      "This artifact doesn't untap during your untap step.\nAt the beginning of your upkeep, you may pay {4}. If you do, untap this artifact.\nAt the beginning of your draw step, if this artifact is tapped, it deals 1 damage to you.\n{T}: Add {C}{C}{C}.",
      ["C"]
    ),
    rock("Grim Monolith", "{2}", "This artifact doesn't untap during your untap step.\n{T}: Add {C}{C}{C}.\n{4}: Untap this artifact.", ["C"]),
    rock("Chrome Mox", "{0}", "Imprint — When this artifact enters, you may exile a nonartifact, nonland card from your hand.\n{T}: Add one mana of any of the exiled card's colors."),
    rock(
      "Mox Diamond",
      "{0}",
      "If this artifact would enter, you may discard a land card instead. If you do, put this artifact onto the battlefield. If you don't, put it into its owner's graveyard.\n{T}: Add one mana of any color."
    ),
    rock("Mox Opal", "{0}", "Metalcraft — {T}: Add one mana of any color. Activate only if you control three or more artifacts.", ANY, "Legendary Artifact"),
    rock("Mox Amber", "{0}", "{T}: Add one mana of any color among legendary creatures and planeswalkers you control.", ANY, "Legendary Artifact"),
    rock("Lotus Petal", "{0}", "{T}, Sacrifice this artifact: Add one mana of any color."),
    rock("Black Lotus", "{0}", "{T}, Sacrifice this artifact: Add three mana of any one color."),
    rock("Jeweled Lotus", "{0}", "{T}, Sacrifice this artifact: Add three mana of any one color. Spend this mana only to cast your commander."),
    rock("Lion's Eye Diamond", "{0}", "Discard your hand, Sacrifice this artifact: Add three mana of any one color. Activate only as an instant."),
    rock(
      "Lotus Bloom",
      "",
      "Suspend 3—{0} (Rather than cast this card from your hand, pay {0} and exile it with three time counters on it. At the beginning of your upkeep, remove a time counter. When the last is removed, you may cast it without paying its mana cost.)\n{T}, Sacrifice this artifact: Add three mana of any one color."
    ),
    rock("Dimir Signet", "{2}", "{1}, {T}: Add {U}{B}.", ["B", "U"]),
    rock("Talisman of Dominance", "{2}", "{T}: Add {C}.\n{T}: Add {U} or {B}. This artifact deals 1 damage to you.", ["B", "C", "U"]),
    rock("Thought Vessel", "{2}", "You have no maximum hand size.\n{T}: Add {C}.", ["C"]),
    rock("Springleaf Drum", "{1}", "{T}, Tap an untapped creature you control: Add one mana of any color."),
    rock("Chromatic Lantern", "{3}", 'Lands you control have "{T}: Add one mana of any color."\n{T}: Add one mana of any color.'),
    rock("Ancient Tomb", "", "{T}: Add {C}{C}. This land deals 2 damage to you.", ["C"], "Land"),
    rock("City of Traitors", "", "When you play another land, sacrifice this land.\n{T}: Add {C}{C}.", ["C"], "Land"),
    rock("Gaea's Cradle", "", "{T}: Add {G} for each creature you control.", ["G"], "Legendary Land"),
    rock("Cabal Coffers", "", "{2}, {T}: Add {B} for each Swamp you control.", ["B"], "Land"),
    rock("Watery Grave", "", "({T}: Add {U} or {B}.)\nAs this land enters, you may pay 2 life. If you don't, it enters tapped.", ["B", "U"], "Land — Island Swamp"),
    info("Dockside Extortionist", {
      typeLine: "Creature — Goblin Pirate",
      manaCost: "{1}{R}",
      manaValue: 2,
      power: 1,
      toughness: 2,
      producedMana: ANY,
      oracleText:
        'When this creature enters, create X Treasure tokens, where X is the number of artifacts and enchantments your opponents control. (Treasure tokens are artifacts with "{T}, Sacrifice this token: Add one mana of any color.")',
    }),
    info("Smothering Tithe", {
      typeLine: "Enchantment",
      manaCost: "{3}{W}",
      manaValue: 4,
      producedMana: ANY,
      oracleText:
        'Whenever an opponent draws a card, that player may pay {2}. If the player doesn\'t, you create a Treasure token. (It\'s an artifact with "{T}, Sacrifice this token: Add one mana of any color.")',
    }),
    info("Wild Growth", { typeLine: "Enchantment — Aura", manaCost: "{G}", manaValue: 1, producedMana: ["G"], oracleText: "Enchant land\nWhenever enchanted land is tapped for mana, its controller adds an additional {G}." }),
    info("Simian Spirit Guide", { typeLine: "Creature — Ape Spirit", manaCost: "{2}{R}", manaValue: 3, power: 2, toughness: 2, producedMana: ["R"], oracleText: "Exile this card from your hand: Add {R}." }),
    info("Birds of Paradise", { typeLine: "Creature — Bird", manaCost: "{G}", manaValue: 1, power: 0, toughness: 1, keywords: ["Flying"], producedMana: ANY, oracleText: "Flying\n{T}: Add one mana of any color." }),
    info("Grizzly Bears", { typeLine: "Creature — Bear", manaCost: "{1}{G}", manaValue: 2, power: 2, toughness: 2 }),
    info("Hill Giant", { typeLine: "Creature — Giant", manaCost: "{3}{R}", manaValue: 4, power: 3, toughness: 3 }),
    info("Counterspell", { typeLine: "Instant", manaCost: "{U}{U}", manaValue: 2, oracleText: "Counter target spell." }),
    info("Ragavan, Nimble Pilferer", { typeLine: "Legendary Creature — Monkey Pirate", manaCost: "{R}", manaValue: 1, power: 2, toughness: 1 }),
    info("Kefka Test", { typeLine: "Legendary Creature — Human Wizard", manaCost: "{2}{U}{B}{R}", manaValue: 5, power: 4, toughness: 5 }),
    info("Jace, the Mind Sculptor", {
      typeLine: "Legendary Planeswalker — Jace",
      manaCost: "{2}{U}{U}",
      manaValue: 4,
      loyalty: 3,
      oracleText: "+2: Look at the top card of target player's library. You may put that card on the bottom of that player's library.\n0: Draw three cards, then put two cards from your hand on top of your library in any order.",
    }),
    info("Leonardo, Cutting Edge", {
      typeLine: "Legendary Creature — Mutant Ninja Turtle",
      manaCost: "{1}{W}",
      manaValue: 2,
      power: 2,
      toughness: 2,
      keywords: ["Lifelink", "Sneak"],
      oracleText:
        "Sneak {W} (You may cast this spell for {W} if you also return an unblocked attacker you control to hand during the declare blockers step. He enters tapped and attacking.)\nLifelink\nWhenever you gain life, put a +1/+1 counter on Leonardo.",
    }),
    info("Splinter's Technique", {
      typeLine: "Sorcery",
      manaCost: "{3}{B}",
      manaValue: 4,
      keywords: ["Sneak"],
      oracleText:
        "Sneak {1}{B} (You may cast this spell for {1}{B} if you also return an unblocked attacker you control to hand during the declare blockers step.)\nSearch your library for a card, put that card into your hand, then shuffle.",
    }),
  ].map((c) => [c.name.toLowerCase(), c])
);
const deck = (...names: string[]): DeckCard[] => names.map((name) => ({ name, imageUri: "", typeLine: BOOK[name.toLowerCase()]!.typeLine }));
const action = (kind: PlanAction["kind"], iid: number, o: Partial<PlanAction> = {}): PlanAction => ({ kind, card: cardId(iid), x: null, tap_card: null, sacrifice_card: null, mana: null, life: null, effects: [], ...o });
const texts = (g: PracticeGame) => g.log.map((l) => l.text);

/** A game laid out by hand (as in commanders.test.ts): it's `active`'s turn 3. */
function table(o: {
  you?: { field?: string[]; hand?: string[]; command?: string[]; top?: string[] };
  opp?: { field?: string[]; hand?: string[]; command?: string[]; top?: string[] };
  active?: "you" | "opp";
}): PracticeGame {
  const names = (x: typeof o.you) => [...(x?.field ?? []), ...(x?.hand ?? []), ...(x?.command ?? []), ...(x?.top ?? [])];
  let g = newGame({
    you: { cards: deck(...names(o.you), ...Array(12).fill("Forest")) },
    opp: { cards: deck(...names(o.opp), ...Array(12).fill("Plains")) },
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
    const command = (x?.command ?? []).map((n) => ({ ...take(n), commander: true }));
    const top = (x?.top ?? []).map(take);
    g.sides[seat] = { ...g.sides[seat], battlefield: field, hand, command, library: [...top, ...all], life: 40 };
  }
  g = { ...g, turn: 3, active: o.active ?? "opp" };
  return g;
}
const at = (g: PracticeGame, seat: "you" | "opp", name: string, zone: "battlefield" | "hand" | "command" | "graveyard" | "library" | "exile" = "battlefield") =>
  g.sides[seat][zone].find((c) => c.name === name)!;
const made = (name: string) => manaOutput(BOOK[name.toLowerCase()], BOOK[name.toLowerCase()]!.typeLine);
const mana = (g: PracticeGame, seat: "you" | "opp" = "opp") => manaTotal(availableMana(g, seat, BOOK));

const flip = coin.flip;
afterEach(() => {
  coin.flip = flip;
});

describe("what a card makes, from its own text", () => {
  it("counts the mana each ability adds, less what goes in", () => {
    expect(made("Sol Ring")).toMatchObject({ amount: 2, sacrifice: false });
    expect(made("Mana Vault")).toMatchObject({ amount: 3 });
    expect(made("Black Lotus")).toMatchObject({ amount: 3, sacrifice: true });
    expect(made("Lotus Petal")).toMatchObject({ amount: 1, sacrifice: true });
    // A Signet takes {1} to make two.
    expect(made("Dimir Signet")).toMatchObject({ amount: 1, colors: ["B", "U"] });
    expect(made("Jeweled Lotus")).toMatchObject({ amount: 3, sacrifice: true, commanderOnly: true });
    expect(made("Ancient Tomb")).toMatchObject({ amount: 2, pain: 2 });
    // The Talisman's colourless ability doesn't hurt.
    expect(made("Talisman of Dominance")).toMatchObject({ amount: 1 });
    expect(made("Talisman of Dominance")!.pain).toBeUndefined();
    expect(made("Chromatic Lantern")).toMatchObject({ amount: 1 });
  });

  it("a card that only talks about mana makes none", () => {
    // Treasures in reminder text, an Aura's extra mana, a card that's exiled from hand.
    for (const name of ["Dockside Extortionist", "Smothering Tithe", "Wild Growth", "Simian Spirit Guide", "Lion's Eye Diamond"]) expect(made(name)).toBeNull();
  });

  it("a land with a basic land type taps for it, with the ability only in reminder text", () => {
    expect(made("Watery Grave")).toMatchObject({ amount: 1, colors: ["B", "U"] });
    expect(made("Forest")).toMatchObject({ amount: 1, colors: ["G"] });
  });
});

describe("each mox's condition", () => {
  it("Mox Opal needs three artifacts", () => {
    expect(mana(table({ opp: { field: ["Mox Opal", "Sol Ring"] } }))).toBe(2);
    expect(mana(table({ opp: { field: ["Mox Opal", "Sol Ring", "Lotus Petal"] } }))).toBe(4);
  });

  it("Mox Amber makes the colours of your legendary creatures", () => {
    expect(mana(table({ opp: { field: ["Mox Amber", "Grizzly Bears"] } }))).toBe(0);
    const g = table({ opp: { field: ["Mox Amber", "Ragavan, Nimble Pilferer"] } });
    expect(availableMana(g, "opp", BOOK).map((s) => s.colors)).toEqual([["R"]]);
  });

  it("Jeweled Lotus pays for the commander only", () => {
    const g = table({ opp: { field: ["Jeweled Lotus"], hand: ["Hill Giant"], command: ["Kefka Test"] } });
    expect(mana(g)).toBe(0);
    expect(manaTotal(availableMana(g, "opp", BOOK, [], { commander: true }))).toBe(3);
    expect(castable(g, "opp", at(g, "opp", "Hill Giant", "hand"), BOOK, "hand")).toBe(false);
  });

  it("the AI's Mox Diamond takes a land from its hand, or goes to the graveyard", () => {
    const g0 = table({ opp: { hand: ["Mox Diamond", "Plains", "Plains", "Island"] } });
    const g = applyAction(g0, "opp", action("cast", at(g0, "opp", "Mox Diamond", "hand").iid), BOOK).game;
    expect(at(g, "opp", "Mox Diamond")).toBeTruthy();
    // The land it has two of.
    expect(g.sides.opp.graveyard.map((c) => c.name)).toEqual(["Plains"]);
    expect(texts(g)).toContain("The opponent discards Plains for Mox Diamond.");
    // With no land in hand it isn't cast at all.
    const none = table({ opp: { hand: ["Mox Diamond", "Hill Giant"] } });
    expect(castable(none, "opp", at(none, "opp", "Mox Diamond", "hand"), BOOK, "hand")).toBe(false);
    expect(applyAction(none, "opp", action("cast", at(none, "opp", "Mox Diamond", "hand").iid), BOOK).ok).toBe(false);
  });

  it("your Mox Diamond asks for a land; not discarding sends it to the graveyard", () => {
    const g0 = table({ you: { hand: ["Mox Diamond", "Forest", "Grizzly Bears"] }, active: "you" });
    const mox = at(g0, "you", "Mox Diamond", "hand").iid;
    const asked = playerEnters(playerCast(g0, mox, BOOK), mox, BOOK);
    expect(asked.choice).toMatchObject({ kind: "discard", only: "land", decline: "Don't discard" });
    // Only the land may be picked.
    expect(choiceTargets(asked, BOOK)).toEqual([at(asked, "you", "Forest", "hand").iid]);
    const kept = resolveChoice(asked, at(asked, "you", "Forest", "hand").iid, BOOK);
    expect(at(kept, "you", "Mox Diamond")).toBeTruthy();
    expect(kept.sides.you.graveyard.map((c) => c.name)).toEqual(["Forest"]);
    expect(mana(kept, "you")).toBe(1);
    const lost = declineChoice(asked, BOOK);
    expect(lost.sides.you.battlefield).toEqual([]);
    expect(lost.sides.you.graveyard.map((c) => c.name)).toEqual(["Mox Diamond"]);
  });

  it("Chrome Mox makes the colours of the card exiled with it", () => {
    // The AI exiles its most expensive coloured card.
    const g0 = table({ opp: { hand: ["Chrome Mox", "Hill Giant", "Grizzly Bears", "Sol Ring"] } });
    const g = applyAction(g0, "opp", action("cast", at(g0, "opp", "Chrome Mox", "hand").iid), BOOK).game;
    expect(g.sides.opp.exile.map((c) => c.name)).toEqual(["Hill Giant"]);
    expect(availableMana(g, "opp", BOOK).map((s) => s.colors)).toEqual([["R"]]);
    // Yours asks; with nothing exiled it makes no mana.
    const y0 = table({ you: { hand: ["Chrome Mox", "Grizzly Bears", "Sol Ring", "Forest"] }, active: "you" });
    const mox = at(y0, "you", "Chrome Mox", "hand").iid;
    const asked = playerEnters(playerCast(y0, mox, BOOK), mox, BOOK);
    expect(asked.choice).toMatchObject({ kind: "imprint", decline: "Exile nothing" });
    // Not the artifact, not the land.
    expect(choiceTargets(asked, BOOK)).toEqual([at(asked, "you", "Grizzly Bears", "hand").iid]);
    const done = resolveChoice(asked, at(asked, "you", "Grizzly Bears", "hand").iid, BOOK);
    expect(at(done, "you", "Chrome Mox").imprint).toEqual(["G"]);
    expect(availableMana(done, "you", BOOK).map((s) => s.colors)).toEqual([["G"]]);
    expect(mana(declineChoice(asked, BOOK), "you")).toBe(0);
  });

  it("Springleaf Drum needs a creature to tap, and taps it", () => {
    expect(mana(table({ opp: { field: ["Springleaf Drum"] } }))).toBe(0);
    const g0 = table({ opp: { field: ["Springleaf Drum", "Grizzly Bears"], hand: ["Lotus Petal", "Sol Ring"] } });
    expect(mana(g0)).toBe(1);
    const g = applyAction(g0, "opp", action("cast", at(g0, "opp", "Sol Ring", "hand").iid), BOOK).game;
    expect(at(g, "opp", "Springleaf Drum").tapped).toBe(true);
    expect(at(g, "opp", "Grizzly Bears").tapped).toBe(true);
  });

  it("a card with no mana cost (Lotus Bloom) isn't cast for nothing", () => {
    const g = table({ opp: { hand: ["Lotus Bloom"] } });
    expect(castable(g, "opp", at(g, "opp", "Lotus Bloom", "hand"), BOOK, "hand")).toBe(false);
    expect(applyAction(g, "opp", action("cast", at(g, "opp", "Lotus Bloom", "hand").iid), BOOK).ok).toBe(false);
  });
});

describe("lands that make more", () => {
  it("Gaea's Cradle counts creatures; Cabal Coffers counts Swamps, less the {2}", () => {
    expect(mana(table({ opp: { field: ["Gaea's Cradle"] } }))).toBe(0);
    expect(mana(table({ opp: { field: ["Gaea's Cradle", "Grizzly Bears", "Hill Giant"] } }))).toBe(2);
    // Two Swamps: Coffers would make two for {2}, which is nothing. Four: two more than it takes.
    expect(mana(table({ opp: { field: ["Cabal Coffers", "Swamp", "Swamp"] } }))).toBe(2);
    expect(mana(table({ opp: { field: ["Cabal Coffers", "Swamp", "Swamp", "Swamp", "Swamp"] } }))).toBe(6);
  });

  it("Ancient Tomb hurts, and is tapped after the lands that don't", () => {
    const g0 = table({ opp: { field: ["Ancient Tomb", "Plains", "Plains"], hand: ["Sol Ring", "Hill Giant", "Mountain"] } });
    const ring = applyAction(g0, "opp", action("cast", at(g0, "opp", "Sol Ring", "hand").iid), BOOK).game;
    expect(at(ring, "opp", "Ancient Tomb").tapped).toBe(false);
    expect(ring.sides.opp.life).toBe(40);
    const g1 = applyAction(applyAction(ring, "opp", action("land", at(ring, "opp", "Mountain", "hand").iid), BOOK).game, "opp", action("cast", at(ring, "opp", "Hill Giant", "hand").iid), BOOK).game;
    // Hill Giant: the Mountain, a Plains, the Ring... the Tomb only if it must.
    expect(g1.sides.opp.life).toBe(at(g1, "opp", "Ancient Tomb").tapped ? 38 : 40);
    const only = table({ opp: { field: ["Ancient Tomb"], hand: ["Sol Ring"] } });
    const paid = applyAction(only, "opp", action("cast", at(only, "opp", "Sol Ring", "hand").iid), BOOK).game;
    expect(paid.sides.opp.life).toBe(38);
    expect(texts(paid)).toContain("Ancient Tomb deals 2 damage to the opponent.");
  });

  it("City of Traitors is sacrificed when another land is played", () => {
    const g0 = table({ opp: { field: ["City of Traitors"], hand: ["Plains"] } });
    const g = applyAction(g0, "opp", action("land", at(g0, "opp", "Plains", "hand").iid), BOOK).game;
    expect(g.sides.opp.battlefield.map((c) => c.name)).toEqual(["Plains"]);
    expect(g.sides.opp.graveyard.map((c) => c.name)).toEqual(["City of Traitors"]);
    const y0 = table({ you: { field: ["City of Traitors"], hand: ["Forest"] }, active: "you" });
    const y = playerPlay(y0, at(y0, "you", "Forest", "hand").iid, BOOK);
    expect(y.sides.you.battlefield.map((c) => c.name)).toEqual(["Forest"]);
  });
});

describe("the untap step and the upkeep", () => {
  it("Mana Vault and Grim Monolith stay tapped, and a tapped Vault deals 1", () => {
    const g0 = table({ opp: { field: ["Mana Vault", "Grim Monolith", "Sol Ring", "Plains"] }, active: "you" });
    g0.sides.opp = { ...g0.sides.opp, battlefield: g0.sides.opp.battlefield.map((c) => ({ ...c, tapped: true })) };
    const g = endTurn(g0, BOOK);
    expect(g.active).toBe("opp");
    expect(g.sides.opp.battlefield.filter((c) => c.tapped).map((c) => c.name)).toEqual(["Mana Vault", "Grim Monolith"]);
    expect(g.sides.opp.life).toBe(39);
    expect(texts(g)).toContain("Mana Vault is tapped: it deals 1 damage to the opponent.");
    // Untapped, it deals nothing.
    const fresh = endTurn(table({ opp: { field: ["Mana Vault"] }, active: "you" }), BOOK);
    expect(fresh.sides.opp.life).toBe(40);
    expect(mana(fresh)).toBe(3);
  });

  it("Mana Crypt flips a coin each upkeep", () => {
    const g0 = table({ you: { field: ["Mana Crypt"] }, active: "you" });
    coin.flip = () => false;
    expect(startTurn(g0, BOOK).sides.you.life).toBe(37);
    coin.flip = () => true;
    const won = startTurn(g0, BOOK);
    expect(won.sides.you.life).toBe(40);
    expect(texts(won)).toContain("Mana Crypt: you win the flip.");
  });
});

describe("sneak", () => {
  const attackWith = (g0: PracticeGame, seat: "you" | "opp", name: string) => setBlocks(declareAttackers(g0, seat, [at(g0, seat, name).iid], BOOK), {}, BOOK);

  it("is read like ninjutsu, as a cast", () => {
    const leo = { ...at(table({ you: { hand: ["Leonardo, Cutting Edge"] } }), "you", "Leonardo, Cutting Edge", "hand") };
    expect(ninjutsuOf(BOOK, leo)).toEqual({ cost: "{W}", commander: false, sneak: true });
  });

  it("a creature is cast for its sneak cost and enters tapped and attacking", () => {
    const g0 = attackWith(table({ you: { field: ["Grizzly Bears", "Plains"], hand: ["Leonardo, Cutting Edge"] }, active: "you" }), "you", "Grizzly Bears");
    const [opt] = ninjutsuOptions(g0, "you", BOOK);
    expect(opt).toMatchObject({ cost: "{W}", sneak: true, spell: false });
    const g = ninjutsu(g0, "you", opt!.ninja.iid, at(g0, "you", "Grizzly Bears").iid, BOOK);
    const leo = at(g, "you", "Leonardo, Cutting Edge");
    expect(leo.tapped).toBe(true);
    expect(g.combat!.attackers).toEqual([leo.iid]);
    expect(g.sides.you.hand.map((c) => c.name)).toEqual(["Grizzly Bears"]);
    expect(at(g, "you", "Plains").tapped).toBe(true);
    expect(texts(g).at(-1)).toBe("You cast Leonardo, Cutting Edge for its sneak cost ({W}): it enters tapped and attacking in place of Grizzly Bears, which goes back to your hand.");
  });

  it("from the command zone it costs the tax too, and counts as a cast", () => {
    const base = table({ you: { field: ["Grizzly Bears", "Plains", "Plains", "Plains"], command: ["Leonardo, Cutting Edge"] }, active: "you" });
    const g0 = attackWith({ ...base, tax: { ...base.tax, you: 1 } }, "you", "Grizzly Bears");
    const [opt] = ninjutsuOptions(g0, "you", BOOK);
    expect(opt).toMatchObject({ zone: "command", cost: "{2}{W}" });
    const g = ninjutsu(g0, "you", opt!.ninja.iid, at(g0, "you", "Grizzly Bears").iid, BOOK);
    expect(g.tax.you).toBe(2);
    expect(g.sides.you.battlefield.filter((c) => c.tapped).length).toBe(4);
  });

  it("an instant or sorcery is cast: the attacker goes back, nothing takes its place", () => {
    const g0 = attackWith(table({ you: { field: ["Grizzly Bears", "Swamp", "Swamp"], hand: ["Splinter's Technique"] }, active: "you" }), "you", "Grizzly Bears");
    const [opt] = ninjutsuOptions(g0, "you", BOOK);
    expect(opt).toMatchObject({ cost: "{1}{B}", sneak: true, spell: true });
    const g = ninjutsu(g0, "you", opt!.ninja.iid, at(g0, "you", "Grizzly Bears").iid, BOOK);
    expect(g.combat!.attackers).toEqual([]);
    expect(g.sides.you.graveyard.map((c) => c.name)).toEqual(["Splinter's Technique"]);
    expect(g.sides.you.hand.map((c) => c.name)).toEqual(["Grizzly Bears"]);
  });

  it("no sneak without an unblocked attacker or the mana", () => {
    const g0 = attackWith(table({ you: { field: ["Grizzly Bears"], hand: ["Leonardo, Cutting Edge"] }, active: "you" }), "you", "Grizzly Bears");
    expect(ninjutsuOptions(g0, "you", BOOK)).toEqual([]);
  });
});

describe("loyalty counters", () => {
  it("a planeswalker starts with its loyalty, takes counters, and dies at none", () => {
    const g0 = table({ you: { field: ["Jace, the Mind Sculptor"] }, active: "you" });
    const jace = at(g0, "you", "Jace, the Mind Sculptor");
    expect(loyaltyOf(BOOK, jace)).toBe(3);
    expect(loyaltyOf(BOOK, at(table({ you: { field: ["Grizzly Bears"] } }), "you", "Grizzly Bears"))).toBeNull();
    const up = addLoyalty(g0, jace.iid, 2, BOOK);
    expect(loyaltyOf(BOOK, at(up, "you", "Jace, the Mind Sculptor"))).toBe(5);
    expect(texts(up).at(-1)).toBe("Jace, the Mind Sculptor: +2 loyalty (now 5).");
    const gone = addLoyalty(up, jace.iid, -5, BOOK);
    expect(gone.sides.you.battlefield).toEqual([]);
    expect(gone.sides.you.graveyard.map((c) => c.name)).toEqual(["Jace, the Mind Sculptor"]);
    // Back on the battlefield, it starts again.
    expect(loyaltyOf(BOOK, gone.sides.you.graveyard[0]!)).toBe(3);
  });
});

describe("the hand at the end of the turn", () => {
  const big = ["Forest", "Forest", "Forest", "Forest", "Grizzly Bears", "Grizzly Bears", "Hill Giant", "Hill Giant", "Sol Ring"];

  it("you're asked to discard down to seven, one card at a time", () => {
    let g = table({ you: { hand: big }, active: "you" });
    const asked = playerCleanup(g, BOOK);
    expect(asked.choice).toMatchObject({ kind: "discard", cleanup: true, loot: true });
    g = resolveChoice(asked, asked.sides.you.hand[8]!.iid, BOOK);
    expect(g.sides.you.hand.length).toBe(8);
    g = resolveChoice(playerCleanup(g, BOOK), g.sides.you.hand[7]!.iid, BOOK);
    // Seven: nothing more to ask.
    expect(playerCleanup(g, BOOK)).toBe(g);
    expect(g.sides.you.graveyard.map((c) => c.name)).toEqual(["Sol Ring", "Hill Giant"]);
  });

  it("not with seven cards, and not with no maximum hand size", () => {
    const seven = table({ you: { hand: big.slice(0, 7) }, active: "you" });
    expect(playerCleanup(seven, BOOK)).toBe(seven);
    const vessel = table({ you: { field: ["Thought Vessel"], hand: big }, active: "you" });
    expect(playerCleanup(vessel, BOOK)).toBe(vessel);
  });

  it("the AI discards down to seven at the end of its turn", () => {
    const g0 = table({ opp: { hand: big }, active: "opp" });
    const g = endTurn(g0, BOOK);
    expect(g.sides.opp.hand.length).toBe(7);
    expect(texts(g).some((t) => t.startsWith("The opponent discards down to 7 cards: "))).toBe(true);
    const vessel = endTurn(table({ opp: { field: ["Thought Vessel"], hand: big }, active: "opp" }), BOOK);
    expect(vessel.sides.opp.hand.length).toBe(9);
  });
});

describe("a commander that leaves", () => {
  it("the opponent's goes to its command zone when you destroy or exile it, and costs {2} more", () => {
    const base = table({ opp: { field: ["Kefka Test", "Island", "Swamp", "Mountain", "Plains", "Plains", "Plains", "Plains"] }, active: "you" });
    const g0: PracticeGame = { ...base, tax: { you: 0, opp: 1 }, sides: { ...base.sides, opp: { ...base.sides.opp, battlefield: base.sides.opp.battlefield.map((c) => (c.name === "Kefka Test" ? { ...c, commander: true } : c)) } } };
    const kefka = at(g0, "opp", "Kefka Test").iid;
    for (const zone of ["graveyard", "exile"] as const) {
      const g = moveAnyCard(g0, kefka, zone);
      expect(g.sides.opp.command.map((c) => c.name)).toEqual(["Kefka Test"]);
      expect(g.sides.opp[zone]).toEqual([]);
      expect(texts(g).slice(-2)).toEqual([`You ${zone === "exile" ? "exile" : "destroy"} Kefka Test.`, `Kefka Test goes to the command zone instead of ${zone === "exile" ? "exile" : "the graveyard"}.`]);
    }
    // Cast again: {2}{U}{B}{R} and {2} of tax is seven, all it has.
    const back = { ...moveAnyCard(g0, kefka, "graveyard"), active: "opp" as const };
    const cast = applyAction(back, "opp", action("cast", kefka), BOOK);
    expect(cast.ok).toBe(true);
    expect(cast.game.tax.opp).toBe(2);
    expect(cast.game.sides.opp.battlefield.filter((c) => c.tapped).length).toBe(7);
    // Returned to hand, it stays there.
    expect(moveAnyCard(g0, kefka, "hand").sides.opp.hand.map((c) => c.name)).toContain("Kefka Test");
  });

  it("dies in combat or to a spell: the command zone too", () => {
    const base = table({ opp: { field: ["Kefka Test"] }, active: "you" });
    const g0: PracticeGame = { ...base, sides: { ...base.sides, opp: { ...base.sides.opp, battlefield: base.sides.opp.battlefield.map((c) => ({ ...c, commander: true, damage: 9 })) } } };
    // Any move runs the state check: the damage kills it.
    const g = startTurn({ ...g0, active: "you" }, BOOK);
    expect(g.sides.opp.command.map((c) => c.name)).toEqual(["Kefka Test"]);
    expect(texts(g).slice(-2)).toEqual(["Kefka Test dies.", "Kefka Test goes to the command zone instead of the graveyard."]);
  });

  it("your own commander goes where you put it", () => {
    const base = table({ you: { field: ["Kefka Test"] }, active: "you" });
    const g0: PracticeGame = { ...base, sides: { ...base.sides, you: { ...base.sides.you, battlefield: base.sides.you.battlefield.map((c) => ({ ...c, commander: true })) } } };
    const g = moveAnyCard(g0, at(g0, "you", "Kefka Test").iid, "graveyard");
    expect(g.sides.you.graveyard.map((c) => c.name)).toEqual(["Kefka Test"]);
  });
});
