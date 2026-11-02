import { describe, expect, it } from "vitest";
import { chooseBlocks, aiMulligan, fallbackPlan } from "./ai";
import { counterOf, fetchOf, isCreature, isInstantSpeed, manaOutput, removalOf, searchAbility, searchOnCast } from "./cards";
import {
  addCounters,
  aiRemovalAction,
  aiResponds,
  applyAction,
  createTokens,
  finishSearch,
  playerCast,
  playerFind,
  cardId,
  declareAttackers,
  endTurn,
  findCard,
  newGame,
  OPP_IID_BASE,
  playerPlay,
  resolveCombat,
  setBlocks,
  startTurn,
  type DeckCard,
} from "./game";
import { manaSources, parseCost, payCost } from "./mana";
import type { CardBook, CardInfo, Effect, PlanAction, PracticeGame } from "./types";

const keep = <T,>(a: T[]) => [...a];

function info(name: string, o: Partial<CardInfo> = {}): CardInfo {
  return { name, imageUri: "", typeLine: "Creature — Test", manaCost: null, manaValue: 0, oracleText: "", power: null, toughness: null, keywords: [], producedMana: [], ...o };
}
const BOOK: CardBook = Object.fromEntries(
  [
    info("Forest", { typeLine: "Basic Land — Forest", producedMana: ["G"] }),
    info("Island", { typeLine: "Basic Land — Island", producedMana: ["U"] }),
    info("Breeding Pool", { typeLine: "Land — Forest Island", producedMana: ["G", "U"] }),
    info("Tapped Land", { typeLine: "Land", producedMana: ["G"], oracleText: "Tapped Land enters tapped.\n{T}: Add {G}." }),
    info("Misty Rainforest", { typeLine: "Land", oracleText: "{T}, Pay 1 life, Sacrifice Misty Rainforest: Search your library for a Forest or Island card." }),
    info("Sol Ring", { typeLine: "Artifact", manaCost: "{1}", manaValue: 1, producedMana: ["C"], oracleText: "{T}: Add {C}{C}." }),
    info("Llanowar Elves", { manaCost: "{G}", manaValue: 1, power: 1, toughness: 1, producedMana: ["G"], oracleText: "{T}: Add {G}." }),
    info("Grizzly Bears", { manaCost: "{1}{G}", manaValue: 2, power: 2, toughness: 2 }),
    info("Hill Giant", { manaCost: "{3}{R}", manaValue: 4, power: 3, toughness: 3 }),
    info("Serra Angel", { manaCost: "{3}{W}{W}", manaValue: 5, power: 4, toughness: 4, keywords: ["Flying", "Vigilance"] }),
    info("Giant Spider", { manaCost: "{3}{G}", manaValue: 4, power: 2, toughness: 4, keywords: ["Reach"] }),
    info("Raging Goblin", { manaCost: "{R}", manaValue: 1, power: 1, toughness: 1, keywords: ["Haste"] }),
    info("Goblin Heelcutter", { manaCost: "{3}{R}", manaValue: 4, power: 3, toughness: 2, keywords: ["Menace"] }),
    info("Typhoid Rats", { manaCost: "{B}", manaValue: 1, power: 1, toughness: 1, keywords: ["Deathtouch"] }),
    info("Craw Wurm", { manaCost: "{4}{G}{G}", manaValue: 6, power: 6, toughness: 4, keywords: ["Trample"] }),
    info("White Knight", { manaCost: "{W}{W}", manaValue: 2, power: 2, toughness: 2, keywords: ["First strike"] }),
    info("Vampire Nighthawk", { manaCost: "{1}{B}{B}", manaValue: 3, power: 2, toughness: 3, keywords: ["Flying", "Deathtouch", "Lifelink"] }),
    info("Darksteel Myr", { manaCost: "{3}", manaValue: 3, power: 0, toughness: 1, keywords: ["Indestructible"] }),
    info("Lightning Bolt", { typeLine: "Instant", manaCost: "{R}", manaValue: 1, oracleText: "Lightning Bolt deals 3 damage to any target." }),
    info("Commander Guy", { typeLine: "Legendary Creature — Elf", manaCost: "{G}", manaValue: 1, power: 2, toughness: 2 }),
    info("Fireball", { typeLine: "Sorcery", manaCost: "{X}{R}", manaValue: 1 }),
    info("Gitaxian Probe", { typeLine: "Sorcery", manaCost: "{U/P}", manaValue: 1 }),
    info("Mountain", { typeLine: "Basic Land — Mountain", producedMana: ["R"] }),
    info("Scalding Tarn", { typeLine: "Land", oracleText: "{T}, Pay 1 life, Sacrifice Scalding Tarn: Search your library for an Island or Mountain card, put it onto the battlefield, then shuffle." }),
    info("Evolving Wilds", { typeLine: "Land", oracleText: "{T}, Sacrifice Evolving Wilds: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle." }),
    info("Steam Vents", { typeLine: "Land — Island Mountain", producedMana: ["U", "R"], oracleText: "({T}: Add {U} or {R}.)\nAs Steam Vents enters the battlefield, you may pay 2 life. If you don't, it enters the battlefield tapped." }),
    info("Thran Portal", { typeLine: "Land — Gate", oracleText: "Thran Portal enters the battlefield tapped unless you control two or fewer other lands.\nAs Thran Portal enters the battlefield, choose a basic land type.\nThran Portal is the chosen type in addition to its other types." }),
    info("Lotus Petal", { typeLine: "Artifact", manaCost: "{0}", producedMana: ["W", "U", "B", "R", "G"], oracleText: "{T}, Sacrifice Lotus Petal: Add one mana of any color." }),
    info("Rite of Flame", { typeLine: "Sorcery", manaCost: "{R}", manaValue: 1, oracleText: "Add {R}{R}, then add {R} for each card named Rite of Flame in each graveyard." }),
    info("Vivi Ornitier", { typeLine: "Legendary Creature — Wizard", manaCost: "{1}{U}{R}", manaValue: 3, power: 0, toughness: 3 }),
    info("Counterspell", { typeLine: "Instant", manaCost: "{U}{U}", manaValue: 2, oracleText: "Counter target spell." }),
    info("Swan Song", { typeLine: "Instant", manaCost: "{U}", manaValue: 1, oracleText: "Counter target enchantment, instant, or sorcery spell. Its controller creates a 2/2 blue Bird creature token with flying." }),
    info("Force of Will", { typeLine: "Instant", manaCost: "{3}{U}{U}", manaValue: 5, oracleText: "You may pay 1 life and exile a blue card from your hand rather than pay this spell's mana cost.\nCounter target spell." }),
    info("Fierce Guardianship", { typeLine: "Instant", manaCost: "{2}{U}", manaValue: 3, oracleText: "If you control a commander, you may cast this spell without paying its mana cost.\nCounter target noncreature spell." }),
    info("Mental Misstep", { typeLine: "Instant", manaCost: "{U/P}", manaValue: 1, oracleText: "Counter target spell with mana value 1." }),
    info("Daze", { typeLine: "Instant", manaCost: "{1}{U}", manaValue: 2, oracleText: "You may return an Island you control to its owner's hand rather than pay this spell's mana cost.\nCounter target spell unless its controller pays {1}." }),
    info("Pyroblast", { typeLine: "Instant", manaCost: "{R}", manaValue: 1, oracleText: "Choose one —\n• Counter target spell if it's blue.\n• Destroy target permanent if it's blue." }),
    info("Brainstorm", { typeLine: "Instant", manaCost: "{U}", manaValue: 1, oracleText: "Draw three cards, then put two cards from your hand on top of your library in any order." }),
    info("Divination", { typeLine: "Sorcery", manaCost: "{2}{U}", manaValue: 3, oracleText: "Draw two cards." }),
    info("Swords to Plowshares", { typeLine: "Instant", manaCost: "{W}", manaValue: 1, oracleText: "Exile target creature. Its controller gains life equal to its power." }),
    info("Doom Blade", { typeLine: "Instant", manaCost: "{1}{B}", manaValue: 2, oracleText: "Destroy target nonblack creature." }),
    info("Into the Roil", { typeLine: "Instant", manaCost: "{1}{U}", manaValue: 2, oracleText: "Kicker {1}{U}\nReturn target nonland permanent to its owner's hand. If this spell was kicked, draw a card." }),
    info("Plains", { typeLine: "Basic Land — Plains", producedMana: ["W"] }),
    info("Swamp", { typeLine: "Basic Land — Swamp", producedMana: ["B"] }),
    info("Shatterskull Smashing // Shatterskull, the Shattered", {
      typeLine: "Sorcery // Land",
      manaCost: "{X}{R}{R} // ",
      manaValue: 2,
      producedMana: ["R"],
      oracleText: "Shatterskull Smashing deals X damage divided as you choose among up to two target creatures and/or planeswalkers.\n//\nAs Shatterskull, the Shattered enters the battlefield, you may pay 3 life. If you don't, it enters the battlefield tapped.\n{T}: Add {R}.",
    }),
  ].map((c) => [c.name.toLowerCase(), c])
);
const deck = (...names: string[]): DeckCard[] => names.map((name) => ({ name, imageUri: "", typeLine: BOOK[name.toLowerCase()]!.typeLine }));

