import { describe, it, expect } from "vitest";
import { classify, landTarget, manaValue, type ScoredCard } from "./deck-score-classify";

/** A card with sensible defaults; the test names only what it is testing. */
function card(name: string, over: Partial<ScoredCard> = {}): ScoredCard {
  return {
    name,
    typeLine: "Creature — Human",
    oracleText: "",
    manaCost: "{2}",
    manaValue: 2,
    quantity: 1,
    power: 2,
    toughness: 2,
    keywords: [],
    producedMana: [],
    isCommander: false,
    ...over,
  };
}
const land = (name: string, colors: string[] = ["G"]) =>
  card(name, { typeLine: "Basic Land — Forest", oracleText: `({T}: Add {${colors[0]}}.)`, manaCost: null, manaValue: 0, power: null, toughness: null, producedMana: colors });
const spell = (name: string, type: string, text: string, mv = 2) =>
  card(name, { typeLine: type, oracleText: text, manaCost: `{${mv}}`, manaValue: mv, power: null, toughness: null });

/** Enough lands that the mana modifier stays quiet. */
const lands = Array.from({ length: 36 }, (_, i) => land(`Forest ${i}`));

describe("manaValue", () => {
  it("counts generic plus one per pip, X as zero", () => {
    expect(manaValue("{2}{U}{U}")).toBe(4);
    expect(manaValue("{X}{R}")).toBe(1);
    expect(manaValue(null)).toBe(0);
  });
});

describe("landTarget", () => {
  it("moves with the curve inside 30–40", () => {
    expect(landTarget(3)).toBe(36);
    expect(landTarget(1.5)).toBe(30);
    expect(landTarget(4.5)).toBe(40);
  });
});

describe("tutors", () => {
  it("tiers by name, then by cost and restriction from the text", () => {
    const c = classify([
      ...lands,
      spell("Demonic Tutor", "Sorcery", "Search your library for a card, put that card into your hand, then shuffle.", 2),
      spell("Diabolic Tutor", "Sorcery", "Search your library for a card, put that card into your hand, then shuffle.", 4),
      spell("Some Expensive Search", "Sorcery", "Search your library for a card, put that card into your hand, then shuffle.", 6),
      spell("Rampant Growth", "Sorcery", "Search your library for a basic land card, put that card onto the battlefield tapped, then shuffle.", 2),
      card("Fauna Shaman", { oracleText: "{G}, {T}, Discard a creature card: Search your library for a creature card, reveal it, put it into your hand, then shuffle." }),
    ]);
    expect(c.consistency.tutorPoints).toBe(6 + 4 + 2 + 6);
    expect(c.consistency.premiumTutors).toBe(2);
    expect(c.groups.tutors?.names).not.toContain("Rampant Growth · 4");
  });

  it("scores graveyard-destination tutors only with a recursion package", () => {
    const entomb = spell("Entomb", "Instant", "Search your library for a card, put that card into your graveyard, then shuffle.", 1);
    expect(classify([...lands, entomb]).consistency.tutorPoints).toBe(0);
    const reanimate = (n: number) => spell(`Reanimate ${n}`, "Sorcery", "Put target creature card from a graveyard onto the battlefield under your control.", 1);
    expect(classify([...lands, entomb, reanimate(1), reanimate(2), reanimate(3)]).consistency.tutorPoints).toBe(4);
  });

  it("adds the commander bonuses", () => {
    const c = classify(
      [...lands, card("Sisay", { isCommander: true, oracleText: "{W}{U}{B}{R}{G}: Search your library for a legendary permanent card, put it onto the battlefield, then shuffle." })],
      []
    );
    expect(c.consistency.tutorPoints).toBe(5);
    expect(c.resilience.battlefieldTutorCommander).toBe(true);
    expect(c.consistency.commandZoneEngine).toBe("access");
  });
});

