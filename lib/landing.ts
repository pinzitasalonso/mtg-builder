// The public landing page's content, kept here so the visible page and its
// structured data (JSON-LD) say the same thing — search engines penalise FAQ
// markup that doesn't match what's on the page.

import { FREE_AI_PER_DAY, FREE_DECK_LIMIT, FREE_SCANS_PER_DAY } from "./limits";

export const SITE_URL = "https://www.spellpool.com";
export const SITE_DESCRIPTION =
  "Spellpool is an AI Magic: The Gathering deck builder for Commander and constructed. Describe a deck and " +
  "get a legal build, then score it with Deck Score and brackets, find its combos, playtest it, track your " +
  "collection, and ask an assistant that reads all your decks at once.";

export interface LandingFeature {
  /** A lucide icon name, mapped to the component on the page. */
  icon: "sparkles" | "gauge" | "link" | "library" | "dices" | "history" | "cart" | "phone";
  // (No mention of the iPhone app, or of the AI model by name, until the app
  // ships — the web on a phone is the mobile story for now.)
  title: string;
  body: string;
}

export const LANDING_FEATURES: LandingFeature[] = [
  {
    icon: "sparkles",
    title: "An assistant for every deck",
    body:
      "Ask across all your decks and your collection at once: which is strongest, what to build next, what to buy. " +
      "It can build a new deck or edit one, saving a version first.",
  },
  {
    icon: "gauge",
    title: "Deck Score and brackets",
    body:
      "Speed, consistency, interaction and resilience on DeckCheck's published scale, the Commander bracket it " +
      "really plays at, and a written analysis of how it wins.",
  },
  {
    icon: "link",
    title: "Combos, found for you",
    body: "Every combo your list can assemble, from Commander Spellbook, with the pieces, what it makes and how it goes off.",
  },
  {
    icon: "library",
    title: "Your collection, imported",
    body:
      "Upload a CSV from ManaBox, Moxfield, Deckbox, TCGplayer or Archidekt. It keeps the exact printings you own, " +
      "prices them, and marks owned cards in every deck.",
  },
  {
    icon: "dices",
    title: "Playtest with a battlefield",
    body: "Draw opening hands, mulligan, play lands and spells onto a table, and see the odds of hitting what you need.",
  },
  {
    icon: "history",
    title: "Versions",
    body: "Save a deck before a big change, see what changed since, card by card, and restore it when a swap doesn't work out.",
  },
  {
    icon: "cart",
    title: "Prices and a buy list",
    body: "What the deck costs, what you already own, and a list of what's missing, ready to order.",
  },
  {
    icon: "phone",
    title: "On your phone, too",
    body: "Spellpool works in your phone's browser. Add it to your home screen and your decks, collection and assistant come with you.",
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
      "Spellpool is a Magic: The Gathering deck builder with an AI assistant. You describe the deck you want — a " +
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
      `Yes. The free plan holds ${FREE_DECK_LIMIT} decks, with ${FREE_AI_PER_DAY} AI questions and ${FREE_SCANS_PER_DAY} deck scan a day. Spellpool Pro, with no limits, is coming soon.`,
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
