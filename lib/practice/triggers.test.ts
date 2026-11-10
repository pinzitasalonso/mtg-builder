import { describe, expect, it } from "vitest";
import { outcomeOf, readTriggers } from "./triggers";

// Rules text as Scryfall has it, for cards among EDHREC's most played.
const T = {
  strix: "Flying, deathtouch\nWhen this creature enters, draw a card.",
  arena: "At the beginning of your upkeep, you draw a card and lose 1 life.",
  breya: "When Breya enters, create two 1/1 blue Thopter artifact creature tokens with flying.\n{2}, Sacrifice two artifacts: Choose one —\n• Breya deals 3 damage to target player or planeswalker.",
  omnath: "When Omnath enters, draw a card.\nLandfall — Whenever a land you control enters, you gain 4 life if this is the first time this ability has resolved this turn. If it's the second time, add {R}{G}{W}{U}.",
  oloro: "At the beginning of your upkeep, you gain 2 life.\nWhenever you gain life, you may pay {1}. If you do, draw a card and each opponent loses 1 life.\nAt the beginning of your upkeep, if Oloro is in the command zone, you gain 2 life.",
  nekusar: "At the beginning of each player's draw step, that player draws an additional card.\nWhenever an opponent draws a card, Nekusar deals 1 damage to that player.",
  tithe: "Whenever an opponent draws a card, that player may pay {2}. If the player doesn't, you create a Treasure token. (It's an artifact with \"{T}, Sacrifice this token: Add one mana of any color.\")",
  rhystic: "Whenever an opponent casts a spell, you may draw a card unless that player pays {1}.",
  sentinel: "Whenever an opponent casts their first noncreature spell each turn, draw a card unless that player pays {X}, where X is this creature's power.",
  remora: "Cumulative upkeep {1} (At the beginning of your upkeep, put an age counter on this permanent, then sacrifice it unless you pay its upkeep cost for each age counter on it.)\nWhenever an opponent casts a noncreature spell, you may draw a card unless that player pays {4}.",
  temur: "Creatures you control have haste.\nWhenever a creature you control with power 4 or greater enters, you may draw a card.",
  uprising: "When this enchantment enters, if you control a creature with power 4 or greater, draw a card.\nCreatures you control have trample.\nWhenever a creature you control with power 4 or greater enters, draw a card.",
  warden: "Whenever another creature enters, you gain 1 life.",
  cutthroat: "Whenever this creature or another creature you control dies, each opponent loses 1 life and you gain 1 life.",
  bloodArtist: "Whenever Blood Artist or another creature dies, target player loses 1 life and you gain 1 life.",
  edgar: "Eminence — Whenever you cast another Vampire spell, if Edgar is in the command zone or on the battlefield, create a 1/1 black Vampire creature token.\nFirst strike, haste\nWhenever Edgar attacks, put a +1/+1 counter on each Vampire you control.",
  kefka: "Whenever Kefka enters or attacks, each player discards a card. Then you draw a card for each card type among cards discarded this way.",
  witness: "When this creature enters, you may return target card from your graveyard to your hand.",
  avenger: "When this creature enters, create a 0/1 green Plant creature token for each land you control.\nLandfall — Whenever a land you control enters, you may put a +1/+1 counter on each Plant creature you control.",
  helga: "Whenever you cast a creature spell with mana value 4 or greater, you draw a card, gain 1 life, and put a +1/+1 counter on Helga.",
  arcades: "Flying, vigilance\nWhenever a creature you control with defender enters, draw a card.",
  attacker: "Whenever Goblin Rabblemaster attacks, create a 1/1 red Goblin creature token with haste.",
  treasure: "Whenever this creature enters or attacks, create a Treasure token.",
  angel: "When this creature enters, create two 1/1 white Soldier creature tokens with flying and vigilance, then you gain 2 life.",
};
const read = (text: string, name = "Test Card") => readTriggers(text, name);
const none = { draw: 0, gain: 0, lose: 0, drain: 0, damage: 0, counters: 0, tokens: [], artifacts: [] };

