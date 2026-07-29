import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildCollectionFirstBlock,
  gatherContext,
  isCollectionBuild,
  parseCollection,
  resetResearchMemo,
  type DeckContext,
} from "./research";

// Skipping research is a latency win on one flow and a quality regression on
// every other, so these pin the decision against the payload shape each real
// caller sends rather than against an abstraction of it.
describe("isCollectionBuild", () => {
  it("matches the iOS suggest-a-deck flow, which omits currentDeck entirely", () => {
    // NewDeckView sends `currentDeck: nil`; JSONEncoder drops the key.
    expect(isCollectionBuild(undefined, ["Sol Ring", "Llanowar Elves"])).toBe(true);
    // A client that serialises the nil explicitly must behave identically.
    expect(isCollectionBuild(null, ["Sol Ring"])).toBe(true);
  });

  it("does NOT match the deck assistant on a brand-new empty deck", () => {
    // The regression this guards: AskAIView always sends the object, so an
    // empty deck must still get research. Testing emptiness would break this.
    const emptyDeck = { commander: null, cards: [] };
    expect(isCollectionBuild(emptyDeck, ["Sol Ring", "Counterspell"])).toBe(false);
  });

  it("does NOT match the deck assistant on a populated deck", () => {
    const deck = { commander: "Drana, Liberator of Malakir", cards: [{ name: "Sol Ring", quantity: 1 }] };
    expect(isCollectionBuild(deck, ["Sol Ring"])).toBe(false);
  });

  it("does NOT match a build with no collection to lean on", () => {
    // The "describe it" door with use == .free sends an empty array. There's
    // nothing to ground the answer in, so research still earns its latency.
    expect(isCollectionBuild(undefined, [])).toBe(false);
    expect(isCollectionBuild(null, [])).toBe(false);
  });

  it("treats a collection that parses to nothing as no collection", () => {
    // Junk in the array must not flip the decision on its own.
    expect(isCollectionBuild(undefined, parseCollection(["", "   "]))).toBe(false);
    expect(isCollectionBuild(undefined, parseCollection(["  Sol Ring  "]))).toBe(true);
  });
});

describe("buildCollectionFirstBlock", () => {
  it("frames the skip as deliberate, not as a retrieval failure", () => {
    const block = buildCollectionFirstBlock();
    // "could be retrieved" is the failure wording; a chosen skip must not
    // borrow it, or the model reads its grounding as degraded and hedges.
    expect(block).not.toContain("could be retrieved");
    expect(block).toContain("player's own collection");
  });

  it("points at the collection as ABOVE it, where the chat route puts it", () => {
    // The chat route orders its system blocks stable-first so the prompt cache
    // can hold the big ones, which lands the collection ahead of this preamble.
    // A stale "below" would send the model looking the wrong way.
    expect(buildCollectionFirstBlock()).toContain("listed above");
    expect(buildCollectionFirstBlock()).not.toContain("listed below");
  });
});

