import { describe, expect, it } from "vitest";
import { jsonRequest, makeUser, params, prisma, signIn, signOut } from "@/test/db";
import { POST } from "@/app/api/decks/[id]/assemble/replace/route";
import { applyReplacements, candidatesFrom, cleanSwaps, commanderKeys, legalIn, replaceable, replaceContext, replacePrompt } from "@/lib/assemble-replace";
import type { CollectionLookup, OutCard } from "@/lib/scryfall";

let seq = 0;
interface Row {
  name: string;
  board?: string;
  assembled?: boolean;
  quantity?: number;
  typeLine?: string;
  colorIdentity?: string;
  role?: string;
}

async function makeDeck(userId: number, name: string, cards: Row[], opts: { format?: string; commander?: string } = {}) {
  seq += 1;
  return prisma.deck.create({
    data: {
      name,
      userId,
      publicId: `deck-${seq}`,
      format: opts.format ?? "commander",
      commander: opts.commander ?? null,
      cards: {
        create: cards.map((c, i) => ({
          scryfallId: `${seq}-${i}`,
          name: c.name,
          imageUri: "https://cards.scryfall.io/normal/front/a/b/x.jpg",
          board: c.board ?? "deck",
          assembled: c.assembled ?? false,
          quantity: c.quantity ?? 1,
          typeLine: c.typeLine ?? "Artifact",
          colorIdentity: c.colorIdentity ?? "",
          role: c.role ?? null,
        })),
      },
    },
    include: { cards: true },
  });
}

async function own(userId: number, cards: { name: string; quantity?: number; typeLine?: string | null; colorIdentity?: string }[]) {
  for (const c of cards) {
    await prisma.collectionCard.create({
      data: {
        userId,
        name: c.name,
        nameKey: c.name.toLowerCase(),
        quantity: c.quantity ?? 1,
        typeLine: c.typeLine === undefined ? "Artifact" : c.typeLine,
        colorIdentity: c.colorIdentity ?? "",
        manaCost: "{2}",
        enriched: true,
      },
    });
  }
}

/** Scryfall, made up: every name asked for is a legal colourless artifact, unless told otherwise. */
function scryfall(over: Record<string, Partial<OutCard>> = {}, failed: string[] = []) {
  return async (names: string[]): Promise<CollectionLookup> => {
    const found = new Map<string, OutCard>();
    for (const name of names) {
      if (failed.includes(name)) continue;
      found.set(name.toLowerCase(), {
        id: `sf-${name.toLowerCase().replace(/\W+/g, "-")}`,
        name,
        imageUri: `https://cards.scryfall.io/normal/front/a/b/${encodeURIComponent(name)}.jpg`,
        manaCost: "{2}",
        typeLine: "Artifact",
        oracleText: "",
        colorIdentity: "",
        legalities: { commander: "legal", modern: "legal" },
        ...over[name],
      });
    }
    return { found, notFound: [], failed };
  };
}