const effect = (o: Partial<Effect>): Effect => ({ type: "note", target: null, player: null, amount: null, name: null, power: null, toughness: null, keywords: [], to: null, tapped: null, text: null, ...o });
const action = (kind: PlanAction["kind"], iid: number, o: Partial<PlanAction> = {}): PlanAction => ({ kind, card: cardId(iid), x: null, tap_card: null, sacrifice_card: null, mana: null, life: null, effects: [], ...o });

/** A game with chosen cards: the AI (opp) holds `oppHand`, its battlefield
    `oppField`; yours `youField`. It's the opponent's turn 3. */
function table(o: { oppHand?: string[]; oppField?: string[]; youField?: string[]; youHand?: string[]; oppLibrary?: string[]; commanderGame?: boolean; oppCommander?: string } = {}): PracticeGame {
  let g = newGame({
    you: { cards: deck(...(o.youField ?? []), ...(o.youHand ?? []), ...Array(10).fill("Forest")) },
    opp: { cards: deck(...(o.oppHand ?? []), ...(o.oppField ?? []), ...(o.oppLibrary ?? []), ...Array(10).fill("Island"), ...(o.oppCommander ? [o.oppCommander] : [])), commander: o.oppCommander },
    commanderGame: !!o.commanderGame,
    first: "opp",
    shuffle: keep,
  });
  // Lay the table out by hand: everything back in the library, then dealt.
  for (const seat of ["you", "opp"] as const) {
    const side = g.sides[seat];
    g.sides[seat] = { ...side, library: [...side.hand, ...side.library], hand: [] };
  }
  const deal = (seat: "you" | "opp", names: string[], zone: "hand" | "battlefield") => {
    for (const name of names) {
      const side = g.sides[seat];
      const card = side.library.find((c) => c.name === name)!;
      g.sides[seat] = { ...side, library: side.library.filter((c) => c !== card), [zone]: [...side[zone], zone === "battlefield" ? { ...card, enteredTurn: 0 } : card] };
    }
  };
  deal("opp", o.oppHand ?? [], "hand");
  deal("opp", o.oppField ?? [], "battlefield");
  deal("you", o.youField ?? [], "battlefield");
  deal("you", o.youHand ?? [], "hand");
  g = { ...g, turn: 3, active: "opp" };
  return g;
}
const iidOf = (g: PracticeGame, seat: "you" | "opp", name: string, zone: "hand" | "battlefield" | "command" | "library" = "battlefield") =>
  g.sides[seat][zone].find((c) => c.name === name)!.iid;

describe("mana", () => {
  it("reads costs: generic, colours, hybrid, phyrexian, X", () => {
    expect(parseCost("{2}{G}{G}")).toEqual({ generic: 2, pips: [["G"], ["G"]], phyrexian: [], xCount: 0 });
    expect(parseCost("{X}{R}").xCount).toBe(1);
    expect(parseCost("{G/U}").pips).toEqual([["G", "U"]]);
    expect(parseCost("{U/P}").phyrexian).toEqual(["U"]);
    expect(parseCost("{1}{W} // {3}{U}").generic).toBe(1);
  });

  it("knows what a permanent makes: Sol Ring two, a basic its colour", () => {
    expect(manaOutput(BOOK["sol ring"], "Artifact")).toEqual({ colors: ["C"], amount: 2, sacrifice: false });
    expect(manaOutput(info("Snow Forest", { typeLine: "Basic Snow Land — Forest" }), "Basic Snow Land — Forest")).toEqual({ colors: ["G"], amount: 1, sacrifice: false });
    expect(manaOutput(BOOK["misty rainforest"], "Land")).toBeNull();
  });

  it("pays colours from the narrowest source first, then generic, and X", () => {
    const sources = [
      { iid: 1, name: "Breeding Pool", colors: ["G", "U"], amount: 1 },
      { iid: 2, name: "Forest", colors: ["G"], amount: 1 },
      { iid: 3, name: "Island", colors: ["U"], amount: 1 },
    ];
    // {G}{U}: the Forest pays G and the Island U, keeping the dual free.
    expect(payCost(parseCost("{G}{U}"), sources)?.tap.sort()).toEqual([2, 3]);
    expect(payCost(parseCost("{2}{G}"), sources)?.tap).toHaveLength(3);
    expect(payCost(parseCost("{G}{G}{G}"), sources)).toBeNull();
    expect(payCost(parseCost("{X}{G}"), sources, { x: 2 })?.tap).toHaveLength(3);
    expect(payCost(parseCost("{X}{G}"), sources, { x: 3 })).toBeNull();
    expect(payCost(parseCost("{B/P}"), sources)).toEqual({ tap: [], life: 2 });
    expect(payCost(parseCost("{2}"), [{ iid: 9, name: "Sol Ring", colors: ["C"], amount: 2 }])?.tap).toEqual([9]);
  });

  it("doesn't count summoning-sick creatures or tapped sources", () => {
    let g = table({ oppField: ["Forest", "Sol Ring"] });
    g.sides.opp.battlefield.push({ ...g.sides.opp.library.find((c) => c.name === "Island")!, name: "Llanowar Elves", typeLine: "Creature — Elf Druid", enteredTurn: 3 });
    expect(manaSources(g.sides.opp, BOOK, 3).map((s) => s.name).sort()).toEqual(["Forest", "Sol Ring"]);
    g = { ...g, sides: { ...g.sides, opp: { ...g.sides.opp, battlefield: g.sides.opp.battlefield.map((c) => (c.name === "Forest" ? { ...c, tapped: true } : c)) } } };
    expect(manaSources(g.sides.opp, BOOK, 3).map((s) => s.name)).toEqual(["Sol Ring"]);
  });
});