// The memo is a cost control, and what makes it safe is the KEY. Keyed on the
// commander it would look equivalent and quietly serve one question's themed
// pool to the next question — invisible at runtime, because a stale pool still
// reads like a plausible answer. Keyed on the URL it cannot. That distinction
// is the whole point, so it gets pinned here.
describe("research memoisation", () => {
  // analyzeIntent is the only thing gatherContext asks the model for. The
  // themes it returns drive which EDHREC pages get fetched, so the fake hands
  // back a different set per call to mimic a real follow-up question.
  function fakeAnthropic(themes: string[][]): { client: Anthropic; calls: () => number } {
    let calls = 0;
    const client = {
      messages: {
        // Echo back the commander gatherContext appended to the prompt, the way
        // the real call does. Hard-coding one name here would make every deck
        // produce the same EDHREC URL and quietly pass the key test below.
        create: async (params: { messages: { content: string }[] }) => {
          const asked = String(params?.messages?.[0]?.content ?? "");
          const commander = /\(commander: (.+?)\)/.exec(asked)?.[1] ?? null;
          const t = themes[Math.min(calls, themes.length - 1)];
          calls++;
          return {
            content: [{ type: "text", text: JSON.stringify({ commander, themes: t }) }],
          };
        },
      },
    };
    return { client: client as unknown as Anthropic, calls: () => calls };
  }

  const hits = { edhrec: 0, reddit: 0, moxfield: 0, spellbook: 0 };
  let urls: string[] = [];

  beforeEach(() => {
    resetResearchMemo();
    hits.edhrec = hits.reddit = hits.moxfield = hits.spellbook = 0;
    urls = [];
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      const url = String(typeof input === "object" && "url" in input ? input.url : input);
      urls.push(url);
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
      if (url.includes("edhrec")) {
        hits.edhrec++;
        return json({ cardviews: [{ name: "Doubling Season", num_decks: 10 }] });
      }
      if (url.includes("reddit")) {
        hits.reddit++;
        return json({ data: { children: [{ data: { title: "try [[Hardened Scales]]", selftext: "" } }] } });
      }
      if (url.includes("moxfield") && url.includes("search")) {
        hits.moxfield++;
        return json({ data: [{ publicId: "abc" }] });
      }
      if (url.includes("moxfield")) {
        return json({ boards: { mainboard: { cards: { a: { card: { name: "Sol Ring" } } } } } });
      }
      if (url.includes("commanderspellbook")) {
        hits.spellbook++;
        return json({ results: { almostIncluded: [] } });
      }
      return new Response("{}", { status: 404 });
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetResearchMemo();
  });

  const deck: DeckContext = {
    commander: "Atraxa, Praetors' Voice",
    cards: [{ name: "Sol Ring", manaCost: "{1}", typeLine: "Artifact", quantity: 1 }],
  };

  it("reuses the repeated requests across turns and refetches the ones that moved", async () => {
    const { client, calls } = fakeAnthropic([[]]);
    const first = await gatherContext(client, "what removal should I add?", deck);
    const second = await gatherContext(client, "and what about card draw?", deck);

    // Same URL both turns, so paid for once: the commander's EDHREC page and
    // the Moxfield search (which queries by commander).
    expect(hits.edhrec).toBe(1);
    expect(hits.moxfield).toBe(1);
    // Reddit's URL embeds the prompt, so a new question is a new URL — which is
    // right for the source whose job is tracking what was just asked.
    expect(hits.reddit).toBe(4); // r/EDH + r/magicTCG, on both turns
    // Spellbook is a POST and never goes through the memo: the deck can change
    // mid-conversation.
    expect(hits.spellbook).toBe(2);
    // Intent is prompt-derived and deliberately NOT memoised — it is what picks
    // the themes, and freezing it is the bug this key avoids.
    expect(calls()).toBe(2);
    // A memo hit must still produce a complete context, not a hollow one.
    expect(second.data.edhrec).toEqual(first.data.edhrec);
    expect(second.sources).toContain("EDHREC");
  });

  it("fetches a new question's themes instead of serving the first question's", async () => {
    // THE regression guard. A commander-keyed memo would answer turn 2 out of
    // turn 1's removal-flavoured pool, and would do it for every other player
    // on this commander too.
    const { client } = fakeAnthropic([["removal"], ["card draw"]]);
    await gatherContext(client, "what removal should I add?", deck);
    await gatherContext(client, "and what about card draw?", deck);

    const themePages = urls.filter((u) => u.includes("/themes/"));
    expect(themePages.some((u) => u.includes("removal"))).toBe(true);
    expect(themePages.some((u) => u.includes("card-draw"))).toBe(true);
  });

  it("does not let one commander read another's pool", async () => {
    const { client } = fakeAnthropic([[]]);
    await gatherContext(client, "ideas?", deck);
    await gatherContext(client, "ideas?", { ...deck, commander: "Krenko, Mob Boss" });
    expect(hits.edhrec).toBe(2);
  });

  it("does not pin a source outage in place for the life of the entry", async () => {
    // Caching a failure would keep serving empty pools for ten minutes instead
    // of retrying past a blip, so only a real answer is ever stored.
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      const url = String(typeof input === "object" && "url" in input ? input.url : input);
      if (url.includes("edhrec")) hits.edhrec++;
      return new Response("{}", { status: 500 });
    });
    const { client } = fakeAnthropic([[]]);
    await gatherContext(client, "ideas?", deck);
    await gatherContext(client, "ideas?", deck);
    expect(hits.edhrec).toBe(2);
  });
});