describe("what counts as missing, and what is on offer", () => {
  it("never swaps the commander or a basic land", () => {
    const commanders = commanderKeys({ format: "commander", commander: "Tymna the Weaver + Kraum, Ludevic's Opus" });
    expect(replaceable({ name: "Tymna the Weaver", typeLine: "Legendary Creature" }, commanders)).toBe(false);
    expect(replaceable({ name: "kraum, ludevic's opus", typeLine: "Legendary Creature" }, commanders)).toBe(false);
    expect(replaceable({ name: "Island", typeLine: "Basic Land — Island" }, commanders)).toBe(false);
    expect(replaceable({ name: "Sol Ring", typeLine: "Artifact" }, commanders)).toBe(true);
    // Outside Commander, a card named like the "commander" is just a card.
    expect(replaceable({ name: "Tymna the Weaver", typeLine: "Legendary Creature" }, commanderKeys({ format: "modern", commander: "Tymna the Weaver" }))).toBe(true);
  });

  it("offers spare cards of the collection that fit the deck", () => {
    const collection = [
      { name: "Mind Stone", quantity: 1, typeLine: "Artifact", manaCost: "{2}", colorIdentity: "" },
      { name: "Sol Ring", quantity: 1, typeLine: "Artifact", manaCost: "{1}", colorIdentity: "" }, // already in the deck
      { name: "Lightning Bolt", quantity: 4, typeLine: "Instant", manaCost: "{R}", colorIdentity: "R" }, // not the commander's colour
      { name: "Counterspell", quantity: 2, typeLine: "Instant", manaCost: "{U}{U}", colorIdentity: "U" },
      { name: "Thought Vessel", quantity: 1, typeLine: "Artifact", manaCost: "{2}", colorIdentity: "" }, // its one copy is in another deck
      { name: "Swords to Plowshares", quantity: 2, typeLine: "Instant", manaCost: "{W}", colorIdentity: "W" }, // one of two is spare
      { name: "Island", quantity: 30, typeLine: "Basic Land — Island", manaCost: null, colorIdentity: "U" },
      { name: "Command Tower", quantity: 1, typeLine: "Land", manaCost: null, colorIdentity: "" }, // no land is missing
      { name: "Mystery Card", quantity: 1, typeLine: null, manaCost: null, colorIdentity: null }, // never matched to a real card
    ];
    const got = candidatesFrom(collection, {
      inDeck: new Set(["sol ring"]),
      usedElsewhere: new Map([["thought vessel", 1], ["swords to plowshares", 1]]),
      identity: "WU",
      missing: [{ typeLine: "Artifact" }, { typeLine: "Artifact" }, { typeLine: "Instant" }],
    });
    // The kind most missing first, then A to Z.
    expect(got.map((c) => c.name)).toEqual(["Mind Stone", "Counterspell", "Swords to Plowshares"]);
    expect(got.find((c) => c.name === "Swords to Plowshares")?.free).toBe(1);

    // A land is missing and no spell: now only lands are offered.
    const lands = candidatesFrom(collection, { inDeck: new Set(), usedElsewhere: new Map(), identity: "WU", missing: [{ typeLine: "Land" }] });
    expect(lands.map((c) => c.name)).toEqual(["Command Tower"]);
  });

  it("believes the model only as far as it can check", () => {
    const ctx = {
      missing: [
        { id: 1, name: "Arcane Signet", quantity: 1, typeLine: "Artifact", manaCost: "{2}", oracleText: null, role: "ramp" },
        { id: 2, name: "Swords to Plowshares", quantity: 1, typeLine: "Instant", manaCost: "{W}", oracleText: null, role: "removal" },
        { id: 3, name: "Rhystic Study", quantity: 1, typeLine: "Enchantment", manaCost: "{2}{U}", oracleText: null, role: "draw" },
      ],
      candidates: [
        { name: "Mind Stone", typeLine: "Artifact", manaCost: "{2}", free: 1 },
        { name: "Path to Exile", typeLine: "Instant", manaCost: "{W}", free: 1 },
      ],
    };
    const swaps = cleanSwaps(
      {
        swaps: [
          { out: "arcane signet", in: "MIND STONE", why: "also a two-mana rock" },
          { out: "Swords to Plowshares", in: "Mind Stone", why: "taken already" },
          { out: "Rhystic Study", in: "Mystic Remora", why: "not in the collection" },
          { out: "Sol Ring", in: "Path to Exile", why: "not a missing card" },
          { out: "Rhystic Study", in: null, why: "nothing fits" },
          { out: "Swords to Plowshares", in: "Path to Exile", why: "x".repeat(400) },
          "nonsense",
        ],
      },
      ctx
    );
    expect(swaps.map((s) => [s.outId, s.out, s.in])).toEqual([
      [1, "Arcane Signet", "Mind Stone"],
      [2, "Swords to Plowshares", "Path to Exile"],
    ]);
    expect(swaps[1].why.length).toBe(120);
    expect(cleanSwaps(null, ctx)).toEqual([]);
    expect(cleanSwaps({ swaps: "no" }, ctx)).toEqual([]);
  });

  it("knows what a format allows", () => {
    expect(legalIn({ legalities: { commander: "legal" }, colorIdentity: "U" }, "Commander", "WU")).toBe(true);
    expect(legalIn({ legalities: { commander: "banned" }, colorIdentity: "" }, "commander", "WU")).toBe(false);
    expect(legalIn({ legalities: { commander: "legal" }, colorIdentity: "R" }, "commander", "WU")).toBe(false);
    // A format Scryfall doesn't list, or a card it knows nothing of, isn't held back.
    expect(legalIn({ legalities: null, colorIdentity: null }, "kitchen table", null)).toBe(true);
  });
});