describe("draw", () => {
  it("tiers engines, one-shots, selection and symmetric gifts", () => {
    const c = classify([
      ...lands,
      card("Phyrexian Arena", { typeLine: "Enchantment", oracleText: "At the beginning of your upkeep, you draw a card and you lose 1 life.", power: null }),
      card("Combat Draw", { oracleText: "Whenever this creature deals combat damage to a player, draw a card." }),
      spell("Night's Whisper", "Sorcery", "You draw two cards and you lose 2 life.", 2),
      spell("Ponder", "Sorcery", "Look at the top three cards of your library, then put them back in any order. You may shuffle. Draw a card.", 1),
      card("Howling Mine", { typeLine: "Artifact", oracleText: "At the beginning of each player's draw step, if this artifact is untapped, that player draws an additional card.", power: null }),
      card("Mind Stone", { typeLine: "Artifact", oracleText: "{T}: Add {C}.\n{1}, {T}, Sacrifice this artifact: Draw a card.", power: null }),
      card("Bowmasters", { oracleText: "Whenever an opponent draws a card except the first one they draw in each of their draw steps, this creature deals 1 damage to any target." }),
    ]);
    const names = c.groups.draw?.names ?? [];
    expect(names).toContain("Phyrexian Arena · 4");
    expect(names).toContain("Combat Draw · 3");
    expect(names).toContain("Night's Whisper · 2");
    expect(names).toContain("Ponder · 3");
    expect(names).toContain("Howling Mine · 2");
    expect(names).toContain("Mind Stone · 2");
    expect(names.some((n) => n.startsWith("Bowmasters"))).toBe(false);
    expect(c.consistency.drawPoints).toBe(4 + 3 + 2 + 3 + 2 + 2);
  });

  it("caps selection at thirty points", () => {
    const cantrips = Array.from({ length: 15 }, (_, i) => spell(`Cantrip ${i}`, "Instant", "Scry 1. Draw a card.", 1));
    expect(classify([...lands, ...cantrips]).consistency.drawPoints).toBe(30);
  });
});

describe("interaction", () => {
  it("prices counters, free spells, instants and hard wipes on the stack", () => {
    const c = classify([
      ...lands,
      spell("Counterspell", "Instant", "Counter target spell.", 2),
      spell("Force of Will", "Instant", "You may pay 1 life and exile a blue card from your hand rather than pay this spell's mana cost.\nCounter target spell.", 5),
      spell("Swords to Plowshares", "Instant", "Exile target creature. Its controller gains life equal to its power.", 1),
      spell("Murder", "Instant", "Destroy target creature.", 3),
      spell("Wrath of God", "Sorcery", "Destroy all creatures. They can't be regenerated.", 4),
      spell("Toxic Deluge", "Sorcery", "As an additional cost to cast this spell, pay X life. All creatures get -X/-X until end of turn.", 3),
      spell("Nature's Claim", "Instant", "Destroy target artifact or enchantment. Its controller gains 4 life.", 1),
      spell("Silence", "Instant", "Your opponents can't cast spells this turn.", 1),
    ]);
    // Counterspell 3, Force 5, Swords 1, Murder 1, Wrath 0, Deluge 1, Claim 1, Silence 3.
    expect(c.interaction.stackPoints).toBe(3 + 5 + 1 + 1 + 0 + 1 + 1 + 3);
    expect(c.interaction.pieces).toBe(8);
    expect(c.interaction.counterspells).toBe(2);
    expect(c.interaction.answersCreatures).toBe(true);
    expect(c.interaction.answersArtifacts).toBe(true);
    expect(c.interaction.answersEnchantments).toBe(true);
    expect(c.resilience.stackProtectionPieces).toBe(3);
  });

  it("judges a creature-only wrath one-sided in a creature-light deck", () => {
    const wrath = spell("Wrath of God", "Sorcery", "Destroy all creatures. They can't be regenerated.", 4);
    const few = classify([...lands, wrath, wrath, wrath]);
    expect(few.interaction.symmetricWipes).toBe(0);
    const many = classify([...lands, wrath, wrath, wrath, ...Array.from({ length: 12 }, (_, i) => card(`Bear ${i}`))]);
    expect(many.interaction.symmetricWipes).toBe(3);
  });

  it("does not read graveyard exile as creature removal", () => {
    const c = classify([...lands, spell("Cremate", "Instant", "Exile target card from a graveyard.\nDraw a card.", 1)]);
    expect(c.interaction.pieces).toBe(1);
    expect(c.interaction.answersCreatures).toBe(false);
  });
});

