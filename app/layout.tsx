import type { Metadata, Viewport } from "next";
import { Hanken_Grotesk, Bangers, IBM_Plex_Mono } from "next/font/google";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";
import "./globals.css";

const hanken = Hanken_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-hanken",
  display: "swap",
});

const bangers = Bangers({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-bangers",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plexmono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://www.spellpool.com"),
  title: "Spellpool — MTG Deck Builder",
  description:
    "Spellpool — build and brew Magic: The Gathering decks, powered by Claude + Scryfall.",
  applicationName: "Spellpool",
  openGraph: {
    title: "Spellpool",
    description: "Build and brew your Magic: The Gathering decks.",
    url: "/",
    siteName: "Spellpool",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Spellpool",
    description: "Build and brew your Magic: The Gathering decks.",
  },
};

export const viewport: Viewport = {
  themeColor: "#0e0b18",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`h-full ${hanken.variable} ${bangers.variable} ${plexMono.variable}`}>
      <body className="min-h-full flex flex-col">
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