describe("the deck and the collection, read for a plan", () => {
  it("lists what isn't ticked, what stays, and what's spare", async () => {
    const user = await makeUser();
    const deck = await makeDeck(
      user.id,
      "Mine",
      [
        { name: "Atraxa, Praetors' Voice", typeLine: "Legendary Creature — Phyrexian Angel Horror", colorIdentity: "WUBG" },
        { name: "Sol Ring", assembled: true },
        { name: "Arcane Signet", role: "ramp" },
        { name: "Forest", typeLine: "Basic Land — Forest", quantity: 8, colorIdentity: "G" },
        { name: "Mind Stone", board: "pool" },
      ],
      { commander: "Atraxa, Praetors' Voice" }
    );
    await makeDeck(user.id, "Other", [{ name: "Thought Vessel" }]);
    await own(user.id, [{ name: "Mind Stone" }, { name: "Thought Vessel" }, { name: "Fellwar Stone", quantity: 2 }, { name: "Lightning Bolt", typeLine: "Instant", colorIdentity: "R" }]);

    const ctx = await replaceContext(deck, user.id);
    expect(ctx.identity?.split("").sort().join("")).toBe("BGUW");
    expect(ctx.missing.map((m) => m.name)).toEqual(["Arcane Signet"]);
    expect(ctx.kept.sort()).toEqual(["Atraxa, Praetors' Voice", "Forest", "Sol Ring"]);
    // Mind Stone is only in this deck's pool of maybes: on offer. Thought
    // Vessel's one copy is in another deck, and Bolt is the wrong colour.
    expect(ctx.candidates.map((c) => c.name)).toEqual(["Fellwar Stone", "Mind Stone"]);
    expect(ctx.collectionSize).toBe(4);

    const prompt = replacePrompt(ctx);
    expect(prompt).toContain("Commander: Atraxa, Praetors' Voice");
    expect(prompt).toContain("- Arcane Signet | - | Artifact | ramp");
    expect(prompt).toContain("Fellwar Stone | {2} | Artifact");
    expect(prompt).not.toContain("Lightning Bolt");
  });
});

