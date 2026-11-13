import type { NextConfig } from "next";

// Security headers applied to every response. Deliberately conservative so
// they can't break the app:
//  - HSTS pins HTTPS (Railway always serves TLS). No includeSubDomains: it's
//    asserted only for the host that served the header.
//  - The CSP sets ONLY frame-ancestors/object-src/base-uri. It intentionally
//    omits default-src/script-src/style-src, so the app's inline styles and
//    Next's hydration scripts keep working while we still block framing,
//    plugins, and <base> injection. Tighten toward a full CSP later behind a
//    nonce if desired.
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'" },
];

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
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // The bare domain reaches the app too (an ALIAS to Railway, like www's
  // CNAME). Everything is sent on to www, which is the site's one address:
  // APP_URL, the Google sign-in return address, and the session cookie
  // (a host-only cookie, so a sign-in on one host isn't seen by the other).
  // 308 keeps the method, so an API POST to the bare domain still works.
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "spellpool.com" }],
        destination: "https://www.spellpool.com/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