describe("what a trigger does", () => {
  it("is read when the table can do all of it", () => {
    expect(outcomeOf("draw a card.", "~")).toEqual({ ...none, draw: 1 });
    expect(outcomeOf("you draw a card and lose 1 life.", "~")).toEqual({ ...none, draw: 1, lose: 1 });
    expect(outcomeOf("each opponent loses 1 life and you gain 1 life.", "~")).toEqual({ ...none, drain: 1, gain: 1 });
    expect(outcomeOf("it deals 2 damage to each opponent.", "(?:it|~)")).toEqual({ ...none, damage: 2 });
    expect(outcomeOf("you draw a card, gain 1 life, and put a +1/+1 counter on helga.", "(?:helga|it)")).toEqual({ ...none, draw: 1, gain: 1, counters: 1 });
    expect(outcomeOf("create two treasure tokens.", "~")).toEqual({ ...none, artifacts: [{ count: 2, name: "Treasure" }] });
  });

  it("isn't read when any of it is beyond the table", () => {
    for (const clause of [
      "draw a card for each creature you control.",
      "draw a card if you control a wizard.",
      "destroy target creature.",
      "you may return target card from your graveyard to your hand.",
      "put a +1/+1 counter on each vampire you control.",
      "draw cards equal to its power.",
      "create a 0/1 green plant creature token for each land you control.",
      "create a 0/1 black wizard creature token with \"whenever you cast a noncreature spell, this token deals 1 damage to each opponent.\"",
      "you gain x life, where x is the number of creatures you control.",
      "scry 2.",
    ])
      expect(outcomeOf(clause, "~"), clause).toBeNull();
  });
});

describe("a card's triggers", () => {
  it("enters", () => {
    expect(read(T.strix).enters).toEqual({ ...none, draw: 1 });
    expect(read(T.omnath, "Omnath, Locus of Creation")).toEqual({ enters: { ...none, draw: 1 } });
    expect(read(T.breya, "Breya, Etherium Shaper").enters?.tokens).toEqual([{ count: 2, name: "Thopter", power: 1, toughness: 1, keywords: ["Flying"] }]);
    expect(read(T.angel).enters).toEqual({ ...none, gain: 2, tokens: [{ count: 2, name: "Soldier", power: 1, toughness: 1, keywords: ["Flying", "Vigilance"] }] });
  });

  it("attacks, and enters or attacks", () => {
    expect(read(T.attacker, "Goblin Rabblemaster").attacks?.tokens).toEqual([{ count: 1, name: "Goblin", power: 1, toughness: 1, keywords: ["Haste"] }]);
    const both = read(T.treasure);
    expect(both.enters).toEqual({ ...none, artifacts: [{ count: 1, name: "Treasure" }] });
    expect(both.attacks).toEqual(both.enters);
  });

  it("your upkeep", () => {
    expect(read(T.arena).upkeep).toEqual({ ...none, draw: 1, lose: 1 });
    // Oloro's second upkeep line (from the command zone) has an "if": it's left out, the first stands.
    expect(read(T.oloro, "Oloro, Ageless Ascetic").upkeep).toEqual({ ...none, gain: 2 });
  });

  it("a creature entering, with its conditions", () => {
    expect(read(T.temur).creatureEnters).toMatchObject({ another: false, anyone: false, minPower: 4, keyword: null, out: { draw: 1 } });
    // Garruk's Uprising: the draw as creatures enter, not its own "if" as it enters.
    expect(read(T.uprising)).toMatchObject({ creatureEnters: { minPower: 4 } });
    expect(read(T.uprising).enters).toBeUndefined();
    expect(read(T.warden).creatureEnters).toMatchObject({ another: true, anyone: true, out: { gain: 1 } });
    expect(read(T.arcades, "Arcades, the Strategist").creatureEnters).toMatchObject({ keyword: "Defender", out: { draw: 1 } });
  });

  it("a creature dying", () => {
    expect(read(T.cutthroat).dies).toEqual({ another: false, own: true, out: { ...none, drain: 1, gain: 1 } });
    // "Target player": a choice, so it's left to the player.
    expect(read(T.bloodArtist, "Blood Artist").dies).toBeUndefined();
  });

  it("an opponent drawing", () => {
    expect(read(T.nekusar, "Nekusar, the Mindrazer").oppDraws).toEqual({ damage: 1, treasure: false, pay: 0 });
    expect(read(T.tithe).oppDraws).toEqual({ damage: 0, treasure: true, pay: 2 });
  });

  it("an opponent casting, unless they pay", () => {
    expect(read(T.rhystic).tax).toEqual({ noncreature: false, first: false, cost: 1 });
    expect(read(T.sentinel).tax).toEqual({ noncreature: true, first: true, cost: "power" });
    // Mystic Remora's cumulative upkeep isn't kept by the table, so neither is its tax.
    expect(read(T.remora).tax).toBeUndefined();
  });

  it("leaves alone what has its own reader, or more than the table can do", () => {
    expect(read(T.kefka, "Kefka, Court Mage")).toEqual({});
    expect(read(T.edgar, "Edgar Markov")).toEqual({});
    expect(read(T.witness)).toEqual({});
    expect(read(T.avenger)).toEqual({});
    // "Whenever you cast…" is the cast-trigger reader's.
    expect(read(T.helga, "Helga, Skittish Seer")).toEqual({});
  });

  it("doesn't pick one of two triggers of a kind", () => {
    expect(read("When this creature enters, draw a card.\nWhen this creature enters, you gain 3 life.").enters).toBeUndefined();
  });
});