describe("making the swaps", () => {
  async function table() {
    const user = await makeUser();
    const deck = await makeDeck(
      user.id,
      "Stax",
      [
        { name: "Sol Ring", assembled: true },
        { name: "Arcane Signet" },
        { name: "Mana Crypt" },
        { name: "Mind Stone", board: "pool" },
      ],
      { format: "modern" }
    );
    await own(user.id, [{ name: "Mind Stone" }, { name: "Fellwar Stone" }, { name: "Banned Thing" }]);
    const [, signet, crypt] = deck.cards;
    return { user, deck, signet, crypt };
  }
  const deckNames = async (deckId: number) => (await prisma.poolCard.findMany({ where: { deckId, board: "deck" }, orderBy: { name: "asc" } })).map((c) => c.name);

  it("in the deck itself, with the list as it was saved as a version", async () => {
    const { user, deck, signet, crypt } = await table();
    const res = await applyReplacements(deck, user.id, [{ outId: signet.id, in: "mind stone" }, { outId: crypt.id, in: "Fellwar Stone" }], "deck", scryfall());
    expect(res).toMatchObject({ ok: true, deck: deck.publicId, replaced: 2, skipped: [], version: "Before replacing 2 missing cards" });
    expect(await deckNames(deck.id)).toEqual(["Fellwar Stone", "Mind Stone", "Sol Ring"]);
    // What was found stays ticked; what came in is still to find.
    const rows = await prisma.poolCard.findMany({ where: { deckId: deck.id } });
    expect(rows.find((r) => r.name === "Sol Ring")?.assembled).toBe(true);
    expect(rows.find((r) => r.name === "Mind Stone")).toMatchObject({ assembled: false, board: "deck", quantity: 1 });
    // Mind Stone was in the pool: it moved, it isn't there twice.
    expect(rows.filter((r) => r.name === "Mind Stone").length).toBe(1);
    // The old list can be put back.
    const version = await prisma.deckVersion.findFirst({ where: { deckId: deck.id } });
    expect(JSON.parse(version!.cards).map((c: { name: string }) => c.name).sort()).toEqual(["Arcane Signet", "Mana Crypt", "Mind Stone", "Sol Ring"]);
  });

  it("or in a new deck, this one left alone", async () => {
    const { user, deck, signet } = await table();
    const res = await applyReplacements(deck, user.id, [{ outId: signet.id, in: "Fellwar Stone" }], "copy", scryfall());
    expect(res).toMatchObject({ ok: true, replaced: 1, version: null });
    if (!res.ok) return;
    expect(res.deck).not.toBe(deck.publicId);
    const copy = await prisma.deck.findFirst({ where: { publicId: res.deck }, include: { cards: true } });
    expect(copy).toMatchObject({ name: "Stax (from my collection)", userId: user.id, format: "modern" });
    expect(copy!.cards.filter((c) => c.board === "deck").map((c) => c.name).sort()).toEqual(["Fellwar Stone", "Mana Crypt", "Sol Ring"]);
    // The ticks come along: the cards already found are still found.
    expect(copy!.cards.find((c) => c.name === "Sol Ring")?.assembled).toBe(true);
    expect(await deckNames(deck.id)).toEqual(["Arcane Signet", "Mana Crypt", "Sol Ring"]);
    expect(await prisma.deckVersion.count({ where: { deckId: deck.id } })).toBe(0);
  });

  it("skips a card the format doesn't allow, and says so", async () => {
    const { user, deck, signet, crypt } = await table();
    const res = await applyReplacements(
      deck,
      user.id,
      [{ outId: signet.id, in: "Banned Thing" }, { outId: crypt.id, in: "Fellwar Stone" }],
      "deck",
      scryfall({ "Banned Thing": { legalities: { modern: "banned" } } })
    );
    expect(res).toMatchObject({ ok: true, replaced: 1, skipped: ["Banned Thing"] });
    expect(await deckNames(deck.id)).toEqual(["Arcane Signet", "Fellwar Stone", "Sol Ring"]);
  });

  it("takes nothing on trust from the request", async () => {
    const { user, deck, signet, crypt } = await table();
    const sol = deck.cards[0];
    const other = await makeDeck(user.id, "Other", [{ name: "Opt" }], { format: "modern" });
    const res = await applyReplacements(
      deck,
      user.id,
      [
        { outId: sol.id, in: "Fellwar Stone" }, // ticked: not missing
        { outId: other.cards[0].id, in: "Fellwar Stone" }, // another deck's card
        { outId: signet.id, in: "Black Lotus" }, // not in the collection
        { outId: signet.id, in: "Fellwar Stone" },
        { outId: crypt.id, in: "Fellwar Stone" }, // the same card twice
      ],
      "deck",
      scryfall()
    );
    expect(res).toMatchObject({ ok: true, replaced: 1 });
    expect(await deckNames(deck.id)).toEqual(["Fellwar Stone", "Mana Crypt", "Sol Ring"]);
    expect(await deckNames(other.id)).toEqual(["Opt"]);

    const none = await applyReplacements(deck, user.id, [{ outId: 999999, in: "Mind Stone" }], "deck", scryfall());
    expect(none).toMatchObject({ ok: false, status: 400 });
  });

  it("changes nothing when Scryfall doesn't answer", async () => {
    const { user, deck, signet } = await table();
    const res = await applyReplacements(deck, user.id, [{ outId: signet.id, in: "Fellwar Stone" }], "deck", scryfall({}, ["Fellwar Stone"]));
    expect(res).toMatchObject({ ok: false, status: 502 });
    expect(await deckNames(deck.id)).toEqual(["Arcane Signet", "Mana Crypt", "Sol Ring"]);
    expect(await prisma.deckVersion.count({ where: { deckId: deck.id } })).toBe(0);
  });

  it("keeps a playset a playset, as far as the spare copies go", async () => {
    const user = await makeUser();
    const deck = await makeDeck(user.id, "Burn", [{ name: "Lightning Bolt", quantity: 4, typeLine: "Instant" }], { format: "modern" });
    await own(user.id, [{ name: "Shock", quantity: 3, typeLine: "Instant" }]);
    const res = await applyReplacements(deck, user.id, [{ outId: deck.cards[0].id, in: "Shock" }], "deck", scryfall({ Shock: { typeLine: "Instant" } }));
    expect(res).toMatchObject({ ok: true, replaced: 1 });
    expect(await prisma.poolCard.findFirst({ where: { deckId: deck.id, name: "Shock" } })).toMatchObject({ quantity: 3 });
  });
});

