import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, EB_Garamond, Cormorant_SC } from "next/font/google";
import Link from "next/link";
import Logo from "@/components/Logo";
import "./globals.css";

const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
  variable: "--font-cormorant",
  display: "swap",
});

const ebGaramond = EB_Garamond({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  variable: "--font-ebgaramond",
  display: "swap",
});

const cormorantSC = Cormorant_SC({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-cormorant-sc",
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
  themeColor: "#14100a",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`h-full ${cormorant.variable} ${ebGaramond.variable} ${cormorantSC.variable}`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <footer
          style={{
            marginTop: "auto",
            borderTop: "1px solid var(--line)",
            padding: "22px 20px",
          }}
        >
          <div
            style={{
              maxWidth: 1160,
              margin: "0 auto",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <Link href="/" aria-label="Spellpool home" style={{ textDecoration: "none" }}>
              <Logo size={19} />
            </Link>
            <span style={{ fontSize: 14, fontStyle: "italic", color: "var(--text-dim)" }}>
              Powered by Claude + Scryfall
            </span>
          </div>
        </footer>
      </body>
    </html>
  );
}
