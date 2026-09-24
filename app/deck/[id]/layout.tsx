import type { Metadata } from "next";
import { deckDescription, formatName, publicDeckSummary } from "@/lib/deck-meta";

// The deck page is a client component, so its <head> comes from here. A deck
// anyone can open gets a real title, description and canonical URL; anything
// else (a private deck, a wrong id) gets a plain title and noindex, and its
// name is never read out.
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const deck = await publicDeckSummary(id);
  if (!deck) return { title: "Deck", robots: { index: false, follow: false } };
  const title = deck.commander && deck.commander !== deck.name ? `${deck.name} — ${deck.commander}` : `${deck.name} — ${formatName(deck.format)} deck`;
  const description = deckDescription(deck);
  return {
    title,
    description,
    alternates: { canonical: `/deck/${deck.publicId}` },
    openGraph: { title, description, url: `/deck/${deck.publicId}`, type: "article", siteName: "Spellpool" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default function DeckLayout({ children }: { children: React.ReactNode }) {
  return children;
}
