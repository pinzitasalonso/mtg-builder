import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bestFinishes,
  fetchArchetypeDecks,
  fetchDecklist,
  fetchMetagame,
  findArchetype,
  parseCedhMetagame,
  parseDeckRows,
  parseMetagame,
  parsePeriods,
  pickPeriod,
} from "./mtgtop8";

// Cut from the real pages (October 2026), whitespace and all.
const PERIODS = `<a href="?f=MO&meta=54&a="><div style="padding:3px;" class="S14 chosen_tr">Last 2 Weeks</div></a><a href="?f=MO&meta=51&a="><div style="padding:3px;" class="S14">Last 2 Months</div></a><a href="?f=MO&meta=304&a="><div style="padding:3px;" class="S14">Last 5 Days</div></a>`;

const FORMAT_PAGE = `${PERIODS}
\t<div class=S14 align=center>777 decks</div>
\t\t  <div class=meta_arch align=center style="margin:10px;">AGGRO 48%</div>
\t\t\t\t<div style="display:inline-block;width:48%;" class=hover_tr>
\t\t\t\t    <div align=center style="width:100%;">
\t\t\t\t      <div class=S14><a href=archetype?a=918&meta=51&f=MO>Rakdos Aggro</a></div>
\t\t\t\t      <div>
\t\t\t\t        <div style="display:inline-block;width:48%;" class=S14>15 %</div>
\t\t\t\t      </div>
\t\t\t\t    </div>
\t\t\t\t</div>
\t\t\t\t<div style="display:inline-block;width:48%;" class=hover_tr>
\t\t\t\t      <div class=S14><a href=archetype?a=189&meta=51&f=MO>Affinity</a></div>
\t\t\t\t      <div>
\t\t\t\t        <div style="display:inline-block;width:48%;" class=S14>7 %</div>
\t\t\t\t      </div>
\t\t\t\t</div>
\t\t  <div class=meta_arch align=center style="margin:10px;">COMBO 36%</div>
\t\t\t\t<div style="display:inline-block;width:48%;" class=hover_tr>
\t\t\t\t      <div class=S14><a href=archetype?a=4&meta=51&f=MO>Amulet Titan</a></div>
\t\t\t\t      <div>
\t\t\t\t        <div style="display:inline-block;width:48%;" class=S14>21 %</div>
\t\t\t\t      </div>
\t\t\t\t</div>`;

const CEDH_DECKS = `
<div class=S14 align=center style="margin:10px;">770 decks</div>
<div align=center>
\t\t\t\t<div style="width:90%;" class=hover_tr>
\t\t\t\t    <div align=center style="width:60%;" class=S14><a href=archetype?a=1246&meta=263&f=cEDH&color_id=&show=pop>Kinnan, Bonder Prodigy</a></div>
\t\t\t\t    <div style="width:20%;" align=center><img style="height:18px;vertical-align:-20%;" src=/graph/manas/G.png></div>
\t\t\t\t    <div style="width:20%;" class=S14 align=center>101.3 <span class=O14>&permil;</span></div>
\t\t\t\t</div>
\t\t\t\t<div style="width:90%;" class=hover_tr>
\t\t\t\t    <div align=center style="width:60%;" class=S14><a href=archetype?a=1158&meta=263&f=cEDH&color_id=&show=pop>Partner WUBR</a></div>
\t\t\t\t    <div style="width:20%;" class=S14 align=center>94.8 <span class=O14>&permil;</span></div>
\t\t\t\t</div>`;

const row = (e: number, d: number, name: string, player: string, event: string, stars: number, rank: string, date: string) => `<tr class=hover_tr>
  <td><input type=checkbox name=deck_check[1] value=1 checked><input type=hidden name=deck_ref[1] value=${d}></td>
  <td><a href=/event?e=${e}&d=${d}&f=MO>${name}</a></td>
  <td><a class=player href=/search?player=${player}>${player}</a></td>
  <td><a href=/event?e=${e}&f=MO>${event}</a></td>
  <td class=O16>${"<img src=/graph/star.png>".repeat(stars)}</td>
  <td>${rank}</td>
  <td>${date}</td>
</tr>`;
const ARCHETYPE_PAGE = [
  row(92895, 905768, "Rakdos Delirium", "fradev1988", "MTGO Challenge 16", 2, "5-8", "27/10/26"),
  row(92951, 906137, "Rakdos Delirium", "SupremX", "MTGO League", 1, "2", "27/10/26"),
  row(92884, 905658, "Rakdos Delirium", "Alexis Cuevas", "Super Sunday RCQ", 2, "1", "25/10/26"),
  row(92882, 905646, "Rakdos Delirium", "Marcus Pacheco", "Laughing Dragon RCQ", 1, "1", "25/10/26"),
].join("\n");