describe("a game", () => {
  it("deals seven each, with ids that never collide and the commander seated", () => {
    const g = newGame({
      you: { cards: deck(...Array(20).fill("Forest")) },
      opp: { cards: deck("Commander Guy", ...Array(20).fill("Island")), commander: "Commander Guy" },
      commanderGame: true,
      first: "you",
      shuffle: keep,
    });
    expect(g.sides.you.hand).toHaveLength(7);
    expect(g.sides.opp.hand).toHaveLength(7);
    expect(g.sides.you.life).toBe(40);
    expect(g.sides.opp.command.map((c) => c.name)).toEqual(["Commander Guy"]);
    expect(g.sides.opp.hand.every((c) => c.iid > OPP_IID_BASE)).toBe(true);
  });

  it("skips the first player's first draw, and untaps and draws after", () => {
    let g = newGame({ you: { cards: deck(...Array(20).fill("Forest")) }, opp: { cards: deck(...Array(20).fill("Island")) }, commanderGame: false, first: "you", shuffle: keep });
    g = startTurn(g);
    expect(g.sides.you.hand).toHaveLength(7);
    g = playerPlay(g, g.sides.you.hand[0]!.iid);
    g = { ...g, sides: { ...g.sides, you: { ...g.sides.you, battlefield: g.sides.you.battlefield.map((c) => ({ ...c, tapped: true })) } } };
    g = endTurn(g);
    expect(g.active).toBe("opp");
    expect(g.turn).toBe(2);
    expect(g.sides.opp.hand).toHaveLength(8);
    g = endTurn(g);
    expect(g.sides.you.hand).toHaveLength(7);
    expect(g.sides.you.battlefield.every((c) => !c.tapped)).toBe(true);
  });

  it("ends when a player draws from an empty library", () => {
    let g = newGame({ you: { cards: deck(...Array(7).fill("Forest")) }, opp: { cards: deck(...Array(20).fill("Island")) }, commanderGame: false, first: "opp", shuffle: keep });
    g = endTurn(startTurn(g));
    expect(g.winner).toBe("opp");
  });
});

