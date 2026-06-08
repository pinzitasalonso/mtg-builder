import type { Metadata, Viewport } from "next";
import { Hanken_Grotesk, Geist_Mono } from "next/font/google";
import Link from "next/link";
import Logo from "@/components/Logo";
import "./globals.css";

const hanken = Hanken_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-hanken",
  display: "swap",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-geist-mono",
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
  themeColor: "#111214",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`h-full ${hanken.variable} ${geistMono.variable}`}>
      <body className="min-h-full flex flex-col">
        {children}
        <footer
          style={{
            marginTop: "auto",
            borderTop: "1px solid var(--border)",
            padding: "22px 16px",
          }}
        >
          <div
            style={{
              maxWidth: 1080,
              margin: "0 auto",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <Link href="/" aria-label="Spellpool home" style={{ textDecoration: "none" }}>
              <Logo size={20} />
            </Link>
            <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
              Powered by Claude + Scryfall
            </span>
          </div>
        </footer>
      </body>
    </html>
  );
}
