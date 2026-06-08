import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Spellpool — MTG Deck Builder",
  description:
    "Spellpool — build and brew Magic: The Gathering decks, powered by Claude + Scryfall.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
