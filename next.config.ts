import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "cards.scryfall.io",
      },
      {
        protocol: "https",
        hostname: "*.scryfall.io",
      },
      {
        protocol: "https",
        hostname: "gatherer.wizards.com",
      },
    ],
  },
};

export default nextConfig;
