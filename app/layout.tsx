import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Inter } from "next/font/google";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";
import "./globals.css";

// Inter, for body AND headlines — the face the designs are drawn in and the
// only one the iOS app uses now.
//
// It replaces two: Hanken Grotesk for UI, and Vadstenakursive for display. The
// blackletter is retired rather than kept for the pages that hadn't been
// redrawn, which is the same call the app made — two display faces mid-migration
// is worse than either on its own. The .otf is still in app/fonts, so bringing
// it back is this block and the --font-display line in globals.css.
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-inter",
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
  // The app's two grounds, so the browser chrome matches the page it frames.
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0c0c0c" },
    { media: "(prefers-color-scheme: light)", color: "#f7f6f3" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`h-full ${inter.variable} ${plexMono.variable}`}>
      <body className="min-h-full flex flex-col">
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
