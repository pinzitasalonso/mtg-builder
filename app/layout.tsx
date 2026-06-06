import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MTG Deck Builder",
  description: "Magic: The Gathering deck builder powered by Claude + Scryfall",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