describe("resilience", () => {
  it("counts threats by power, evasion and value, weighing vanilla at half", () => {
    const c = classify([
      ...lands,
      card("Dreadmaw", { power: 6, keywords: ["Trample"], oracleText: "Trample" }),
      card("Big Vanilla", { power: 5, oracleText: "" }),
      card("Small Flyer", { power: 1, keywords: ["Flying"], oracleText: "Flying" }),
      card("Sheoldred", { power: 4, keywords: ["Deathtouch"], oracleText: "Deathtouch\nWhenever you draw a card, you gain 2 life." }),
      card("Jace", { typeLine: "Legendary Planeswalker — Jace", oracleText: "+1: Draw a card.", power: null }),
    ]);
    expect(c.resilience.combat?.threats).toBe(1 + 0.5 + 0 + 1 + 1);
  });

  it("counts combo lines, halving clunky ones and shared points of failure", () => {
    const c = classify(
      [...lands, card("A"), card("B"), card("C"), card("D"), card("E"), card("F"), card("G")],
      [
        { pieces: ["A", "B"], produces: ["Win the game"], manaNeeded: "{U}" },
        { pieces: ["A", "C"], produces: ["Infinite mana"], manaNeeded: "" },
        { pieces: ["D", "E", "F", "G"], produces: ["Win the game"], manaNeeded: "" },
        { pieces: ["B", "D"], produces: ["Untap all lands"], manaNeeded: "" },
      ]
    );
    // A+B and A+C share A, so they are one line; the four-card line is
    // clunky (half); the value line is not a win.
    expect(c.comboLines.total).toBe(3);
    expect(c.comboLines.counted).toBe(1 + 0.5);
    expect(c.comboLines.sharedFailure).toBe(true);
  });

  it("reads commander dependency from where the engine and the lines live", () => {
    const commander = card("Engine Commander", { isCommander: true, oracleText: "At the beginning of your end step, draw a card." });
    const thin = classify([...lands, commander, card("Bear")]);
    expect(thin.resilience.commanderDependency).toBe("high");

    const oracle = card("Thassa's Oracle");
    const consult = spell("Demonic Consultation", "Instant", "Choose a card name. Exile the top six cards of your library.", 1);
    const tutors = Array.from({ length: 5 }, (_, i) => spell(`Tutor ${i}`, "Sorcery", "Search your library for a card, put that card into your hand, then shuffle.", 2));
    const draws = Array.from({ length: 9 }, (_, i) => card(`Draw ${i}`, { typeLine: "Enchantment", oracleText: "Whenever an opponent casts a spell, you may draw a card.", power: null }));
    const loose = classify([...lands, card("Goodstuff Commander", { isCommander: true }), oracle, consult, ...tutors, ...draws], [
      { pieces: ["Thassa's Oracle", "Demonic Consultation"], produces: ["Win the game"], manaNeeded: "" },
    ]);
    expect(loose.resilience.commanderDependency).toBe("none");
  });

  it("penalises an engine that folds to one hoser class", () => {
    const rocks = Array.from({ length: 30 }, (_, i) => card(`Rock ${i}`, { typeLine: "Artifact", oracleText: "{T}: Add {C}.", power: null }));
    const c = classify([...lands, ...rocks, card("Bear")]);
    expect(c.resilience.engineExposure).toBe(-2);
    expect(c.exposure.className).toBe("artifact");
  });
});

describe("mana reliability", () => {
  it("penalises a short mana base and a starved colour", () => {
    const spells = Array.from({ length: 30 }, (_, i) => card(`Spell ${i}`, { manaCost: "{2}{U}{U}", manaValue: 4 }));
    const short = classify([...Array.from({ length: 24 }, (_, i) => land(`Forest ${i}`)), ...spells]);
    expect(short.consistency.manaReliability).toBe(-2);
    const fine = classify([...Array.from({ length: 38 }, (_, i) => land(`Island ${i}`, ["U"])), ...spells]);
    expect(fine.consistency.manaReliability).toBe(0);
  });
});