describe("parsing MTGTop8", () => {
  it("reads the periods, and picks two months", () => {
    const periods = parsePeriods(PERIODS);
    expect(periods.map((p) => p.label)).toEqual(["Last 2 Weeks", "Last 2 Months", "Last 5 Days"]);
    expect(pickPeriod(periods)).toEqual({ id: "51", label: "Last 2 Months" });
    expect(pickPeriod([{ id: "327", label: "Last 2 Weeks" }])?.id).toBe("327");
    expect(pickPeriod([])).toBeNull();
  });

  it("reads a constructed metagame", () => {
    const m = parseMetagame(FORMAT_PAGE);
    expect(m.decks).toBe(777);
    expect(m.groups).toEqual([{ label: "AGGRO", share: 48 }, { label: "COMBO", share: 36 }]);
    expect(m.archetypes).toEqual([
      { id: "4", name: "Amulet Titan", share: 21, group: "combo" },
      { id: "918", name: "Rakdos Aggro", share: 15, group: "aggro" },
      { id: "189", name: "Affinity", share: 7, group: "aggro" },
    ]);
  });

  it("reads cEDH's commanders, per mille into percent", () => {
    const m = parseCedhMetagame(CEDH_DECKS);
    expect(m.decks).toBe(770);
    expect(m.archetypes).toEqual([
      { id: "1246", name: "Kinnan, Bonder Prodigy", share: 10.13 },
      { id: "1158", name: "Partner WUBR", share: 9.48 },
    ]);
  });

  it("reads an archetype's finishes and puts the best first", () => {
    const rows = parseDeckRows(ARCHETYPE_PAGE);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toEqual({ eventId: "92895", deckId: "905768", name: "Rakdos Delirium", player: "fradev1988", event: "MTGO Challenge 16", stars: 2, rank: "5-8", date: "27/10/26" });
    // Two wins: the bigger event first; then a second place over a top 8.
    expect(bestFinishes(rows, 3).map((r) => r.deckId)).toEqual(["905658", "905646", "906137"]);
  });

  it("finds the archetype a player means", () => {
    const list = [
      { id: "1", name: "Rakdos Aggro", share: 15 },
      { id: "2", name: "Boros Aggro", share: 6 },
      { id: "3", name: "Kinnan, Bonder Prodigy", share: 10 },
    ];
    expect(findArchetype(list, "rakdos aggro")?.id).toBe("1");
    expect(findArchetype(list, "Kinnan")?.id).toBe("3");
    expect(findArchetype(list, "boros energy aggro")?.id).toBe("2");
    expect(findArchetype(list, "")).toBeNull();
    expect(findArchetype(list, "elves")).toBeNull();
  });
});

describe("fetching MTGTop8", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads the format page for its periods, then the two-month metagame, and keeps both", async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      const body = url.includes("meta=51") ? FORMAT_PAGE : PERIODS;
      return new Response(new TextEncoder().encode(body), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const got = await fetchMetagame("modern");
    expect(got?.period.label).toBe("Last 2 Months");
    expect(got?.meta.archetypes[0]?.name).toBe("Amulet Titan");
    expect(got?.url).toBe("https://mtgtop8.com/format?f=MO&meta=51");
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(["https://mtgtop8.com/format?f=MO", "https://mtgtop8.com/format?f=MO&meta=51"]);
    // Said with our name.
    expect(fetchMock.mock.calls[0]![1]?.headers).toMatchObject({ "User-Agent": expect.stringContaining("Spellpool") });
    // Asked again: from memory.
    await fetchMetagame("modern");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns null for a format it doesn't cover, and on a failed page", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
    expect(await fetchMetagame("commander")).toBeNull();
    expect(await fetchArchetypeDecks("legacy", "1", "2")).toBeNull();
  });

  it("takes a plain-text decklist, and nothing that isn't one", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(url.includes("d=1") ? "4 Lightning Bolt\nSideboard\n2 Blood Moon\n" : "<html>Not found</html>")));
    expect(await fetchDecklist("1")).toBe("4 Lightning Bolt\nSideboard\n2 Blood Moon");
    expect(await fetchDecklist("2")).toBeNull();
  });
});
