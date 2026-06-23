import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Spellpool — MTG Deck Builder",
    short_name: "Spellpool",
    description: "Build and brew your Magic: The Gathering decks.",
    start_url: "/",
    display: "standalone",
    background_color: "#0e0b18",
    theme_color: "#0e0b18",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
      {
        src: "/apple-icon",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  };
}
