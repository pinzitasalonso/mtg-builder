import { describe, expect, it } from "vitest";
import { chooseBlocks, aiMulligan, fallbackPlan, simpleTurn } from "./ai";
import { counterOf, fetchOf, has, hitTriggersOf, isCreature, isInstantSpeed, isNinja, manaOutput, ninjutsuOf, removalOf, searchAbility, searchOnCast, stats } from "./cards";
import { automatedNotes } from "./brief";
import {
  addCounters,
  aiNinjutsu,
  aiRemovalAction,
  aiResponds,
  applyAction,
  createTokens,
  finishSearch,
  indestructible,
  canPayNextTax,
  declineTax,
  payTax,
  playerCast,
  playerDraws,
  playerEnters,
  playerEdict,
  playerScry,
  ninjutsu,
  ninjutsuOptions,
  resolveChoice,
  playerFind,
  cardId,
  concede,
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
    // Cards whose triggers the table carries out (lib/practice/triggers.ts).
    info("Baleful Strix", { typeLine: "Artifact Creature — Bird", manaCost: "{1}{U}", manaValue: 2, power: 1, toughness: 1, keywords: ["Flying", "Deathtouch"], oracleText: "Flying, deathtouch\nWhen this creature enters, draw a card." }),
    info("Phyrexian Arena", { typeLine: "Enchantment", manaCost: "{1}{U}{U}", manaValue: 3, oracleText: "At the beginning of your upkeep, you draw a card and lose 1 life." }),
    info("Nekusar, the Mindrazer", { typeLine: "Legendary Creature — Zombie Wizard", manaCost: "{2}{U}", manaValue: 3, power: 2, toughness: 4, oracleText: "At the beginning of each player's draw step, that player draws an additional card.\nWhenever an opponent draws a card, Nekusar deals 1 damage to that player." }),
    info("Smothering Tithe", { typeLine: "Enchantment", manaCost: "{3}{W}", manaValue: 4, oracleText: "Whenever an opponent draws a card, that player may pay {2}. If the player doesn't, you create a Treasure token." }),
    info("Rhystic Study", { typeLine: "Enchantment", manaCost: "{2}{U}", manaValue: 3, oracleText: "Whenever an opponent casts a spell, you may draw a card unless that player pays {1}." }),
    info("Zulaport Cutthroat", { typeLine: "Creature — Human Rogue", manaCost: "{1}{B}", manaValue: 2, power: 1, toughness: 1, oracleText: "Whenever this creature or another creature you control dies, each opponent loses 1 life and you gain 1 life." }),
    info("Soul Warden", { typeLine: "Creature — Human Cleric", manaCost: "{W}", manaValue: 1, power: 1, toughness: 1, oracleText: "Whenever another creature enters, you gain 1 life." }),
    info("Goblin Rabblemaster", { typeLine: "Creature — Goblin", manaCost: "{2}{R}", manaValue: 3, power: 2, toughness: 2, oracleText: "Whenever Goblin Rabblemaster attacks, create a 1/1 red Goblin creature token with haste." }),
    info("Beast Within", { typeLine: "Instant", manaCost: "{2}{G}", manaValue: 3, oracleText: "Destroy target permanent. Its controller creates a 3/3 green Beast creature token." }),
    info("Anguished Unmaking", { typeLine: "Instant", manaCost: "{1}{W}{B}", manaValue: 3, oracleText: "Exile target nonland permanent. You lose 3 life." }),
    info("Putrefy", { typeLine: "Instant", manaCost: "{1}{B}{G}", manaValue: 3, oracleText: "Destroy target artifact or creature. It can't be regenerated." }),
    info("Rampant Growth", { typeLine: "Sorcery", manaCost: "{1}{G}", manaValue: 2, oracleText: "Search your library for a basic land card, put that card onto the battlefield tapped, then shuffle." }),
    info("Cultivate", { typeLine: "Sorcery", manaCost: "{2}{G}", manaValue: 3, oracleText: "Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle." }),
    info("Feed the Swarm", { typeLine: "Sorcery", manaCost: "{1}{B}", manaValue: 2, oracleText: "Destroy target creature or enchantment an opponent controls. You lose life equal to that permanent's mana value." }),
    info("Despark", { typeLine: "Instant", manaCost: "{W}{B}", manaValue: 2, oracleText: "Exile target permanent with mana value 4 or greater." }),
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
    expect(payCost(parseCost("{B/P}"), sources)).toMatchObject({ tap: [], life: 2 });
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
    // Its controller's life is the table's to give: the Angel's power.
    expect(swords.effects[1]).toMatchObject({ type: "life", player: "player", amount: 4 });
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

describe("K'rrik, Kefka and cast triggers", () => {
  const KB: CardBook = {
    ...BOOK,
    ...Object.fromEntries(
      [
        info("K'rrik, Son of Yawgmoth", {
          typeLine: "Legendary Creature — Phyrexian Horror Minion",
          manaCost: "{4}{B/P}{B/P}{B/P}",
          manaValue: 7,
          power: 2,
          toughness: 2,
          keywords: ["Lifelink"],
          oracleText:
            "({B/P} can be paid with either {B} or 2 life.)\nLifelink\nFor each {B} in a cost, you may pay 2 life rather than pay that mana.\nWhenever you cast a black spell, put a +1/+1 counter on K'rrik.",
        }),
        info("Kefka, Court Mage // Kefka, Ruler of Ruin", {
          typeLine: "Legendary Creature — Human Wizard // Legendary Creature — Avatar Wizard",
          manaCost: "{2}{U}{B}{R}",
          manaValue: 5,
          power: 4,
          toughness: 5,
          keywords: ["Flying", "Transform"],
          back: { power: 5, toughness: 7 },
          oracleText:
            "Whenever Kefka enters or attacks, each player discards a card. Then you draw a card for each card type among cards discarded this way.\n{8}: Each opponent sacrifices a permanent of their choice. Transform Kefka. Activate only as a sorcery.\n//\nFlying\nWhenever an opponent loses life during your turn, you draw that many cards.",
        }),
        info("Kefka, Dancing Mad", {
          typeLine: "Legendary Creature — Human Wizard",
          manaCost: "{5}{B}{R}",
          manaValue: 7,
          power: 6,
          toughness: 6,
          oracleText: "During your turn, Kefka has indestructible.\nAt the beginning of your end step, exile a card at random from each opponent's graveyard.",
        }),
        info("Vivi Ornitier", {
          typeLine: "Legendary Creature — Wizard",
          manaCost: "{1}{U}{R}",
          manaValue: 3,
          power: 0,
          toughness: 3,
          oracleText:
            "{0}: Add X mana in any combination of {U} and/or {R}, where X is Vivi Ornitier's power. Activate only during your turn and only once each turn.\nWhenever you cast a noncreature spell, put a +1/+1 counter on Vivi Ornitier and it deals 1 damage to each opponent.",
        }),
        info("Monastery Swiftspear", { typeLine: "Creature — Human Monk", manaCost: "{R}", manaValue: 1, power: 1, toughness: 2, keywords: ["Haste", "Prowess"] }),
        info("Sign in Blood", { typeLine: "Sorcery", manaCost: "{B}{B}", manaValue: 2, oracleText: "Target player draws two cards and loses 2 life." }),
        info("Bloodghast", { typeLine: "Creature — Vampire Spirit", manaCost: "{B}{B}", manaValue: 2, power: 2, toughness: 1 }),
        info("Crumbling Necropolis", { typeLine: "Land", producedMana: ["U", "B", "R"] }),
      ].map((c) => [c.name.toLowerCase(), c])
    ),
  };
  const kdeck = (...names: string[]): DeckCard[] => names.map((name) => ({ name, imageUri: "", typeLine: KB[name.toLowerCase()]!.typeLine }));
  const KEFKA = "Kefka, Court Mage // Kefka, Ruler of Ruin";
  /** A table with K'rrik's book: the same layout as table(). */
  function ktable(o: { oppHand?: string[]; oppField?: string[]; youField?: string[]; youHand?: string[] }) {
    let g = newGame({
      you: { cards: kdeck(...(o.youField ?? []), ...(o.youHand ?? []), ...Array(10).fill("Forest")) },
      opp: { cards: kdeck(...(o.oppHand ?? []), ...(o.oppField ?? []), ...Array(10).fill("Island")) },
      commanderGame: false,
      first: "opp",
      shuffle: keep,
    });
    for (const seat of ["you", "opp"] as const) g.sides[seat] = { ...g.sides[seat], library: [...g.sides[seat].hand, ...g.sides[seat].library], hand: [] };
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
  const texts = (g: PracticeGame) => g.log.map((l) => l.text);

  it("pays 2 life for {B} only when the mana runs short", () => {
    const cost = parseCost("{2}{B}");
    const swamps = [
      { iid: 1, name: "Swamp", colors: ["B"], amount: 1 },
      { iid: 2, name: "Swamp", colors: ["B"], amount: 1 },
      { iid: 3, name: "Swamp", colors: ["B"], amount: 1 },
    ];
    expect(payCost(cost, swamps, { lifeFor: ["B"] })).toMatchObject({ tap: [1, 2, 3], life: 0 });
    expect(payCost(cost, swamps.slice(0, 2))).toBeNull();
    expect(payCost(cost, swamps.slice(0, 2), { lifeFor: ["B"] })).toMatchObject({ tap: [1, 2], life: 2 });
    expect(payCost(parseCost("{B}{B}"), [], { lifeFor: ["B"] })).toMatchObject({ tap: [], life: 4 });
    expect(payCost(parseCost("{1}{B}"), [], { lifeFor: ["B"] })).toBeNull();
  });

  it("your K'rrik: a black spell is paid with life when you're short, and K'rrik grows", () => {
    const g0 = { ...ktable({ youField: ["K'rrik, Son of Yawgmoth"], youHand: ["Sign in Blood", "Grizzly Bears"] }), active: "you" as const };
    const g = playerCast(g0, iidOf(g0, "you", "Sign in Blood", "hand"), KB);
    expect(g.sides.you.life).toBe(16);
    expect(texts(g)).toEqual(expect.arrayContaining(["You pay 4 life for Sign in Blood.", "K'rrik, Son of Yawgmoth gets a +1/+1 counter."]));
    expect(g.sides.you.battlefield.find((c) => c.name.startsWith("K'rrik"))!.counters).toBe(1);
    // Never the life you have left: at 4 life, it's left to you.
    const low = { ...g0, sides: { ...g0.sides, you: { ...g0.sides.you, life: 4 } } };
    const lowCast = playerCast(low, iidOf(low, "you", "Sign in Blood", "hand"), KB);
    expect(lowCast.sides.you.life).toBe(4);
    expect(texts(lowCast)).toContain("(Not enough untapped mana for Sign in Blood: tap what you use by hand.)");
    // A green spell: no counter, and no life for its {G}.
    const bears = playerCast(g, iidOf(g, "you", "Grizzly Bears", "hand"), KB);
    expect(bears.sides.you.battlefield.find((c) => c.name.startsWith("K'rrik"))!.counters).toBe(1);
    expect(bears.sides.you.life).toBe(16);
  });

  it("the AI's K'rrik casts on life, but not below what your creatures could hit for", () => {
    const g0 = ktable({ oppField: ["K'rrik, Son of Yawgmoth", "Swamp"], oppHand: ["Bloodghast"], youField: ["Craw Wurm"] });
    const g = applyAction(g0, "opp", action("cast", iidOf(g0, "opp", "Bloodghast", "hand")), KB).game;
    expect(g.sides.opp.life).toBe(18);
    expect(g.sides.opp.battlefield.find((c) => c.name.startsWith("K'rrik"))!.counters).toBe(1);
    const low = { ...g0, sides: { ...g0.sides, opp: { ...g0.sides.opp, life: 8 } } };
    expect(applyAction(low, "opp", action("cast", iidOf(low, "opp", "Bloodghast", "hand")), KB).ok).toBe(false);
  });

  it("Vivi and prowess: a noncreature spell grows them, and Vivi pings", () => {
    const g0 = { ...ktable({ youField: ["Vivi Ornitier", "Monastery Swiftspear", "Mountain"], youHand: ["Lightning Bolt", "Raging Goblin"] }), active: "you" as const };
    const g = playerCast(g0, iidOf(g0, "you", "Lightning Bolt", "hand"), KB);
    expect(g.sides.opp.life).toBe(19);
    expect(g.sides.you.battlefield.find((c) => c.name === "Vivi Ornitier")!.counters).toBe(1);
    expect(g.sides.you.battlefield.find((c) => c.name === "Monastery Swiftspear")!.pump).toEqual({ power: 1, toughness: 1 });
    const creature = playerPlay(g, iidOf(g, "you", "Raging Goblin", "hand"), KB);
    expect(creature.sides.you.battlefield.find((c) => c.name === "Vivi Ornitier")!.counters).toBe(1);
  });

  it("the AI's Kefka enters: it discards, you choose yours, it draws for the card types", () => {
    const g0 = ktable({ oppHand: [KEFKA, "Hill Giant", "Island"], oppField: Array(5).fill("Crumbling Necropolis"), youHand: ["Grizzly Bears", "Forest"] });
    const before = g0.sides.opp.hand.length;
    // The plan's own discard is dropped: the table does Kefka's.
    const g = applyAction(g0, "opp", action("cast", iidOf(g0, "opp", KEFKA, "hand"), { effects: [effect({ type: "discard", player: "player", amount: 1 })] }), KB).game;
    expect(g.sides.opp.battlefield.map((c) => c.name)).toContain(KEFKA);
    // Kefka left the hand, and it discarded Hill Giant (it has one land in hand, few on the table).
    expect(g.sides.opp.hand.map((c) => c.name)).toEqual(["Island"]);
    expect(g.sides.opp.graveyard.map((c) => c.name)).toEqual(["Hill Giant"]);
    expect(texts(g).filter((t) => t.startsWith("Resolve:"))).toEqual([]);
    expect(g.choice).toMatchObject({ kind: "discard", by: "opp" });
    const after = resolveChoice(g, iidOf(g, "you", "Grizzly Bears", "hand"), KB);
    expect(after.choice).toBeNull();
    expect(after.sides.you.graveyard.map((c) => c.name)).toContain("Grizzly Bears");
    // Hill Giant (creature) and Grizzly Bears (creature): one type, one card.
    expect(after.sides.opp.hand.length).toBe(2);
    expect(texts(after)).toContain("The opponent draws 1 for the card types discarded (creature).");
    expect(before).toBe(3);
  });

  it("your Kefka enters and attacks: the AI discards, you choose, you draw for the types", () => {
    const g0 = { ...ktable({ youField: [KEFKA], youHand: ["Lightning Bolt", "Forest"], oppHand: ["Hill Giant"] }), active: "you" as const };
    const kefka = iidOf(g0, "you", KEFKA);
    const g = declareAttackers(g0, "you", [kefka], KB);
    expect(g.combat?.attackers).toEqual([kefka]);
    expect(g.sides.opp.graveyard.map((c) => c.name)).toEqual(["Hill Giant"]);
    expect(g.choice).toMatchObject({ kind: "discard", by: "you" });
    const hand = g.sides.you.hand.length;
    const after = resolveChoice(g, iidOf(g, "you", "Lightning Bolt", "hand"), KB);
    // Creature + instant: two cards, after the one discarded.
    expect(after.sides.you.hand.length).toBe(hand - 1 + 2);
    expect(texts(after)).toContain("You draw 2 for the card types discarded (creature, instant).");
    // Front face up, Kefka doesn't fly.
    expect(has(KB, after.sides.you.battlefield.find((c) => c.iid === kefka)!, "Flying")).toBe(false);
  });

  it("Kefka's {8}: you sacrifice a permanent you choose, and it transforms into a 5/7 flier that draws on your life loss", () => {
    const islands = Array(8).fill("Island");
    const g0 = ktable({ oppField: [KEFKA, ...islands], youField: ["Grizzly Bears", "Forest"] });
    const kefka = iidOf(g0, "opp", KEFKA);
    const g = applyAction(g0, "opp", action("activate", kefka, { mana: "{8}", effects: [effect({ type: "destroy", target: cardId(iidOf(g0, "you", "Grizzly Bears")) })] }), KB).game;
    expect(g.choice).toMatchObject({ kind: "sacrifice", by: "opp" });
    expect(g.sides.you.battlefield.map((c) => c.name)).toContain("Grizzly Bears");
    const k = g.sides.opp.battlefield.find((c) => c.iid === kefka)!;
    expect(k.flipped).toBe(true);
    expect(stats(KB, k)).toEqual({ power: 5, toughness: 7 });
    expect(has(KB, k, "Flying")).toBe(true);
    const after = resolveChoice(g, iidOf(g, "you", "Forest"), KB);
    expect(after.sides.you.battlefield.map((c) => c.name)).toEqual(["Grizzly Bears"]);
    // On its turn, you lose 3 life: it draws 3.
    const hand = after.sides.opp.hand.length;
    const hit = applyAction(after, "opp", action("activate", kefka, { mana: null, tap_card: true, effects: [effect({ type: "damage", target: "player", amount: 3 })] }), KB).game;
    expect(hit.sides.you.life).toBe(17);
    expect(hit.sides.opp.hand.length).toBe(hand + 3);
  });

  it("your Kefka's {8}: the AI sacrifices what it would rather lose", () => {
    const g0 = { ...ktable({ youField: [KEFKA, ...Array(8).fill("Forest")], oppField: ["Serra Angel", "Island", "Island", "Island", "Island", "Island"] }), active: "you" as const };
    const g = playerEdict(g0, iidOf(g0, "you", KEFKA), KB);
    expect(g.sides.you.battlefield.filter((c) => c.tapped)).toHaveLength(8);
    expect(g.sides.opp.graveyard.map((c) => c.name)).toEqual(["Island"]);
    expect(g.sides.you.battlefield.find((c) => c.name === KEFKA)!.flipped).toBe(true);
  });

  it("Kefka, Dancing Mad is indestructible on its controller's turn only", () => {
    const g0 = ktable({ oppField: ["Kefka, Dancing Mad"] });
    const card = g0.sides.opp.battlefield[0]!;
    expect(indestructible(g0, "opp", card, KB)).toBe(true);
    expect(indestructible({ ...g0, active: "you" }, "opp", card, KB)).toBe(false);
  });

  it("tells the AI what the table does by itself", () => {
    const notes = automatedNotes(
      [KEFKA, "K'rrik, Son of Yawgmoth", "Vivi Ornitier", "Grizzly Bears"].map((name) => ({ name, quantity: 1 })),
      KB
    );
    expect(notes).toHaveLength(3);
    expect(notes[0]).toContain('activate it with "mana":"{8}" and no effects');
    expect(notes[1]).toContain("2 life for each {B}");
  });
});

describe("first strike, double strike and deathtouch in the AI's blocks", () => {
  it("doesn't block a first striker with a deathtouch creature it would kill first", () => {
    const g0 = { ...table({ youField: ["White Knight"], oppField: ["Typhoid Rats"] }), active: "you" as const };
    const g = declareAttackers(g0, "you", [iidOf(g0, "you", "White Knight")], BOOK);
    expect(chooseBlocks(g, BOOK)).toEqual({});
  });

  it("blocks a first striker it survives and kills", () => {
    const g0 = { ...table({ youField: ["White Knight"], oppField: ["Giant Spider"] }), active: "you" as const };
    const g = declareAttackers(g0, "you", [iidOf(g0, "you", "White Knight")], BOOK);
    expect(chooseBlocks(g, BOOK)).toEqual({ [iidOf(g0, "you", "White Knight")]: [iidOf(g0, "opp", "Giant Spider")] });
  });
});

describe("Yuriko and ninjutsu", () => {
  const YB: CardBook = {
    ...BOOK,
    ...Object.fromEntries(
      [
        info("Yuriko, the Tiger's Shadow", {
          typeLine: "Legendary Creature — Human Ninja",
          manaCost: "{1}{U}{B}",
          manaValue: 3,
          power: 1,
          toughness: 3,
          keywords: ["Commander ninjutsu"],
          oracleText:
            "Commander ninjutsu {U}{B} ({U}{B}, Return an unblocked attacker you control to hand: Put this card onto the battlefield from your hand or the command zone tapped and attacking.)\nWhenever a Ninja you control deals combat damage to a player, reveal the top card of your library and put that card into your hand. Each opponent loses life equal to that card's mana value.",
        }),
        info("Ingenious Infiltrator", {
          typeLine: "Creature — Vedalken Ninja",
          manaCost: "{2}{U}{B}",
          manaValue: 4,
          power: 2,
          toughness: 3,
          keywords: ["Ninjutsu"],
          oracleText:
            "Ninjutsu {U}{B} ({U}{B}, Return an unblocked attacker you control to hand: Put this card onto the battlefield from your hand tapped and attacking.)\nWhenever a Ninja you control deals combat damage to a player, draw a card.",
        }),
      ].map((c) => [c.name.toLowerCase(), c])
    ),
  };
  const YURIKO = "Yuriko, the Tiger's Shadow";
  const ydeck = (...names: string[]): DeckCard[] => names.map((name) => ({ name, imageUri: "", typeLine: YB[name.toLowerCase()]!.typeLine }));
  /** A commander game: `seat` has Yuriko in the command zone, an Island and
      a Swamp, a Raging Goblin attacking unblocked, Hill Giant on top of its
      library. */
  function yTable(seat: "you" | "opp", hand: string[] = []) {
    const mine = ydeck(YURIKO, "Raging Goblin", "Island", "Swamp", ...hand, "Hill Giant", ...Array(10).fill("Forest"));
    const theirs = ydeck(...Array(20).fill("Plains"));
    let g = newGame({
      you: seat === "you" ? { cards: mine, commander: YURIKO } : { cards: theirs },
      opp: seat === "opp" ? { cards: mine, commander: YURIKO } : { cards: theirs },
      commanderGame: true,
      first: seat,
      shuffle: keep,
    });
    const side = g.sides[seat];
    const all = [...side.hand, ...side.library];
    const take = (name: string) => all.splice(all.findIndex((c) => c.name === name), 1)[0]!;
    const field = ["Raging Goblin", "Island", "Swamp"].map((n) => ({ ...take(n), enteredTurn: 0 }));
    const inHand = hand.map(take);
    const top = take("Hill Giant");
    g.sides[seat] = { ...side, battlefield: field, hand: inHand, library: [top, ...all] };
    g = { ...g, turn: 3, active: seat };
    g = declareAttackers(g, seat, [field[0]!.iid], YB);
    return setBlocks(g, {}, YB);
  }

  it("reads ninjutsu and the hit triggers", () => {
    const y = { iid: 1, name: YURIKO, imageUri: "", typeLine: YB[YURIKO.toLowerCase()]!.typeLine, tapped: false, commander: true, flipped: false };
    expect(ninjutsuOf(YB, y)).toEqual({ cost: "{U}{B}", commander: true });
    expect(hitTriggersOf(YB, y)).toEqual([{ ninjas: true, reveal: true, draw: 0 }]);
    expect(isNinja(YB, y)).toBe(true);
  });

  it("the AI brings Yuriko in from the command zone for its unblocked Goblin, then reveals and drains", () => {
    const g0 = yTable("opp");
    const g = aiNinjutsu(g0, YB);
    const yuriko = g.sides.opp.battlefield.find((c) => c.name === YURIKO)!;
    expect(yuriko.tapped).toBe(true);
    expect(g.combat!.attackers).toEqual([yuriko.iid]);
    expect(g.sides.opp.hand.map((c) => c.name)).toEqual(["Raging Goblin"]);
    expect(g.sides.opp.battlefield.filter((c) => c.tapped).map((c) => c.name).sort()).toEqual(["Island", "Swamp", YURIKO]);
    expect(g.tax.opp).toBe(0);
    const after = resolveCombat(g, YB);
    // 1 combat damage, then Hill Giant revealed: 4 more.
    expect(after.sides.you.life).toBe(40 - 1 - 4);
    expect(after.sides.opp.hand.map((c) => c.name)).toEqual(["Raging Goblin", "Hill Giant"]);
    expect(after.log.map((l) => l.text)).toContain("Yuriko, the Tiger's Shadow: the opponent reveals Hill Giant and puts it into its hand; you lose 4 life.");
  });

  it("your ninjutsu: a ninja from your hand, paid for you; Infiltrator draws when it hits", () => {
    const g0 = yTable("you", ["Ingenious Infiltrator"]);
    const options = ninjutsuOptions(g0, "you", YB);
    expect(options.map((o) => [o.ninja.name, o.zone])).toEqual([
      ["Ingenious Infiltrator", "hand"],
      [YURIKO, "command"],
    ]);
    const goblin = g0.combat!.attackers[0]!;
    const g = ninjutsu(g0, "you", options[0]!.ninja.iid, goblin, YB);
    expect(g.sides.you.hand.map((c) => c.name)).toEqual(["Raging Goblin"]);
    expect(ninjutsuOptions(g, "you", YB)).toEqual([]);
    const after = resolveCombat(g, YB);
    expect(after.sides.opp.life).toBe(40 - 2);
    expect(after.sides.you.hand.map((c) => c.name)).toEqual(["Raging Goblin", "Hill Giant"]);
  });

  it("no ninjutsu for a blocked attacker, or without the mana", () => {
    let g0 = yTable("you");
    const tapped = { ...g0, sides: { ...g0.sides, you: { ...g0.sides.you, battlefield: g0.sides.you.battlefield.map((c) => ({ ...c, tapped: true })) } } };
    expect(ninjutsuOptions(tapped, "you", YB)).toEqual([]);
    g0 = { ...g0, combat: { ...g0.combat!, blocks: { [g0.combat!.attackers[0]!]: [1] } } };
    expect(ninjutsuOptions(g0, "you", YB)).toEqual([]);
  });
});

describe("scry", () => {
  it("puts the kept cards on top in order and the rest on the bottom; the log says how many", () => {
    const g0 = { ...table({}), active: "you" as const };
    const [a, b, c] = g0.sides.you.library;
    const g = playerScry(g0, [c!.iid, a!.iid], [b!.iid]);
    expect(g.sides.you.library.slice(0, 2).map((x) => x.iid)).toEqual([c!.iid, a!.iid]);
    expect(g.sides.you.library.at(-1)!.iid).toBe(b!.iid);
    expect(g.sides.you.library).toHaveLength(g0.sides.you.library.length);
    expect(g.log.at(-1)!.text).toBe("You scry 3: 2 on top, 1 on the bottom.");
    expect(playerScry(g0, [99_999], [])).toBe(g0);
  });
});

describe("a turn with nothing to decide", () => {
  const names = (g: PracticeGame, plan: { main: PlanAction[] } | null) => plan?.main.map((a) => [a.kind, findCard(g, Number(a.card.slice(1)))!.card.name]);

  it("is its land drop when it can cast nothing and has nothing to attack with", () => {
    // Two lands after the drop, and a hand of four- and five-drops.
    const g = table({ oppHand: ["Forest", "Hill Giant", "Serra Angel"], oppField: ["Forest"] });
    expect(names(g, simpleTurn(g, BOOK))).toEqual([["land", "Forest"]]);
    // No land to play either: it passes.
    const empty = table({ oppHand: ["Hill Giant"], oppField: ["Forest"] });
    expect(simpleTurn(empty, BOOK)).toMatchObject({ main: [], attack: [] });
  });

  it("isn't one when a spell is castable, even one the planner wouldn't cast", () => {
    // The planner leaves instants to the model: this turn is the model's.
    const bolt = table({ oppHand: ["Mountain", "Lightning Bolt"], oppField: [] });
    expect(simpleTurn(bolt, BOOK)).toBeNull();
    const bears = table({ oppHand: ["Forest", "Grizzly Bears"], oppField: ["Forest"] });
    expect(simpleTurn(bears, BOOK)).toBeNull();
  });

  it("isn't one with a creature that could attack, or a permanent with an ability to use", () => {
    expect(simpleTurn(table({ oppHand: ["Forest"], oppField: ["Forest", "Hill Giant"], youField: ["Craw Wurm"] }), BOOK)).toBeNull();
    // A mana rock's ability only makes mana: nothing to decide.
    expect(simpleTurn(table({ oppHand: ["Hill Giant", "Serra Angel"], oppField: ["Sol Ring"] }), BOOK)).not.toBeNull();
    const book: CardBook = { ...BOOK, "prodigal sorcerer": info("Prodigal Sorcerer", { typeLine: "Artifact", oracleText: "{T}: Prodigal Sorcerer deals 1 damage to any target." }) };
    const g = table({ oppHand: ["Serra Angel"], oppField: ["Forest"] });
    const pinger = { ...g.sides.opp.battlefield[0]!, iid: 99_001, name: "Prodigal Sorcerer", typeLine: "Artifact" };
    expect(simpleTurn({ ...g, sides: { ...g.sides, opp: { ...g.sides.opp, battlefield: [...g.sides.opp.battlefield, pinger] } } }, book)).toBeNull();
  });

  it("isn't one on your turn, or once the game is over", () => {
    const g = table({ oppHand: ["Forest"], oppField: [] });
    expect(simpleTurn({ ...g, active: "you" }, BOOK)).toBeNull();
    expect(simpleTurn({ ...g, winner: "you" }, BOOK)).toBeNull();
  });
});

describe("conceding", () => {
  it("ends the game for the opponent, and says so", () => {
    const g0 = table();
    const g = concede(g0);
    expect(g.winner).toBe("opp");
    expect(g.log.at(-1)!.text).toBe("You concede. The opponent wins.");
    expect(g0.winner).toBeNull();
    // A game that's over stays as it ended.
    const won = { ...g0, winner: "you" as const };
    expect(concede(won)).toBe(won);
  });
});

describe("the triggers most decks are full of", () => {
  const life = (g: PracticeGame) => [g.sides.you.life, g.sides.opp.life];
  const count = (g: PracticeGame, seat: "you" | "opp", name: string) => g.sides[seat].battlefield.filter((c) => c.name === name).length;
  const said = (g: PracticeGame, text: string) => g.log.some((l) => l.text.includes(text));

  it("a creature that draws as it enters does, once, whatever the plan says", () => {
    const g0 = table({ oppHand: ["Baleful Strix"], oppField: ["Island", "Island"] });
    const hand = g0.sides.opp.hand.length;
    // The model's plan also asks for the draw: the table does it once.
    const g = applyAction(g0, "opp", action("cast", iidOf(g0, "opp", "Baleful Strix", "hand"), { effects: [effect({ type: "draw", amount: 1 })] }), BOOK).game;
    expect(count(g, "opp", "Baleful Strix")).toBe(1);
    expect(g.sides.opp.hand).toHaveLength(hand - 1 + 1);
    expect(said(g, "The opponent draws a card (Baleful Strix).")).toBe(true);
  });

  it("yours draws too, as you cast it", () => {
    let g = table({ youHand: ["Baleful Strix"], youField: ["Island", "Island"] });
    g = { ...g, active: "you" };
    const iid = iidOf(g, "you", "Baleful Strix", "hand");
    const hand = g.sides.you.hand.length;
    g = playerEnters(playerCast(g, iid, BOOK), iid, BOOK);
    expect(g.sides.you.hand).toHaveLength(hand - 1 + 1);
  });

  it("your upkeep: Phyrexian Arena draws and costs a life, before the turn's draw", () => {
    let g = table({ youField: ["Phyrexian Arena"] });
    g = { ...g, active: "you", turn: 4 };
    const before = g.sides.you.hand.length;
    g = startTurn(g, BOOK);
    expect(g.sides.you.hand).toHaveLength(before + 2);
    expect(life(g)).toEqual([39, 40].map((n) => n - 20).map((n) => n + 0));
    // Not on the other player's upkeep.
    const theirs = startTurn({ ...table({ youField: ["Phyrexian Arena"] }), turn: 5 }, BOOK);
    expect(theirs.sides.you.life).toBe(20);
  });

  it("an opponent's draws: Nekusar's damage, by the turn's draw and by the Draw button", () => {
    let g = table({ oppField: ["Nekusar, the Mindrazer"] });
    g = startTurn({ ...g, active: "you", turn: 4 }, BOOK);
    expect(g.sides.you.life).toBe(19);
    g = playerDraws(g, 2, BOOK);
    expect(g.sides.you.life).toBe(17);
    // Its own controller's draws don't hurt anyone.
    expect(startTurn({ ...g, active: "opp", turn: 5 }, BOOK).sides.opp.life).toBe(20);
  });

  it("Smothering Tithe makes a Treasure for each card the other player draws", () => {
    const g = startTurn({ ...table({ youField: ["Smothering Tithe"] }), turn: 5 }, BOOK);
    expect(count(g, "you", "Treasure")).toBe(1);
    expect(said(g, "Smothering Tithe: the opponent doesn't pay {2}; you make a Treasure.")).toBe(true);
  });

  it("Rhystic Study: the AI pays when it has the mana left, and you draw when it hasn't", () => {
    const spare = table({ oppHand: ["Llanowar Elves"], oppField: ["Forest", "Forest"], youField: ["Rhystic Study"] });
    const paid = applyAction(spare, "opp", action("cast", iidOf(spare, "opp", "Llanowar Elves", "hand")), BOOK).game;
    expect(paid.sides.you.hand).toHaveLength(spare.sides.you.hand.length);
    expect(paid.sides.opp.battlefield.filter((c) => c.name === "Forest" && c.tapped)).toHaveLength(2);
    expect(said(paid, "The opponent pays {1} for Rhystic Study.")).toBe(true);

    const tight = table({ oppHand: ["Llanowar Elves"], oppField: ["Forest"], youField: ["Rhystic Study"] });
    const drew = applyAction(tight, "opp", action("cast", iidOf(tight, "opp", "Llanowar Elves", "hand")), BOOK).game;
    expect(drew.sides.you.hand).toHaveLength(tight.sides.you.hand.length + 1);
  });

  it("the AI's Rhystic Study asks you: pay {1}, or it draws", () => {
    let g = table({ youHand: ["Llanowar Elves"], youField: ["Forest", "Forest"], oppField: ["Rhystic Study"] });
    g = { ...g, active: "you" };
    const asked = playerCast(g, iidOf(g, "you", "Llanowar Elves", "hand"), BOOK);
    // Nothing happens until you answer.
    expect(asked.taxes).toEqual([{ source: "Rhystic Study", cost: 1, count: 1, gives: "draw" }]);
    expect(asked.sides.opp.hand).toHaveLength(g.sides.opp.hand.length);
    expect(canPayNextTax(asked, BOOK)).toBe(true);

    const paid = payTax(asked, BOOK);
    expect(paid.taxes).toBeUndefined();
    expect(paid.sides.you.battlefield.filter((c) => c.name === "Forest" && c.tapped)).toHaveLength(2);
    expect(paid.sides.opp.hand).toHaveLength(g.sides.opp.hand.length);
    expect(said(paid, "You pay {1} for Rhystic Study.")).toBe(true);

    const refused = declineTax(asked, BOOK);
    expect(refused.taxes).toBeUndefined();
    expect(refused.sides.you.battlefield.filter((c) => c.name === "Forest" && c.tapped)).toHaveLength(1);
    expect(refused.sides.opp.hand).toHaveLength(g.sides.opp.hand.length + 1);
  });

  it("with nothing to pay it with, there's nothing to ask: it draws", () => {
    let tight = table({ youHand: ["Llanowar Elves"], youField: ["Forest"], oppField: ["Rhystic Study"] });
    tight = { ...tight, active: "you" };
    const drew = playerCast(tight, iidOf(tight, "you", "Llanowar Elves", "hand"), BOOK);
    expect(drew.taxes).toBeUndefined();
    expect(drew.sides.opp.hand).toHaveLength(tight.sides.opp.hand.length + 1);
  });

  it("the AI's Smothering Tithe asks you for each card you draw, and you can pay for some", () => {
    let g = table({ youField: ["Forest", "Forest", "Forest"], oppField: ["Smothering Tithe"] });
    g = startTurn({ ...g, active: "you", turn: 4 }, BOOK);
    expect(g.taxes).toEqual([{ source: "Smothering Tithe", cost: 2, count: 1, gives: "treasure" }]);
    g = playerDraws(g, 1, BOOK);
    expect(g.taxes).toEqual([{ source: "Smothering Tithe", cost: 2, count: 2, gives: "treasure" }]);
    // Pay for one (two of the three lands), and leave the other.
    g = payTax(g, BOOK);
    expect(g.taxes?.[0]?.count).toBe(1);
    expect(canPayNextTax(g, BOOK)).toBe(false);
    expect(payTax(g, BOOK)).toBe(g);
    g = declineTax(g, BOOK);
    expect(count(g, "opp", "Treasure")).toBe(1);
    expect(g.taxes).toBeUndefined();
  });

  it("a payment left unanswered at the end of the turn wasn't made", () => {
    let g = table({ youHand: ["Llanowar Elves"], youField: ["Forest", "Forest"], oppField: ["Rhystic Study"] });
    g = { ...g, active: "you" };
    const asked = playerCast(g, iidOf(g, "you", "Llanowar Elves", "hand"), BOOK);
    const after = endTurn(asked, BOOK);
    expect(after.taxes).toBeUndefined();
    expect(said(after, "Rhystic Study: you don't pay {1}; the opponent draws a card.")).toBe(true);
  });

  it("a creature dying drains, for the side that has the trigger", () => {
    // Your Bears dies in combat damage: your Cutthroat drains.
    const g0 = table({ youField: ["Zulaport Cutthroat", "Grizzly Bears"], oppHand: ["Lightning Bolt"], oppField: ["Mountain"] });
    const bolt = action("cast", iidOf(g0, "opp", "Lightning Bolt", "hand"), { effects: [effect({ type: "damage", target: cardId(iidOf(g0, "you", "Grizzly Bears")), amount: 3 })] });
    const g = applyAction(g0, "opp", bolt, BOOK).game;
    expect(count(g, "you", "Grizzly Bears")).toBe(0);
    expect(life(g)).toEqual([21, 19]);
    // The AI's creature dying doesn't trigger yours ("you control").
    const theirs = table({ youField: ["Zulaport Cutthroat"], oppField: ["Grizzly Bears"] });
    const dead = { ...theirs, sides: { ...theirs.sides, opp: { ...theirs.sides.opp, battlefield: theirs.sides.opp.battlefield.map((c) => ({ ...c, damage: 5 })) } } };
    expect(life(addCounters(dead, iidOf(theirs, "you", "Zulaport Cutthroat"), 1, BOOK))).toEqual([20, 20]);
  });

  it("Soul Warden gains for any other creature entering, yours or theirs", () => {
    const g0 = table({ youField: ["Soul Warden"], oppHand: ["Llanowar Elves"], oppField: ["Forest"] });
    const g = applyAction(g0, "opp", action("cast", iidOf(g0, "opp", "Llanowar Elves", "hand")), BOOK).game;
    expect(g.sides.you.life).toBe(21);
  });

  it("an attack trigger makes its token", () => {
    const g0 = table({ oppField: ["Goblin Rabblemaster"] });
    const g = declareAttackers(g0, "opp", [iidOf(g0, "opp", "Goblin Rabblemaster")], BOOK);
    const token = g.sides.opp.battlefield.find((c) => c.name === "Goblin");
    expect(token?.token).toMatchObject({ power: 1, toughness: 1, keywords: ["Haste"] });
  });
});

describe("removal that names more than a creature", () => {
  const card = (name: string) => BOOK[name.toLowerCase()];
  it("is read: a permanent, a nonland permanent, an artifact or creature, a mana value", () => {
    expect(removalOf(card("Beast Within"))).toMatchObject({ kind: "destroy", rider: "Its controller creates a 3/3 green Beast creature token." });
    expect(removalOf(card("Anguished Unmaking"))).toMatchObject({ kind: "exile", notType: "land" });
    expect(removalOf(card("Putrefy"))).toMatchObject({ kind: "destroy" });
    expect(removalOf(card("Despark"))).toMatchObject({ kind: "exile", minValue: 4 });
  });

  it("Beast Within on your attacker leaves you its 3/3", () => {
    let g = table({ oppHand: ["Beast Within"], oppField: ["Forest", "Forest", "Forest"], youField: ["Serra Angel"] });
    g = { ...g, active: "you" };
    const plan = aiRemovalAction(g, BOOK, [iidOf(g, "you", "Serra Angel")], "end");
    expect(plan?.effects.map((e) => e.type)).toEqual(["destroy", "token"]);
    const after = applyAction(g, "opp", plan!, BOOK).game;
    expect(after.sides.you.battlefield.map((c) => c.name)).toEqual(["Beast"]);
    expect(after.sides.you.battlefield[0]!.token).toMatchObject({ power: 3, toughness: 3 });
  });

  it("Despark leaves a cheap creature alone", () => {
    let g = table({ oppHand: ["Despark"], oppField: ["Plains", "Swamp"], youField: ["Craw Wurm"] });
    g = { ...g, active: "you" };
    expect(aiRemovalAction(g, BOOK, [iidOf(g, "you", "Craw Wurm")], "end")?.effects[0]).toMatchObject({ type: "exile" });
    let small = table({ oppHand: ["Despark"], oppField: ["Plains", "Swamp"], youField: ["Commander Guy"] });
    small = { ...small, active: "you" };
    const guy = small.sides.you.battlefield[0]!;
    small = { ...small, sides: { ...small.sides, you: { ...small.sides.you, battlefield: [{ ...guy, commander: true }] } } };
    expect(aiRemovalAction(small, BOOK, [guy.iid], "end")).toBeNull();
  });
});

describe("the built-in planner and the most played spells", () => {
  const casts = (g: PracticeGame, plan: { main: PlanAction[] }) => plan.main.map((a) => [a.kind, findCard(g, Number(a.card.slice(1)))!.card.name]);
  const play = (g: PracticeGame, plan: { main: PlanAction[] }) => plan.main.reduce((x, a) => applyAction(x, "opp", a, BOOK).game, g);

  it("casts a ramp spell, and the land comes in tapped", () => {
    const g0 = table({ oppHand: ["Rampant Growth"], oppField: ["Forest", "Island"], oppLibrary: ["Mountain"] });
    const plan = fallbackPlan(g0, BOOK);
    expect(casts(g0, plan)).toEqual([["cast", "Rampant Growth"]]);
    // The land its colours are missing, not another Island.
    expect(plan.main[0]!.effects).toMatchObject([{ type: "search", name: "Mountain", to: "battlefield", tapped: true }]);
    const g = play(g0, plan);
    expect(g.sides.opp.battlefield.find((c) => c.name === "Mountain")?.tapped).toBe(true);
    expect(g.sides.opp.graveyard.map((c) => c.name)).toEqual(["Rampant Growth"]);
  });

  it("Cultivate: one land onto the battlefield tapped, the other to its hand", () => {
    const g0 = table({ oppHand: ["Cultivate"], oppField: ["Forest", "Forest", "Forest"], oppLibrary: ["Mountain"] });
    const plan = fallbackPlan(g0, BOOK);
    expect(plan.main[0]!.effects.map((e) => [e.name, e.to, e.tapped])).toEqual([
      ["Mountain", "battlefield", true],
      ["Island", "hand", null],
    ]);
    const g = play(g0, plan);
    expect(g.sides.opp.hand.map((c) => c.name)).toEqual(["Island"]);
    expect(g.sides.opp.battlefield.filter((c) => /Land/.test(c.typeLine ?? ""))).toHaveLength(4);
  });

  it("uses a sorcery to remove your biggest threat, and keeps its instants for your turn", () => {
    const g0 = table({ oppHand: ["Feed the Swarm", "Swords to Plowshares"], oppField: ["Swamp", "Swamp", "Plains"], youField: ["Serra Angel", "Grizzly Bears"] });
    const plan = fallbackPlan(g0, BOOK);
    expect(casts(g0, plan)).toEqual([["cast", "Feed the Swarm"]]);
    expect(plan.main[0]!.effects[0]).toMatchObject({ type: "destroy", target: cardId(iidOf(g0, "you", "Serra Angel")) });
    expect(play(g0, plan).sides.you.battlefield.map((c) => c.name)).toEqual(["Grizzly Bears"]);
    // Nothing worth a card: it keeps the sorcery.
    const small = table({ oppHand: ["Feed the Swarm"], oppField: ["Swamp", "Swamp"], youField: ["Grizzly Bears"] });
    expect(fallbackPlan(small, BOOK).main).toEqual([]);
  });
});
