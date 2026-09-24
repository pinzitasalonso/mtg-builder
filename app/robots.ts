import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/landing";

// Crawlers get the public pages: the landing page, public and shared decks,
// the legal pages. The API, admin and account flows are nothing to index.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/admin", "/reset", "/login"] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
