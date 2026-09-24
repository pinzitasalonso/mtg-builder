import type { Metadata, Viewport } from "next";
import { SITE_DESCRIPTION, SITE_URL } from "@/lib/landing";
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
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Spellpool — AI Magic: The Gathering deck builder for Commander",
    // Pages that set a title read "Kaito, Bane of Nightmares · Spellpool".
    template: "%s · Spellpool",
  },
  description: SITE_DESCRIPTION,
  applicationName: "Spellpool",
  keywords: [
    "MTG deck builder",
    "Commander deck builder",
    "EDH deck builder",
    "AI deck builder",
    "Magic: The Gathering",
    "Commander brackets",
    "deck score",
    "MTG combos",
    "MTG collection tracker",
    "playtest MTG deck",
  ],
  // No canonical here: set in the root layout it would be inherited by every
  // page, marking them all as copies of the home page.
  robots: { index: true, follow: true },
  openGraph: {
    title: "Spellpool — AI Magic: The Gathering deck builder",
    description: SITE_DESCRIPTION,
    url: "/",
    siteName: "Spellpool",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "Spellpool — AI Magic: The Gathering deck builder",
    description: SITE_DESCRIPTION,
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
