// The public landing page's content, kept here so the visible page and its
// structured data (JSON-LD) say the same thing — search engines penalise FAQ
// markup that doesn't match what's on the page.

import { FREE_AI_PER_DAY, FREE_SCANS_PER_DAY } from "./limits";

export const SITE_URL = "https://www.spellpool.com";
export const SITE_DESCRIPTION =
  "Spellpool is a Magic: The Gathering deck builder and coach for Commander and constructed. Describe a deck and " +
  "get a legal build, then score it with Deck Score and brackets, find its combos, playtest it, track your " +
  "collection, and ask a coach that reads all your decks at once.";

export interface LandingFeature {
  /** Which picture the tile shows (components/LandingVisual.tsx). */
  visual: "coach" | "score" | "combos" | "versions" | "playtest" | "buy" | "collection" | "phone";
  // (No mention of the iPhone app, or of the model by name, until the app
  // ships — the web on a phone is the mobile story for now.)
  title: string;
  /** One sentence: the picture beside it does the rest. */
  body: string;
}

// In the order the grid lays them out: the coach is the large tile, and no
// two tiles side by side show the same kind of picture.
export const LANDING_FEATURES: LandingFeature[] = [
  {
    visual: "coach",
    title: "A coach for every deck",
    body: "Ask about one deck or all of them at once. It can make the changes for you, and it saves a version first.",
  },
  {
    visual: "score",
    title: "Deck Score and brackets",
    body: "Speed, consistency, interaction and resilience out of 10, and the Commander bracket the deck really plays at.",
  },
  {
    visual: "combos",
    title: "Combos, found for you",
    body: "Every combo your list can assemble, with its pieces and what it makes.",
  },
  {
    visual: "versions",
    title: "Versions",
    body: "Save a deck before a big change, see what changed since, and go back when a swap doesn't work out.",
  },
  {
    visual: "playtest",
    title: "Playtest and practice matches",
    body: "Draw opening hands on a table, or play a match against a real deck.",
  },
  {
    visual: "buy",
    title: "Prices and a buy list",
    body: "What the deck costs, what you already own, and what is left to buy.",
  },
  {
    visual: "collection",
    title: "Your collection, imported",
    body: "Bring a CSV from ManaBox, Moxfield, Deckbox, TCGplayer or Archidekt. Every deck marks the cards you own.",
  },
  {
    visual: "phone",
    title: "On your phone, too",
    body: "Spellpool works in your phone's browser. Add it to your home screen and your decks come with you.",
  },
];

export interface FaqItem {
  q: string;
  a: string;
}

export const LANDING_FAQ: FaqItem[] = [
  {
    q: "What is Spellpool?",
    a:
      "Spellpool is a Magic: The Gathering deck builder with a built-in coach. You describe the deck you want — a " +
      "commander, a theme, a combo — and it suggests real cards from their rules text, builds to a legal list, " +
      "and helps you tune it with scores, combos and playtesting.",
  },
  {
    q: "Which formats does it support?",
    a:
      "Commander (EDH) first, with color identity, singleton and 100-card checks built in. Standard, Pioneer, " +
      "Modern, Legacy, Pauper and other 60-card formats work too.",
  },
  {
    q: "Is Spellpool free?",
    a:
      // One template literal on purpose: the production minifier folded two
      // concatenated templates here into "with 41 deck scan a day", dropping
      // the words between the constants.
      `Yes. The free plan has as many decks as you like, with ${FREE_AI_PER_DAY} coach question${FREE_AI_PER_DAY === 1 ? "" : "s"} and ${FREE_SCANS_PER_DAY} deck scan${FREE_SCANS_PER_DAY === 1 ? "" : "s"} a day. Spellpool Pro removes the daily limits.`,
  },
  {
    q: "How does the Deck Score work?",
    a:
      "It rates a deck from 0 to 10 on speed, consistency, interaction and resilience, using DeckCheck's published " +
      "rubric. Speed comes from simulated opening hands. It also reports the Commander bracket the deck plays at, " +
      "which can be higher than its Game Changer count suggests.",
  },
  {
    q: "Can I import my collection?",
    a:
      "Yes. Paste a list or upload a CSV export from ManaBox, Moxfield, Deckbox, TCGplayer, Archidekt, Dragon Shield " +
      "or Delver Lens. Spellpool keeps the exact printings you own and shows which cards in each deck you already have.",
  },
  {
    q: "Where does the card data come from?",
    a:
      "Card text, images and prices come from Scryfall, and combos from Commander Spellbook.",
  },
];

/** The page's structured data: the app, and its FAQ. */
export function landingJsonLd(): object[] {
  return [
    {
      "@context": "https://schema.org",
      "@type": "WebApplication",
      name: "Spellpool",
      url: SITE_URL,
      description: SITE_DESCRIPTION,
      applicationCategory: "GameApplication",
      operatingSystem: "Web",
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      featureList: LANDING_FEATURES.map((f) => f.title),
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: LANDING_FAQ.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    },
  ];
}
