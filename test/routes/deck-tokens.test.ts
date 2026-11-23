import { beforeEach, describe, expect, it, vi } from "vitest";
import { jsonRequest, makeUser, params, prisma, signIn, signOut } from "@/test/db";
import { GET } from "@/app/api/decks/[id]/tokens/route";
import { forgetTokens, gatherTokens, isTablePart, mentionsTokens } from "@/lib/deck-tokens";
import { resetScryfallLimit } from "@/lib/scryfall-limit";

const treasure = { id: "t-treasure-a", name: "Treasure", type_line: "Token Artifact — Treasure", oracle_text: "{T}, Sacrifice this artifact: Add one mana of any color.", colors: [], image_uris: { normal: "https://cards.scryfall.io/normal/front/t/a.jpg" } };
// The same token, printed in another set.
const treasureAgain = { ...treasure, id: "t-treasure-b", image_uris: { normal: "https://cards.scryfall.io/normal/front/t/b.jpg" } };
const soldier = { id: "t-soldier", name: "Soldier", type_line: "Token Creature — Soldier", oracle_text: "", power: "1", toughness: "1", colors: ["W"], image_uris: { normal: "https://cards.scryfall.io/normal/front/t/s.jpg" } };
const bigSoldier = { ...soldier, id: "t-soldier-2", power: "2", toughness: "2" };
const emblem = { id: "t-emblem", name: "Elspeth, Sun's Champion Emblem", type_line: "Emblem — Elspeth", oracle_text: "Creatures you control get +2/+2 and have flying.", colors: [] };
const monarch = { id: "t-monarch", name: "The Monarch", type_line: "Card", oracle_text: "At the beginning of your end step, draw a card.", colors: [] };

describe("reading a deck's tokens", () => {
  it("knows what goes on the table", () => {
    expect(isTablePart({ id: "1", component: "token", type_line: "Token Creature — Soldier" })).toBe(true);
    expect(isTablePart({ id: "1", component: "combo_piece", type_line: "Emblem — Elspeth" })).toBe(true);
    expect(isTablePart({ id: "1", component: "combo_piece", type_line: "Card" })).toBe(true);
    expect(isTablePart({ id: "1", component: "combo_piece", type_line: "Dungeon — Undercity" })).toBe(true);
    // A meld partner, or the card itself, is in the deck or isn't: not a token.
    expect(isTablePart({ id: "1", component: "meld_part", type_line: "Legendary Creature — Eldrazi" })).toBe(false);
    expect(isTablePart({ id: "1", component: "combo_piece", type_line: "Legendary Planeswalker — Elspeth" })).toBe(false);

    expect(mentionsTokens("When this enters, create two Treasure tokens.")).toBe(true);
    expect(mentionsTokens("Each opponent creates a 1/1 Soldier creature token.")).toBe(true);
    expect(mentionsTokens("Destroy target token.")).toBe(false);
    expect(mentionsTokens(null)).toBe(false);
  });

  it("merges printings, keeps different tokens apart, and says who makes what", () => {
    const part = (c: { id: string; name: string; type_line: string }, component = "token") => ({ id: c.id, component, name: c.name, type_line: c.type_line });
    const cards = [
      { name: "Smothering Tithe", oracleText: "…create a Treasure token." },
      { name: "Dockside Extortionist", oracleText: "…create X Treasure tokens." },
      { name: "Elspeth, Sun's Champion", oracleText: "+1: Create three 1/1 white Soldier creature tokens." },
      { name: "Horn of Gondor", oracleText: "Create X 2/2 Soldier tokens." },
      { name: "Court of Grace", oracleText: "You become the monarch." },
      { name: "Homemade Token Maker", oracleText: "Create a 3/3 Frog token." },
      { name: "Counterspell", oracleText: "Counter target spell." },
      { name: "Unanswered Card", oracleText: "Create a Clue token." },
    ];
    const parts = new Map([
      ["smothering tithe", [part(treasure)]],
      ["dockside extortionist", [part(treasureAgain)]],
      ["elspeth, sun's champion", [part(soldier), part(emblem, "combo_piece")]],
      ["horn of gondor", [part(bigSoldier)]],
      ["court of grace", [part(monarch, "combo_piece")]],
      ["homemade token maker", []],
      ["counterspell", []],
    ]);
    const details = new Map([treasure, treasureAgain, soldier, bigSoldier, emblem, monarch].map((c) => [c.id, c]));
    const got = gatherTokens(cards, parts, details);

    // Tokens first, A to Z; then emblems; then markers.
    expect(got.tokens.map((t) => `${t.name} ${t.stats ?? "-"} [${t.kind}]`)).toEqual([
      "Soldier 1/1 [token]",
      "Soldier 2/2 [token]",
      "Treasure - [token]",
      "Elspeth, Sun's Champion Emblem - [emblem]",
      "The Monarch - [marker]",
    ]);
    const t = got.tokens.find((x) => x.name === "Treasure")!;
    expect(t.by).toEqual(["Dockside Extortionist", "Smothering Tithe"]);
    expect(t.imageUri).toContain("cards.scryfall.io");
    expect(got.tokens[0]).toMatchObject({ colors: "W", typeLine: "Token Creature — Soldier" });
    // A card that makes a token Scryfall has no card for: named, to check by hand.
    expect(got.unlisted).toEqual(["Homemade Token Maker"]);
    // Scryfall never answered for one card: the list may be short.
    expect(got.incomplete).toBe(true);

    // A token whose own card didn't come back still shows, by name.
    const bare = gatherTokens([cards[0]], new Map([["smothering tithe", [part(treasure)]]]), new Map());
    expect(bare.tokens).toMatchObject([{ name: "Treasure", imageUri: null, by: ["Smothering Tithe"] }]);
    expect(bare.incomplete).toBe(true);
  });
});

