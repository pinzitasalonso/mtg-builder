// What's new: the public log of what changed on Spellpool, week by week
// (the /updates page, linked from the home footer). Written for players,
// not for us. The rules for an entry are in AGENTS.md ("What's new"), and
// lib/updates.test.ts checks the ones a test can.

/** The part of Spellpool a line is about. A short, fixed list: the page
    groups a week's lines under these. */
export type UpdateArea = "Practice matches" | "Playtest" | "Decks" | "Deck Score" | "Deck coach" | "Collection" | "Spellpool Pro" | "The site";

export interface UpdateItem {
  area: UpdateArea;
  /** One or two short sentences, in plain words. */
  text: string;
}

export interface Update {
  /** The Monday the week began (UTC), as YYYY-MM-DD. */
  week: string;
  /** The week in a few words. */
  title: string;
  items: UpdateItem[];
}

/** Newest first. A week with nothing worth telling has no entry. */
export const UPDATES: Update[] = [
  {
    week: "2026-11-23",
    title: "A sharper opponent, and a tidier table",
    items: [
      { area: "Practice matches", text: "Your opponent knows its deck's combos and goes for them. Fast combo decks play like it: rituals, tutors, Necropotence, Thassa's Oracle." },
      { area: "Practice matches", text: "The table is tidier. Your creatures sit together, with artifacts and enchantments after them, and \"Attack with all\" sends everyone in." },
      { area: "Playtest", text: "Solo or Match is one clear choice at the top. Equipment and Auras attach to your creatures, and your library opens in the order you'll draw it." },
      { area: "Deck Score", text: "The Stats tab leads with the Score, shows your combos as cards and gives you one game plan to read. Point at a card's name to see the card." },
      { area: "Decks", text: "Two new tools. Tokens lists everything your deck makes. Assemble can swap the cards you haven't found for ones in your collection that do the same job." },
      { area: "Spellpool Pro", text: "The free plan is 2 coach questions, 2 Deck Score scans and 2 practice matches a day, and home shows new players where to find each. Pro has no daily limit." },
      { area: "The site", text: "A new front page made of the app's own screens, and a home that opens straight on your decks." },
    ],
  },
  {
    week: "2026-11-16",
    title: "Storm, extra turns, and no missed wins",
    items: [{ area: "Practice matches", text: "Storm spells are copied and extra turns are taken. The opponent no longer misses a win it has on the table." }],
  },
  {
    week: "2026-11-09",
    title: "Practice matches grow up",
    items: [
      { area: "Practice matches", text: "A new opponent picker, with its own button on the deck page. Close the tab and pick the match up later. Each deck keeps its record, and a finished game can be reviewed." },
      { area: "Practice matches", text: "A basic opponent that's free to play as often as you like." },
      { area: "Practice matches", text: "The table plays many more cards by itself: wheels, Treasure makers, fast mana, planeswalkers. You choose whether to pay for Rhystic Study and Smothering Tithe." },
      { area: "Collection", text: "A Wishlist for the cards you want, next to your collection." },
      { area: "Decks", text: "Assemble deck: tick off the physical cards as you build, and see which of your other decks hold the ones you're missing." },
      { area: "Decks", text: "Free accounts can keep as many decks as they like." },
      { area: "Spellpool Pro", text: "Pro is available on the web, with a new pricing page." },
      { area: "The site", text: "A round of fixes for speed and safety: quicker collection loads, sturdier imports and sign-in." },
    ],
  },
  {
    week: "2026-11-02",
    title: "Answer its spells",
    items: [
      { area: "Practice matches", text: "You can answer the opponent's spells, and it can answer yours. It keeps instant removal for your biggest threat." },
      { area: "Practice matches", text: "Tokens, counters, and tutors that open a search of your library. Your mana is tapped for you when you cast." },
      { area: "Practice matches", text: "Commanders that play themselves: K'rrik, Kefka, Yuriko with ninjutsu, Winota, Vivi, Braids, Selvala, Inalla, Light-Paws, The Ur-Dragon and Kratos." },
    ],
  },
  {
    week: "2026-10-26",
    title: "Practice matches arrive",
    items: [
      { area: "Practice matches", text: "New: play your deck against an opponent with a real deck, turn by turn. Pick any commander at the bracket you want, or a recent tournament list." },
      { area: "Playtest", text: "On a phone the table is played sideways, like a game, with cards big enough to read." },
      { area: "Deck coach", text: "The coach can look up competitive metagames and winning lists." },
      { area: "Decks", text: "A card's page shows which of your decks hold it, and shared decks get a better preview image." },
    ],
  },
  {
    week: "2026-10-19",
    title: "Both sides of the card",
    items: [
      { area: "Decks", text: "Double-faced cards can be turned over everywhere: in the deck, in swipe review and in the playtest." },
      { area: "Decks", text: "A compact list view, and cards in A to Z order within each type." },
      { area: "Decks", text: "The search filters for rarity and mana value work again." },
      { area: "The site", text: "Decks need an account now, so a deck is always yours to come back to." },
    ],
  },
  {
    week: "2026-10-12",
    title: "The printings you own",
    items: [
      { area: "Collection", text: "A deck shows the printing of each card that you own. Pick another by hand and it stays." },
      { area: "Decks", text: "Import a decklist into a deck you already have, from Tools." },
      { area: "Decks", text: "A card sheet with every printing to choose from." },
    ],
  },
  {
    week: "2026-09-28",
    title: "The Score on every deck",
    items: [
      { area: "Deck Score", text: "The same list always gets the same Score, and the deck tiles on home show the bracket and the Score." },
      { area: "Decks", text: "Duplicate a deck without its pool, or as a copy of only the cards you're missing. An export can leave out what you own." },
      { area: "Deck coach", text: "\"Draft it for me\" writes a first primer for your deck." },
    ],
  },
  {
    week: "2026-09-21",
    title: "One coach for the whole app",
    items: [
      { area: "Deck coach", text: "One coach for every page. It sees all your decks and your collection, can create and edit decks, and stays open beside your work on a wide screen." },
      { area: "Collection", text: "Import your collection from a CSV export. Exact printings are kept, and a card's details have a version picker." },
      { area: "Decks", text: "Save versions of a deck, compare one with the current list, and restore it." },
      { area: "Decks", text: "Pin decks to the top, and add a whole pool to the deck in one click." },
      { area: "Deck Score", text: "Stats show the bracket your deck plays at, and its combos." },
      { area: "Playtest", text: "A full-screen table with a battlefield." },
      { area: "The site", text: "A new logo and mana symbols, and your decks open offline." },
    ],
  },
];

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "Week of 23 November 2026", from the week's Monday. */
export function weekLabel(week: string): string {
  const [y, m, d] = week.split("-").map(Number);
  return `Week of ${d} ${MONTHS[(m ?? 1) - 1]} ${y}`;
}

/** A week's lines under their areas, in the order the areas first appear. */
export function byArea(items: UpdateItem[]): { area: UpdateArea; texts: string[] }[] {
  const out: { area: UpdateArea; texts: string[] }[] = [];
  for (const item of items) {
    const group = out.find((g) => g.area === item.area);
    if (group) group.texts.push(item.text);
    else out.push({ area: item.area, texts: [item.text] });
  }
  return out;
}
