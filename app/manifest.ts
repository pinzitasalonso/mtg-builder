import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Spellpool — MTG Deck Builder",
    short_name: "Spellpool",
    description: "Build and brew your Magic: The Gathering decks.",
    start_url: "/",
    display: "standalone",
    background_color: "#0b092e", // the icon's navy, for the launch splash
    theme_color: "#0e0b18",
    // The home-screen icon: the rune-framed water drop, as PNGs (iOS and
    // Android both want raster sizes; the flat SVG mark stays the tab icon).
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