describe("the AI's moves", () => {
  it("plays one land a turn; a tapped land enters tapped", () => {
    let g = table({ oppHand: ["Tapped Land", "Forest"] });
    let step = applyAction(g, "opp", action("land", iidOf(g, "opp", "Tapped Land", "hand")), BOOK);
    expect(step.ok).toBe(true);
    g = step.game;
    expect(g.sides.opp.battlefield.find((c) => c.name === "Tapped Land")!.tapped).toBe(true);
    step = applyAction(g, "opp", action("land", iidOf(g, "opp", "Forest", "hand")), BOOK);
    expect(step.ok).toBe(false);
  });

  it("casts what it can pay for, tapping the mana, and refuses what it can't", () => {
    const g = table({ oppHand: ["Grizzly Bears", "Hill Giant"], oppField: ["Forest", "Island"] });
    const step = applyAction(g, "opp", action("cast", iidOf(g, "opp", "Grizzly Bears", "hand")), BOOK);
    expect(step.ok).toBe(true);
    expect(step.game.sides.opp.battlefield.find((c) => c.name === "Grizzly Bears")!.enteredTurn).toBe(3);
    expect(step.game.sides.opp.battlefield.filter((c) => c.tapped).map((c) => c.name).sort()).toEqual(["Forest", "Island"]);
    const no = applyAction(g, "opp", action("cast", iidOf(g, "opp", "Hill Giant", "hand")), BOOK);
    expect(no.ok).toBe(false);
    expect(no.game.log.at(-1)!.text).toMatch(/can't pay for Hill Giant/);
  });

  it("charges commander tax", () => {
    let g = table({ oppField: ["Forest", "Forest"], commanderGame: true, oppCommander: "Commander Guy" });
    const guy = iidOf(g, "opp", "Commander Guy", "command");
    g = applyAction(g, "opp", action("cast", guy), BOOK).game;
    expect(g.tax.opp).toBe(1);
    // Back to the command zone; now it costs {2}{G} and there's one Forest left.
    g = { ...g, sides: { ...g.sides, opp: { ...g.sides.opp, battlefield: g.sides.opp.battlefield.filter((c) => c.iid !== guy), command: [findCard(g, guy)!.card] } } };
    expect(applyAction(g, "opp", action("cast", guy), BOOK).ok).toBe(false);
  });

  it("resolves a burn spell at a creature and at you, X spells and phyrexian mana", () => {
    let g = table({ oppHand: ["Lightning Bolt", "Fireball", "Gitaxian Probe"], oppField: ["Forest", "Forest", "Forest"], youField: ["Grizzly Bears"] });
    g.sides.opp.battlefield.push({ iid: 999, name: "Mountain", imageUri: "", typeLine: "Basic Land — Mountain", tapped: false, commander: false, enteredTurn: 0 });
    g.sides.opp.battlefield.push({ iid: 998, name: "Mountain", imageUri: "", typeLine: "Basic Land — Mountain", tapped: false, commander: false, enteredTurn: 0 });
    const bears = iidOf(g, "you", "Grizzly Bears");
    g = applyAction(g, "opp", action("cast", iidOf(g, "opp", "Lightning Bolt", "hand"), { effects: [effect({ type: "damage", target: cardId(bears), amount: 3 })] }), BOOK).game;
    expect(g.sides.you.graveyard.map((c) => c.name)).toContain("Grizzly Bears");
    expect(g.sides.opp.graveyard.map((c) => c.name)).toContain("Lightning Bolt");
    g = applyAction(g, "opp", action("cast", iidOf(g, "opp", "Fireball", "hand"), { x: 3, effects: [effect({ type: "damage", target: "player", amount: 3 })] }), BOOK).game;
    expect(g.sides.you.life).toBe(17);
    g = applyAction(g, "opp", action("cast", iidOf(g, "opp", "Gitaxian Probe", "hand")), BOOK).game;
    expect(g.sides.opp.life).toBe(18);
  });

  it("cracks a fetch: tap, life, sacrifice, search", () => {
    const g = table({ oppField: ["Misty Rainforest"], oppLibrary: ["Breeding Pool"] });
    const step = applyAction(
      g,
      "opp",
      action("activate", iidOf(g, "opp", "Misty Rainforest"), { tap_card: true, sacrifice_card: true, life: 1, effects: [effect({ type: "search", name: "Breeding Pool", to: "battlefield" })] }),
      BOOK
    );
    expect(step.ok).toBe(true);
    expect(step.game.sides.opp.life).toBe(19);
    expect(step.game.sides.opp.graveyard.map((c) => c.name)).toEqual(["Misty Rainforest"]);
    expect(step.game.sides.opp.battlefield.map((c) => c.name)).toEqual(["Breeding Pool"]);
  });

  it("applies the other effects, and skips what isn't a legal target", () => {
    let g = table({ oppHand: ["Grizzly Bears"], oppField: ["Forest", "Forest", "Darksteel Myr"], youField: ["Serra Angel", "Hill Giant"] });
    const angel = iidOf(g, "you", "Serra Angel");
    const giant = iidOf(g, "you", "Hill Giant");
    const myr = iidOf(g, "opp", "Darksteel Myr");
    g = applyAction(
      g,
      "opp",
      action("cast", iidOf(g, "opp", "Grizzly Bears", "hand"), {
        effects: [
          effect({ type: "destroy", target: cardId(myr) }),
          effect({ type: "bounce", target: cardId(angel) }),
          effect({ type: "tap", target: cardId(giant) }),
          effect({ type: "token", name: "Saproling", power: 1, toughness: 1, amount: 2 }),
          effect({ type: "counters", target: cardId(myr), amount: 2 }),
          effect({ type: "draw", player: "ai", amount: 2 }),
          effect({ type: "life", player: "player", amount: -2 }),
          effect({ type: "destroy", target: "c424242" }),
          effect({ type: "note", text: "Each player sacrifices a creature." }),
        ],
      }),
      BOOK
    ).game;
    expect(g.sides.opp.battlefield.some((c) => c.iid === myr)).toBe(true); // indestructible
    expect(g.sides.you.hand.map((c) => c.name)).toContain("Serra Angel");
    expect(g.sides.you.battlefield.find((c) => c.iid === giant)!.tapped).toBe(true);
    expect(g.sides.opp.battlefield.filter((c) => c.name === "Saproling")).toHaveLength(2);
    expect(g.sides.opp.battlefield.find((c) => c.iid === myr)!.counters).toBe(2);
    expect(g.sides.opp.hand).toHaveLength(2);
    expect(g.sides.you.life).toBe(18);
    expect(g.log.some((l) => l.text === "Resolve: Each player sacrifices a creature.")).toBe(true);
  });

  it("removes a token that leaves the battlefield", () => {
    let g = table({ oppHand: ["Grizzly Bears"], oppField: ["Forest", "Forest"] });
    g = applyAction(g, "opp", action("cast", iidOf(g, "opp", "Grizzly Bears", "hand"), { effects: [effect({ type: "token", name: "Spirit", power: 1, toughness: 1, player: "player" })] }), BOOK).game;
    const spirit = iidOf(g, "you", "Spirit");
    g.sides.opp.hand.push({ iid: 777, name: "Lightning Bolt", imageUri: "", typeLine: "Instant", tapped: false, commander: false });
    g.sides.opp.battlefield.push({ iid: 778, name: "Mountain", imageUri: "", typeLine: "Basic Land — Mountain", tapped: false, commander: false, enteredTurn: 0 });
    g = applyAction(g, "opp", action("cast", 777, { effects: [effect({ type: "bounce", target: cardId(spirit) })] }), BOOK).game;
    expect(findCard(g, spirit)).toBeNull();
  });
});

describe("combat", () => {
  const fight = (g: PracticeGame, attackers: string[], blocks: Record<string, string[]> = {}) => {
    const seat = g.active;
    const def = seat === "you" ? "opp" : "you";
    g = declareAttackers(g, seat, attackers.map((n) => iidOf(g, seat, n)), BOOK);
    const map: Record<number, number[]> = {};
    for (const [a, bs] of Object.entries(blocks)) map[iidOf(g, seat, a)] = bs.map((b) => iidOf(g, def, b));
    return resolveCombat(setBlocks(g, map, BOOK), BOOK);
  };

  it("unblocked damage, vigilance, and summoning sickness (haste aside)", () => {
    let g = table({ oppField: ["Serra Angel", "Raging Goblin", "Grizzly Bears"] });
    g.sides.opp.battlefield = g.sides.opp.battlefield.map((c) => (c.name !== "Serra Angel" ? { ...c, enteredTurn: 3 } : c));
    g = declareAttackers(g, "opp", g.sides.opp.battlefield.map((c) => c.iid), BOOK);
    expect(g.combat!.attackers.map((i) => findCard(g, i)!.card.name).sort()).toEqual(["Raging Goblin", "Serra Angel"]);
    expect(g.sides.opp.battlefield.find((c) => c.name === "Serra Angel")!.tapped).toBe(false);
    g = resolveCombat(g, BOOK);
    expect(g.sides.you.life).toBe(15);
  });

  it("flying needs flying or reach to block; menace needs two", () => {
    let g = table({ oppField: ["Serra Angel", "Goblin Heelcutter"], youField: ["Grizzly Bears", "Giant Spider"] });
    g = declareAttackers(g, "opp", [iidOf(g, "opp", "Serra Angel"), iidOf(g, "opp", "Goblin Heelcutter")], BOOK);
    g = setBlocks(
      g,
      { [iidOf(g, "opp", "Serra Angel")]: [iidOf(g, "you", "Grizzly Bears")], [iidOf(g, "opp", "Goblin Heelcutter")]: [iidOf(g, "you", "Giant Spider")] },
      BOOK
    );
    expect(g.combat!.blocks).toEqual({});
  });

  it("first strike kills before damage back; deathtouch and lifelink; trample over", () => {
    let g = table({ oppField: ["White Knight"], youField: ["Grizzly Bears"] });
    g = fight(g, ["White Knight"], { "White Knight": ["Grizzly Bears"] });
    expect(g.sides.you.graveyard.map((c) => c.name)).toEqual(["Grizzly Bears"]);
    expect(g.sides.opp.battlefield.map((c) => c.name)).toEqual(["White Knight"]);

    g = table({ oppField: ["Vampire Nighthawk"], youField: ["Giant Spider"] });
    g = fight(g, ["Vampire Nighthawk"], { "Vampire Nighthawk": ["Giant Spider"] });
    expect(g.sides.you.graveyard.map((c) => c.name)).toEqual(["Giant Spider"]);
    expect(g.sides.opp.life).toBe(22);

    g = table({ oppField: ["Craw Wurm"], youField: ["Grizzly Bears"] });
    g = fight(g, ["Craw Wurm"], { "Craw Wurm": ["Grizzly Bears"] });
    expect(g.sides.you.life).toBe(16);
  });

  it("damage wears off at end of turn", () => {
    let g = table({ oppField: ["Hill Giant"], youField: ["Grizzly Bears", "Typhoid Rats"] });
    g = fight(g, ["Hill Giant"], { "Hill Giant": ["Grizzly Bears"] });
    expect(g.sides.opp.battlefield.find((c) => c.name === "Hill Giant")!.damage).toBe(2);
    g = endTurn(g);
    expect(g.sides.opp.battlefield.find((c) => c.name === "Hill Giant")!.damage).toBeUndefined();
  });

  it("commander damage counts to 21; life at 0 ends it", () => {
    let g = table({ commanderGame: true, oppCommander: "Commander Guy" });
    const guy = iidOf(g, "opp", "Commander Guy", "command");
    g.sides.opp.command = [];
    g.sides.opp.battlefield.push({ ...findCard(newGame({ you: { cards: [] }, opp: { cards: deck("Commander Guy"), commander: "Commander Guy" }, commanderGame: true, first: "opp", shuffle: keep }), OPP_IID_BASE + 1)!.card, iid: guy, enteredTurn: 0, counters: 19 });
    g.cmdDamage.you = 0;
    g = fight(g, ["Commander Guy"]);
    expect(g.cmdDamage.you).toBe(21);
    expect(g.winner).toBe("opp");
  });
});

describe("the AI's judgement without a model", () => {
  it("blocks to win, chumps to survive, trades up", () => {
    let g = table({ oppField: ["Grizzly Bears"], youField: ["Giant Spider"] });
    g = { ...g, active: "opp" };
    g = declareAttackers(g, "opp", [iidOf(g, "opp", "Grizzly Bears")], BOOK);
    // The AI defends here, so swap roles: you attack, it blocks.
    let h = table({ youField: ["Grizzly Bears", "Hill Giant"], oppField: ["Giant Spider", "Llanowar Elves"] });
    h = { ...h, active: "you" };
    h = declareAttackers(h, "you", [iidOf(h, "you", "Grizzly Bears"), iidOf(h, "you", "Hill Giant")], BOOK);
    const blocks = chooseBlocks(h, BOOK);
    // The Spider (2/4) eats the Bears (2/2) and lives.
    expect(blocks[iidOf(h, "you", "Grizzly Bears")]).toEqual([iidOf(h, "opp", "Giant Spider")]);
    expect(blocks[iidOf(h, "you", "Hill Giant")]).toBeUndefined();

    let lethal = table({ youField: ["Hill Giant"], oppField: ["Llanowar Elves"] });
    lethal = { ...lethal, active: "you", sides: { ...lethal.sides, opp: { ...lethal.sides.opp, life: 3 } } };
    lethal = declareAttackers(lethal, "you", [iidOf(lethal, "you", "Hill Giant")], BOOK);
    expect(chooseBlocks(lethal, BOOK)[iidOf(lethal, "you", "Hill Giant")]).toEqual([iidOf(lethal, "opp", "Llanowar Elves")]);
    expect(g.combat).not.toBeNull();
  });

  it("falls back to a land, the biggest permanents it can pay for, and safe attacks", () => {
    const g = table({ oppHand: ["Forest", "Grizzly Bears", "Hill Giant", "Lightning Bolt"], oppField: ["Forest", "Island", "Hill Giant"], youField: ["Grizzly Bears"] });
    const plan = fallbackPlan(g, BOOK);
    expect(plan.main.map((a) => [a.kind, findCard(g, Number(a.card.slice(1)))!.card.name])).toEqual([
      ["land", "Forest"],
      ["cast", "Grizzly Bears"],
    ]);
    // The Hill Giant (3/3) can attack: the Bears can't kill it.
    expect(plan.attack.map((id) => findCard(g, Number(id.slice(1)))!.card.name)).toEqual(["Hill Giant"]);
  });

  it("mulligans a hand with no lands, keeping six", () => {
    const g = newGame({ you: { cards: deck(...Array(20).fill("Forest")) }, opp: { cards: deck(...Array(7).fill("Hill Giant"), ...Array(10).fill("Island")) }, commanderGame: false, first: "you", shuffle: keep });
    const side = aiMulligan(g.sides.opp, BOOK);
    expect(side.mulligans).toBe(1);
    expect(side.hand).toHaveLength(6);
  });
});

describe("lands and fast mana", () => {
  it("reads one-shot sources, chosen-type lands and fetches", () => {
    expect(manaOutput(BOOK["lotus petal"], "Artifact")?.sacrifice).toBe(true);
    expect(manaOutput(BOOK["thran portal"], "Land — Gate")?.colors).toEqual(["W", "U", "B", "R", "G"]);
    expect(manaOutput(BOOK["scalding tarn"], "Land")).toBeNull();
    expect(fetchOf(BOOK["scalding tarn"])).toEqual({ types: ["island", "mountain"], basic: false, tapped: false, life: 1 });
    expect(fetchOf(BOOK["evolving wilds"])).toEqual({ types: ["land"], basic: true, tapped: true, life: 0 });
  });

  it("cracks a fetch land at once, for the land the hand needs", () => {
    const g0 = table({ oppHand: ["Scalding Tarn", "Vivi Ornitier"], oppField: ["Island", "Island"], oppLibrary: ["Mountain", "Steam Vents"] });
    const g = applyAction(g0, "opp", action("land", iidOf(g0, "opp", "Scalding Tarn", "hand")), BOOK).game;
    const field = g.sides.opp.battlefield.map((c) => c.name);
    // Steam Vents (red, the missing colour, and blue) over a Mountain; untapped for 2 life, plus 1 for the fetch.
    expect(field).toEqual(["Island", "Island", "Steam Vents"]);
    expect(g.sides.opp.battlefield.find((c) => c.name === "Steam Vents")!.tapped).toBe(false);
    expect(g.sides.opp.graveyard.map((c) => c.name)).toEqual(["Scalding Tarn"]);
    expect(g.sides.opp.life).toBe(17);
    // And now Vivi is castable.
    const vivi = applyAction(g, "opp", action("cast", iidOf(g, "opp", "Vivi Ornitier", "hand")), BOOK);
    expect(vivi.ok).toBe(true);
  });

  it("a ritual's mana floats for the next spell, and is gone at the end of the turn", () => {
    const g0 = table({ oppHand: ["Rite of Flame", "Vivi Ornitier"], oppField: ["Mountain", "Island"] });
    let g = applyAction(g0, "opp", action("cast", iidOf(g0, "opp", "Rite of Flame", "hand"), { effects: [effect({ type: "mana", text: "{R}{R}" })] }), BOOK).game;
    expect(g.pool?.opp).toEqual(["R", "R"]);
    const step = applyAction(g, "opp", action("cast", iidOf(g, "opp", "Vivi Ornitier", "hand")), BOOK);
    expect(step.ok).toBe(true);
    expect(step.game.pool?.opp).toEqual([]);
    expect(step.game.sides.opp.battlefield.find((c) => c.name === "Island")!.tapped).toBe(true);
    g = applyAction(g0, "opp", action("cast", iidOf(g0, "opp", "Rite of Flame", "hand"), { effects: [effect({ type: "mana", text: "{R}{R}" })] }), BOOK).game;
    expect(endTurn(g).pool?.opp).toEqual([]);
  });

  it("uses a land before a one-shot source, and sacrifices the one-shot when it must", () => {
    const g0 = table({ oppHand: ["Raging Goblin", "Lightning Bolt"], oppField: ["Mountain", "Lotus Petal"] });
    let g = applyAction(g0, "opp", action("cast", iidOf(g0, "opp", "Raging Goblin", "hand")), BOOK).game;
    expect(g.sides.opp.battlefield.find((c) => c.name === "Lotus Petal")!.tapped).toBe(false);
    g = applyAction(g, "opp", action("cast", iidOf(g, "opp", "Lightning Bolt", "hand")), BOOK).game;
    expect(g.sides.opp.graveyard.map((c) => c.name)).toContain("Lotus Petal");
  });
});

describe("counterspells on your turn", () => {
  it("reads what a counter can hit", () => {
    const creature = { typeLine: "Creature — Giant", manaValue: 4, blue: false };
    const sorcery = { typeLine: "Sorcery", manaValue: 3, blue: true };
    expect(counterOf(BOOK["counterspell"])!.hits(creature)).toBe(true);
    expect(counterOf(BOOK["swan song"])!.hits(creature)).toBe(false);
    expect(counterOf(BOOK["swan song"])!.hits(sorcery)).toBe(true);
    expect(counterOf(BOOK["swan song"])!.rider).toMatch(/^Its controller creates a 2\/2 blue Bird/);
    expect(counterOf(BOOK["fierce guardianship"])!.hits(creature)).toBe(false);
    expect(counterOf(BOOK["fierce guardianship"])!.free).toBe("commander");
    expect(counterOf(BOOK["force of will"])!.free).toBe("exile-blue");
    expect(counterOf(BOOK["mental misstep"])!.hits({ ...creature, manaValue: 1 })).toBe(true);
    expect(counterOf(BOOK["mental misstep"])!.hits(creature)).toBe(false);
    expect(counterOf(BOOK["pyroblast"])!.hits(creature)).toBe(false);
    expect(counterOf(BOOK["pyroblast"])!.hits(sorcery)).toBe(true);
    expect(counterOf(BOOK["daze"])).toBeNull();
    expect(counterOf(BOOK["brainstorm"])).toBeNull();
  });

  const yourTurn = (g: PracticeGame): PracticeGame => ({ ...g, active: "you" });
  const cast = (g: PracticeGame, name: string) => {
    const iid = iidOf(g, "you", name, "hand");
    return aiResponds(playerPlay(g, iid), iid, BOOK);
  };

  it("counters a spell worth it with open mana", () => {
    const g0 = yourTurn(table({ youHand: ["Hill Giant"], oppHand: ["Counterspell"], oppField: ["Island", "Island"] }));
    const g = cast(g0, "Hill Giant");
    expect(g.sides.you.battlefield.map((c) => c.name)).not.toContain("Hill Giant");
    expect(g.sides.you.graveyard.map((c) => c.name)).toContain("Hill Giant");
    expect(g.sides.opp.graveyard.map((c) => c.name)).toEqual(["Counterspell"]);
    expect(g.sides.opp.battlefield.every((c) => c.tapped)).toBe(true);
    expect(g.log.at(-1)!.text).toBe("The opponent counters Hill Giant with Counterspell.");
  });

  it("lets it be: the wrong kind of spell, a one-drop, or no mana", () => {
    expect(cast(yourTurn(table({ youHand: ["Hill Giant"], oppHand: ["Swan Song"], oppField: ["Island"] })), "Hill Giant").sides.you.battlefield.map((c) => c.name)).toContain("Hill Giant");
    expect(cast(yourTurn(table({ youHand: ["Raging Goblin"], oppHand: ["Counterspell"], oppField: ["Island", "Island"] })), "Raging Goblin").sides.you.battlefield.map((c) => c.name)).toContain("Raging Goblin");
    expect(cast(yourTurn(table({ youHand: ["Hill Giant"], oppHand: ["Counterspell"], oppField: ["Island"] })), "Hill Giant").sides.you.battlefield.map((c) => c.name)).toContain("Hill Giant");
  });

  it("Mental Misstep is for one-drops", () => {
    const g = cast(yourTurn(table({ youHand: ["Raging Goblin"], oppHand: ["Mental Misstep"], oppField: ["Island"] })), "Raging Goblin");
    expect(g.sides.you.graveyard.map((c) => c.name)).toContain("Raging Goblin");
  });

  it("free counters: Force of Will pitches a blue card at a big spell; Fierce Guardianship is free with the commander out", () => {
    let g = cast(yourTurn(table({ youHand: ["Craw Wurm"], oppHand: ["Force of Will", "Brainstorm"] })), "Craw Wurm");
    expect(g.sides.you.graveyard.map((c) => c.name)).toContain("Craw Wurm");
    expect(g.sides.opp.exile.map((c) => c.name)).toEqual(["Brainstorm"]);
    expect(g.sides.opp.life).toBe(19);
    // Not for a small spell.
    g = cast(yourTurn(table({ youHand: ["Grizzly Bears"], oppHand: ["Force of Will", "Brainstorm"] })), "Grizzly Bears");
    expect(g.sides.you.battlefield.map((c) => c.name)).toContain("Grizzly Bears");
    // Fierce Guardianship, with its commander on the battlefield.
    let t = yourTurn(table({ youHand: ["Divination"], oppHand: ["Fierce Guardianship"], oppField: ["Commander Guy"] }));
    t = { ...t, sides: { ...t.sides, opp: { ...t.sides.opp, battlefield: t.sides.opp.battlefield.map((c) => ({ ...c, commander: true })) } } };
    g = cast(t, "Divination");
    expect(g.sides.opp.graveyard.map((c) => c.name)).toEqual(["Fierce Guardianship"]);
    expect(g.log.at(-1)!.text).toMatch(/free: its commander is out/);
  });
});

describe("modal cards with a land back", () => {
  const SKULL = "Shatterskull Smashing // Shatterskull, the Shattered";

  it("the AI can play one as its land: it goes in land side up and makes mana", () => {
    const g0 = table({ oppHand: [SKULL] });
    const g = applyAction(g0, "opp", action("land", iidOf(g0, "opp", SKULL, "hand")), BOOK).game;
    const card = g.sides.opp.battlefield.find((c) => c.name === SKULL)!;
    expect(card.flipped).toBe(true);
    expect(g.log.at(-1)!.text).toBe("The opponent plays Shatterskull, the Shattered (the land side of Shatterskull Smashing).");
    expect(manaSources(g.sides.opp, BOOK, g.turn).map((s) => s.colors)).toEqual([["R"]]);
  });

  it("…or cast its front: a sorcery goes to the graveyard, and the land drop is still there", () => {
    const g0 = table({ oppHand: [SKULL], oppField: ["Mountain", "Mountain"] });
    const step = applyAction(g0, "opp", action("cast", iidOf(g0, "opp", SKULL, "hand"), { x: 0 }), BOOK);
    expect(step.ok).toBe(true);
    expect(step.game.sides.opp.graveyard.map((c) => c.name)).toEqual([SKULL]);
    expect(step.game.landPlayed).toBe(false);
  });

  it("your side: clicked, it's cast; turned over first, it's your land", () => {
    const g0 = { ...table({ youHand: [SKULL] }), active: "you" as const };
    const iid = iidOf(g0, "you", SKULL, "hand");
    const cast = playerPlay(g0, iid);
    expect(cast.sides.you.graveyard.map((c) => c.name)).toEqual([SKULL]);
    expect(cast.landPlayed).toBe(false);
    const turned = { ...g0, sides: { ...g0.sides, you: { ...g0.sides.you, hand: g0.sides.you.hand.map((c) => (c.iid === iid ? { ...c, flipped: true } : c)) } } };
    const land = playerPlay(turned, iid);
    expect(land.sides.you.battlefield.map((c) => c.name)).toEqual([SKULL]);
    expect(land.landPlayed).toBe(true);
  });

  it("the fallback plays a real land before a modal card", () => {
    const g0 = table({ oppHand: [SKULL, "Mountain"] });
    const plan = fallbackPlan(g0, BOOK);
    expect(plan.main[0]).toMatchObject({ kind: "land", card: cardId(iidOf(g0, "opp", "Mountain", "hand")) });
  });
});

describe("tokens and counters by hand", () => {
  it("makes a Treasure: an artifact, not a creature, that pays one mana of any colour and is used up", () => {
    const g0 = { ...table({ youHand: ["Hill Giant"] }), active: "you" as const };
    const g = createTokens(g0, "you", { name: "Treasure", power: 0, toughness: 0, keywords: [], kind: "artifact" }, 2);
    const treasures = g.sides.you.battlefield.filter((c) => c.name === "Treasure");
    expect(treasures).toHaveLength(2);
    expect(isCreature(BOOK, treasures[0]!)).toBe(false);
    expect(g.log.at(-1)!.text).toBe("You create 2 Treasure tokens.");
    expect(manaSources(g.sides.you, BOOK, g.turn).map((s) => s.sacrifice)).toEqual([true, true]);
  });

  it("makes creature tokens with their stats", () => {
    const g = createTokens(table(), "you", { name: "Spirit", power: 1, toughness: 1, keywords: ["Flying"], kind: "creature" });
    const t = g.sides.you.battlefield.find((c) => c.name === "Spirit")!;
    expect(isCreature(BOOK, t)).toBe(true);
    expect(g.log.at(-1)!.text).toBe("You create a Spirit token (1/1).");
  });

  it("puts +1/+1 and -1/-1 counters on a creature; at 0 toughness it dies", () => {
    const g0 = table({ youField: ["Grizzly Bears"] });
    const bear = iidOf(g0, "you", "Grizzly Bears");
    let g = addCounters(g0, bear, 2, BOOK);
    expect(g.sides.you.battlefield.find((c) => c.iid === bear)!.counters).toBe(2);
    expect(g.log.at(-1)!.text).toBe("Grizzly Bears gets 2 +1/+1 counters.");
    g = addCounters(g0, bear, -2, BOOK);
    expect(g.sides.you.graveyard.map((c) => c.name)).toContain("Grizzly Bears");
  });
});

describe("your casts are tapped for", () => {
  const yours = (o: Parameters<typeof table>[0]) => ({ ...table(o), active: "you" as const });

  it("taps the lands a spell needs, and only those", () => {
    const g0 = yours({ youHand: ["Grizzly Bears"], youField: ["Forest", "Forest", "Forest"] });
    const g = playerCast(g0, iidOf(g0, "you", "Grizzly Bears", "hand"), BOOK);
    expect(g.sides.you.battlefield.filter((c) => c.name === "Forest" && c.tapped)).toHaveLength(2);
    expect(g.sides.you.battlefield.map((c) => c.name)).toContain("Grizzly Bears");
    expect(g.log.map((l) => l.text)).toContain("You tap Forest, Forest for Grizzly Bears.");
  });

  it("uses a land before a Treasure, and the Treasure when it must", () => {
    let g0: PracticeGame = yours({ youHand: ["Hill Giant"], youField: ["Forest", "Forest", "Forest"] });
    g0 = createTokens(g0, "you", { name: "Treasure", power: 0, toughness: 0, keywords: [], kind: "artifact" });
    const g = playerCast(g0, iidOf(g0, "you", "Hill Giant", "hand"), BOOK);
    expect(g.sides.you.battlefield.some((c) => c.name === "Treasure")).toBe(false);
    expect(g.sides.you.battlefield.filter((c) => c.name === "Forest" && c.tapped)).toHaveLength(3);
    expect(g.log.map((l) => l.text)).toEqual(expect.arrayContaining(["You tap Forest, Forest, Forest for Hill Giant.", "You sacrifice Treasure for mana."]));
  });

  it("leaves it to you when you can't pay, or the card has another way to be cast", () => {
    let g0: PracticeGame = yours({ youHand: ["Hill Giant"], youField: ["Forest"] });
    let g = playerCast(g0, iidOf(g0, "you", "Hill Giant", "hand"), BOOK);
    expect(g.sides.you.battlefield.find((c) => c.name === "Forest")!.tapped).toBe(false);
    expect(g.log.map((l) => l.text)).toContain("(Not enough untapped mana for Hill Giant: tap what you use by hand.)");
    g0 = yours({ youHand: ["Force of Will"], youField: ["Island", "Island", "Island", "Island", "Island"] });
    g = playerCast(g0, iidOf(g0, "you", "Force of Will", "hand"), BOOK);
    expect(g.sides.you.battlefield.every((c) => !c.tapped)).toBe(true);
  });

  it("counts commander tax from the command zone", () => {
    let g0 = newGame({ you: { cards: deck("Commander Guy", ...Array(10).fill("Forest")), commander: "Commander Guy" }, opp: { cards: deck(...Array(10).fill("Island")) }, commanderGame: true, first: "you", shuffle: keep });
    const forests = g0.sides.you.hand.filter((c) => c.name === "Forest").slice(0, 3);
    g0 = { ...g0, tax: { you: 1, opp: 0 }, sides: { ...g0.sides, you: { ...g0.sides.you, hand: g0.sides.you.hand.filter((c) => !forests.includes(c)), battlefield: forests } } };
    const g = playerCast(g0, iidOf(g0, "you", "Commander Guy", "command"), BOOK);
    expect(g.sides.you.battlefield.filter((c) => c.name === "Forest" && c.tapped)).toHaveLength(3);
  });
});

describe("searches", () => {
  const card = (name: string, typeLine: string, manaCost: string, oracleText: string, o: Partial<CardInfo> = {}) => info(name, { typeLine, manaCost, oracleText, ...o });

  it("reads tutors: what they find and where it goes", () => {
    const demonic = searchOnCast(card("Demonic Tutor", "Sorcery", "{1}{B}", "Search your library for a card, put that card into your hand, then shuffle."))!;
    expect(demonic).toMatchObject({ count: 1, what: "card", to: [{ zone: "hand" }] });
    expect(demonic.test("Creature — Elf", undefined)).toBe(true);
    const mystical = searchOnCast(card("Mystical Tutor", "Instant", "{U}", "Search your library for an instant or sorcery card, reveal it, then shuffle and put that card on top."))!;
    expect(mystical.to).toEqual([{ zone: "top" }]);
    expect(mystical.test("Sorcery", undefined)).toBe(true);
    expect(mystical.test("Creature — Elf", undefined)).toBe(false);
    const growth = searchOnCast(card("Rampant Growth", "Sorcery", "{1}{G}", "Search your library for a basic land card, put that card onto the battlefield tapped, then shuffle."))!;
    expect(growth.to).toEqual([{ zone: "battlefield", tapped: true }]);
    expect(growth.test("Basic Land — Forest", undefined)).toBe(true);
    expect(growth.test("Land — Forest Island", undefined)).toBe(false);
    const cultivate = searchOnCast(card("Cultivate", "Sorcery", "{2}{G}", "Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle."))!;
    expect(cultivate).toMatchObject({ count: 2, to: [{ zone: "battlefield", tapped: true }, { zone: "hand" }] });
    const farseek = searchOnCast(card("Farseek", "Sorcery", "{1}{G}", "Search your library for a Plains, Island, Swamp, or Mountain card, put it onto the battlefield tapped, then shuffle."))!;
    expect(farseek.test("Land — Island Mountain", undefined)).toBe(true);
    expect(farseek.test("Basic Land — Forest", undefined)).toBe(false);
    const scroll = searchOnCast(card("Merchant Scroll", "Sorcery", "{1}{U}", "Search your library for a blue instant card, reveal that card, put it into your hand, then shuffle."))!;
    expect(scroll.test("Instant", BOOK["counterspell"])).toBe(true);
    expect(scroll.test("Instant", BOOK["lightning bolt"])).toBe(false);
  });

  it("a creature's search when it enters, with a limit; not an activated ability, nor someone else's library", () => {
    const recruiter = searchOnCast(card("Imperial Recruiter", "Creature — Human Advisor", "{2}{R}", "When Imperial Recruiter enters, search your library for a creature card with power 2 or less, reveal it, put it into your hand, then shuffle."))!;
    expect(recruiter.test("Creature — Bear", info("Grizzly Bears", { power: 2 }))).toBe(true);
    expect(recruiter.test("Creature — Giant", info("Hill Giant", { power: 3 }))).toBe(false);
    const elder = card("Sakura-Tribe Elder", "Creature — Snake Shaman", "{1}{G}", "Sacrifice Sakura-Tribe Elder: Search your library for a basic land card, put that card onto the battlefield tapped, then shuffle.");
    expect(searchOnCast(elder)).toBeNull();
    expect(searchAbility(elder)).toMatchObject({ sacrifice: true, tap: false, life: 0, to: [{ zone: "battlefield", tapped: true }] });
    expect(searchOnCast(card("Path to Exile", "Instant", "{W}", "Exile target creature. Its controller may search their library for a basic land card, put that card onto the battlefield tapped, then shuffle."))).toBeNull();
  });

  it("reads a fetch land as an ability: tap, 1 life, sacrifice", () => {
    const tarn = searchAbility(BOOK["scalding tarn"])!;
    expect(tarn).toMatchObject({ tap: true, sacrifice: true, life: 1, mana: null, to: [{ zone: "battlefield", tapped: false }] });
    expect(tarn.test("Land — Island Mountain", undefined)).toBe(true);
    expect(tarn.test("Basic Land — Forest", undefined)).toBe(false);
  });

  it("finds to your hand, then shuffles and puts what goes on top there", () => {
    const g0 = { ...table({ youField: ["Forest"] }), active: "you" as const };
    const lib = g0.sides.you.library;
    let g = playerFind(g0, lib[0]!.iid, "hand");
    expect(g.sides.you.hand.map((c) => c.iid)).toContain(lib[0]!.iid);
    const top = g.sides.you.library[3]!.iid;
    g = finishSearch(g, [top]);
    expect(g.sides.you.library[0]!.iid).toBe(top);
    expect(g.log.at(-1)!.text).toBe("You shuffle your library.");
  });
});

describe("answering on the other's turn", () => {
  it("reads instant removal: what it does, what it can't hit, and what else", () => {
    expect(removalOf(BOOK["swords to plowshares"])).toMatchObject({ kind: "exile", rider: "Its controller gains life equal to its power." });
    expect(removalOf(BOOK["lightning bolt"])).toMatchObject({ kind: "damage", amount: 3 });
    expect(removalOf(BOOK["doom blade"])).toMatchObject({ kind: "destroy", notColor: "B" });
    expect(removalOf(BOOK["into the roil"])).toMatchObject({ kind: "bounce" });
    expect(removalOf(BOOK["counterspell"])).toBeNull();
    expect(removalOf(BOOK["rite of flame"])).toBeNull();
    expect(isInstantSpeed(BOOK, { iid: 1, name: "Counterspell", imageUri: "", typeLine: "Instant", tapped: false, commander: false })).toBe(true);
    expect(isInstantSpeed(BOOK, { iid: 1, name: "Grizzly Bears", imageUri: "", typeLine: "Creature — Bear", tapped: false, commander: false })).toBe(false);
  });

  it("the AI bolts a big attacker, not a small one, and not what it can't kill", () => {
    const attackWith = (names: string[], hand = ["Lightning Bolt"], field = ["Mountain"]) => {
      let g: PracticeGame = { ...table({ youField: names, oppHand: hand, oppField: field }), active: "you", turn: 4 };
      g = declareAttackers(g, "you", g.sides.you.battlefield.map((c) => c.iid), BOOK);
      return g;
    };
    let g = attackWith(["Hill Giant", "Grizzly Bears"]);
    const bolt = aiRemovalAction(g, BOOK, g.combat!.attackers, "attack")!;
    expect(bolt.card).toBe(cardId(iidOf(g, "opp", "Lightning Bolt", "hand")));
    expect(bolt.effects[0]).toMatchObject({ type: "damage", target: cardId(iidOf(g, "you", "Hill Giant")), amount: 3 });
    expect(aiRemovalAction(attackWith(["Grizzly Bears"]), BOOK, attackWith(["Grizzly Bears"]).combat!.attackers, "attack")).toBeNull();
    g = attackWith(["Serra Angel"]);
    expect(aiRemovalAction(g, BOOK, g.combat!.attackers, "attack")).toBeNull();
    g = attackWith(["Vampire Nighthawk", "Serra Angel"], ["Doom Blade"], ["Swamp", "Swamp"]);
    const blade = aiRemovalAction(g, BOOK, g.combat!.attackers, "attack")!;
    expect(blade.effects[0]!.target).toBe(cardId(iidOf(g, "you", "Serra Angel")));
    g = attackWith(["Serra Angel"], ["Swords to Plowshares"], []);
    expect(aiRemovalAction(g, BOOK, g.combat!.attackers, "attack")).toBeNull();
  });

  it("at the end of your turn, the AI answers a real threat only", () => {
    const g0 = { ...table({ youField: ["Hill Giant", "Serra Angel"], oppHand: ["Swords to Plowshares"], oppField: ["Plains"] }), active: "you" as const };
    const swords = aiRemovalAction(g0, BOOK, g0.sides.you.battlefield.map((c) => c.iid), "end")!;
    expect(swords.effects[0]).toMatchObject({ type: "exile", target: cardId(iidOf(g0, "you", "Serra Angel")) });
    expect(swords.effects[1]).toMatchObject({ type: "note", text: "Its controller gains life equal to its power." });
    const small = { ...table({ youField: ["Hill Giant"], oppHand: ["Swords to Plowshares"], oppField: ["Plains"] }), active: "you" as const };
    expect(aiRemovalAction(small, BOOK, small.sides.you.battlefield.map((c) => c.iid), "end")).toBeNull();
  });

  it("an AI cast in stages: paid and announced, then countered, or resolved", () => {
    const g0 = table({ oppHand: ["Hill Giant"], oppField: ["Mountain", "Mountain", "Mountain", "Mountain"] });
    const a = action("cast", iidOf(g0, "opp", "Hill Giant", "hand"));
    const paid = applyAction(g0, "opp", a, BOOK, { stage: "pay" }).game;
    expect(paid.sides.opp.battlefield.filter((c) => c.tapped)).toHaveLength(4);
    expect(paid.sides.opp.hand.map((c) => c.name)).toEqual(["Hill Giant"]);
    expect(paid.log.at(-1)!.text).toBe("The opponent casts Hill Giant.");
    const countered = applyAction(paid, "opp", a, BOOK, { stage: "counter", by: "Counterspell" }).game;
    expect(countered.sides.opp.graveyard.map((c) => c.name)).toEqual(["Hill Giant"]);
    expect(countered.log.at(-1)!.text).toBe("Counterspell counters Hill Giant.");
    const resolved = applyAction(paid, "opp", a, BOOK, { stage: "resolve" }).game;
    expect(resolved.sides.opp.battlefield.map((c) => c.name)).toContain("Hill Giant");
    expect(resolved.sides.opp.battlefield.filter((c) => c.tapped)).toHaveLength(4);
  });
});