describe("/api/decks/<id>/tokens", () => {
  beforeEach(() => {
    forgetTokens();
    resetScryfallLimit();
  });

  async function makeDeck(userId: number, shared = false) {
    return prisma.deck.create({
      data: {
        name: "Tokens",
        userId,
        publicId: `tok-${Math.random().toString(36).slice(2)}`,
        format: "commander",
        shared,
        cards: {
          create: [
            { scryfallId: "a", name: "Smothering Tithe", imageUri: "x", typeLine: "Enchantment", oracleText: "…that player may pay {2}. If they don't, you create a Treasure token.", board: "deck" },
            { scryfallId: "b", name: "Plains", imageUri: "x", typeLine: "Basic Land — Plains", board: "deck", quantity: 30 },
            { scryfallId: "c", name: "Elspeth, Sun's Champion", imageUri: "x", typeLine: "Legendary Planeswalker — Elspeth", board: "pool" },
          ],
        },
      },
    });
  }

  it("asks Scryfall for the decklist's cards, then for their tokens, and keeps the answer", async () => {
    const user = await makeUser();
    await signIn(user);
    const deck = await makeDeck(user.id);
    const asked: unknown[] = [];
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { identifiers: Record<string, string>[] };
      asked.push(body.identifiers);
      const data = body.identifiers[0].name
        ? [{ id: "card-tithe", name: "Smothering Tithe", all_parts: [{ id: "card-tithe", component: "combo_piece", name: "Smothering Tithe", type_line: "Enchantment" }, { id: treasure.id, component: "token", name: "Treasure", type_line: treasure.type_line }] }]
        : [treasure];
      return new Response(JSON.stringify({ data }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const p = params({ id: deck.publicId! });
      const body = await (await GET(jsonRequest("/x"), p)).json();
      expect(body).toMatchObject({ tokens: [{ name: "Treasure", by: ["Smothering Tithe"], kind: "token" }], unlisted: [], incomplete: false });
      // The decklist only: no basic land, nothing from the pool of maybes.
      expect(asked).toEqual([[{ name: "Smothering Tithe" }], [{ id: treasure.id }]]);
      // A second look asks nothing.
      await GET(jsonRequest("/x"), p);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("no network in tests"); }));
    }
  });

  it("says the list may be short when Scryfall doesn't answer", async () => {
    const user = await makeUser();
    await signIn(user);
    const deck = await makeDeck(user.id);
    const res = await GET(jsonRequest("/x"), params({ id: deck.publicId! }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tokens: [], unlisted: [], incomplete: true });
  });

  it("is for whoever can see the deck", async () => {
    const owner = await makeUser();
    const deck = await makeDeck(owner.id);
    signOut();
    expect((await GET(jsonRequest("/x"), params({ id: deck.publicId! }))).status).toBe(404);
    await signIn(await makeUser());
    expect((await GET(jsonRequest("/x"), params({ id: deck.publicId! }))).status).toBe(404);
    expect((await GET(jsonRequest("/x"), params({ id: "nope" }))).status).toBe(404);
  });
});