describe("/api/decks/<id>/assemble/replace", () => {
  it("is for the deck's owner, signed in", async () => {
    const owner = await makeUser();
    const deck = await makeDeck(owner.id, "Mine", [{ name: "Sol Ring" }]);
    const p = params({ id: deck.publicId! });
    signOut();
    expect((await POST(jsonRequest("/x", {}), p)).status).toBe(401);
    await signIn(await makeUser());
    expect((await POST(jsonRequest("/x", {}), p)).status).toBe(404);
    // A public deck nobody owns has nobody's collection behind it.
    const ownerless = await prisma.deck.create({ data: { name: "Old", publicId: "old-public", format: "modern" } });
    expect((await POST(jsonRequest("/x", {}), params({ id: ownerless.publicId! }))).status).toBe(404);
  });

  it("says so when there's nothing to replace, or nothing to replace it with, without spending an ask", async () => {
    const user = await makeUser();
    await signIn(user);
    const done = await makeDeck(user.id, "Done", [{ name: "Sol Ring", assembled: true }, { name: "Island", typeLine: "Basic Land — Island" }]);
    const nothing = await POST(jsonRequest("/x", {}), params({ id: done.publicId! }));
    expect(nothing.status).toBe(400);
    expect((await nothing.json()).error).toMatch(/nothing to replace/i);

    const deck = await makeDeck(user.id, "Mine", [{ name: "Sol Ring" }], { format: "modern" });
    const p = params({ id: deck.publicId! });
    const empty = await POST(jsonRequest("/x", {}), p);
    expect(empty.status).toBe(400);
    expect(await empty.json()).toMatchObject({ code: "no_collection" });

    // A collection, but none of it spare for this deck: an empty plan.
    await own(user.id, [{ name: "Sol Ring" }]);
    const plan = await POST(jsonRequest("/x", {}), p);
    expect(plan.status).toBe(200);
    expect(await plan.json()).toEqual({ swaps: [], unmatched: ["Sol Ring"] });
    expect((await prisma.user.findUnique({ where: { id: user.id } }))?.aiCount ?? 0).toBe(0);
  });

  it("makes no swap it can't look up", async () => {
    const user = await makeUser();
    await signIn(user);
    const deck = await makeDeck(user.id, "Mine", [{ name: "Arcane Signet" }], { format: "modern" });
    await own(user.id, [{ name: "Mind Stone" }]);
    // The test's network is down, as Scryfall would be.
    const res = await POST(jsonRequest("/x", { swaps: [{ outId: deck.cards[0].id, in: "Mind Stone" }], as: "deck" }), params({ id: deck.publicId! }));
    expect(res.status).toBe(502);
    expect((await prisma.poolCard.findMany({ where: { deckId: deck.id } })).map((c) => c.name)).toEqual(["Arcane Signet"]);
    // And rubbish in the request is a 400, not a crash.
    expect((await POST(jsonRequest("/x", { swaps: [null, 3, { outId: "x" }] }), params({ id: deck.publicId! }))).status).toBe(400);
  });
});
