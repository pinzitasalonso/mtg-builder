import type { Metadata } from "next";
import Link from "next/link";
import Logo from "@/components/Logo";

export const metadata: Metadata = {
  title: "Privacy Policy — Spellpool",
  description: "What Spellpool stores, why, and how to remove it.",
};

// Plain reading page: the legal text every store listing points at. Static,
// server-rendered, styled through the same tokens as the rest of the site.
const H2: React.CSSProperties = { fontFamily: "var(--font-display)", fontSize: 26, margin: "34px 0 10px", color: "var(--t1)" };
const P: React.CSSProperties = { margin: "0 0 14px", lineHeight: 1.65, color: "var(--t2)", fontSize: 15.5 };

export default function PrivacyPage() {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "28px 20px 80px" }}>
      <Link href="/" style={{ textDecoration: "none" }}><Logo size={18} /></Link>
      <h1 className="id-display" style={{ fontSize: "clamp(34px,6vw,52px)", margin: "26px 0 4px", color: "var(--t1)" }}>
        Privacy Policy
      </h1>
      <p style={{ ...P, color: "var(--t3)" }}>Last updated July 17, 2026 · Applies to spellpool.com and the Spellpool iOS app.</p>

      <h2 style={H2}>The short version</h2>
      <p style={P}>
        Spellpool stores the things you make — decks, card pools, your owned-card collection, and game
        records — plus the email address you sign up with. There are no ads, no data sales, and no
        cross-site tracking. You can delete everything by deleting your account.
      </p>

      <h2 style={H2}>What we store</h2>
      <p style={P}>
        <b>Account.</b>{" "}Your email address and a salted, one-way hash of your password (we never store
        the password itself). Sessions are kept with a single first-party cookie.
      </p>
      <p style={P}>
        <b>Your content.</b>{" "}Decks, pools, notes, your collection, and win/loss records you log. Signed-out
        visitors on the web can build public decks, which aren&apos;t tied to an identity.
      </p>
      <p style={P}>
        <b>Usage counters.</b>{" "}Anonymous daily event counts (e.g. how many decks were created). They
        contain no identifiers and can&apos;t be traced back to you.
      </p>

      <h2 style={H2}>AI features</h2>
      <p style={P}>
        When you use the deck assistant or AI search, your question and relevant deck/collection card
        names are sent to Anthropic (our AI provider) to generate the answer, and to public deck-data
        services (EDHREC, Reddit, Moxfield, Commander Spellbook) to ground it. These requests carry no
        account identifiers. Anthropic does not train models on this API data.
      </p>

      <h2 style={H2}>Card data</h2>
      <p style={P}>
        Card names, images, and prices come from Scryfall. Your device fetches card images directly from
        Scryfall&apos;s CDN.
      </p>

      <h2 style={H2}>Purchases</h2>
      <p style={P}>
        Pro subscriptions are bought through Apple&apos;s App Store; Apple handles all payment details — your
        card number never reaches us. We use RevenueCat to know whether a subscription is active: it
        receives your Spellpool account id and purchase state, nothing more.
      </p>

      <h2 style={H2}>What we don&apos;t do</h2>
      <p style={P}>
        No advertising, no selling or sharing of personal data, no third-party analytics or tracking
        SDKs, no location data, no contacts access.
      </p>

      <h2 style={H2}>Deleting your data</h2>
      <p style={P}>
        Deleting your account removes your email, decks, collection, records, and sessions from our
        servers. Email <a href="mailto:pinzitasalonso@gmail.com" style={{ color: "var(--gold)" }}>pinzitasalonso@gmail.com</a>{" "}and
        we&apos;ll remove your account and its data promptly.
      </p>

      <h2 style={H2}>Contact</h2>
      <p style={P}>
        Questions about this policy: <a href="mailto:pinzitasalonso@gmail.com" style={{ color: "var(--gold)" }}>pinzitasalonso@gmail.com</a>.
      </p>

      <p style={{ ...P, marginTop: 30, color: "var(--t3)", fontSize: 13.5 }}>
        Spellpool is unofficial Fan Content permitted under the Wizards of the Coast Fan Content Policy.
        Magic: The Gathering and its card names and images are property of Wizards of the Coast LLC.
        Spellpool is not produced by or endorsed by Wizards of the Coast.
      </p>
    </main>
  );
}
