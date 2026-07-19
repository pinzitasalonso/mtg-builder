import type { Metadata } from "next";
import Link from "next/link";
import Logo from "@/components/Logo";

export const metadata: Metadata = {
  title: "Terms of Use — Spellpool",
  description: "The terms for using Spellpool and the Spellpool Pro subscription.",
};

const H2: React.CSSProperties = { fontFamily: "var(--font-display)", fontSize: 26, margin: "34px 0 10px", color: "var(--t1)" };
const P: React.CSSProperties = { margin: "0 0 14px", lineHeight: 1.65, color: "var(--t2)", fontSize: 15.5 };

export default function TermsPage() {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "28px 20px 80px" }}>
      <Link href="/" style={{ textDecoration: "none" }}><Logo size={18} /></Link>
      <h1 className="id-display" style={{ fontSize: "clamp(34px,6vw,52px)", margin: "26px 0 4px", color: "var(--t1)" }}>
        Terms of Use
      </h1>
      <p style={{ ...P, color: "var(--t3)" }}>Last updated July 17, 2026 · Applies to spellpool.com and the Spellpool iOS app.</p>

      <h2 style={H2}>The service</h2>
      <p style={P}>
        Spellpool is a Magic: The Gathering deck-building companion: build decks, browse your
        collection, playtest, track games, and get AI-assisted suggestions. Use it for personal,
        non-commercial deckbuilding. Don&apos;t abuse the service — no scraping at scale, no attempting to
        break other people&apos;s accounts, no using the AI features to generate unrelated content.
      </p>

      <h2 style={H2}>Your account and content</h2>
      <p style={P}>
        You&apos;re responsible for your account credentials. Your decks and collection are yours; you give
        us permission to store and display them so the service works. Public decks are visible to (and
        editable by) anyone with the link, by design.
      </p>

      <h2 style={H2}>Spellpool Pro (auto-renewing subscription)</h2>
      <p style={P}>
        Spellpool Pro lifts the free plan&apos;s limits (synced decks and daily AI asks). It&apos;s an
        auto-renewable subscription purchased through your Apple ID. Payment is charged to your Apple ID
        at confirmation of purchase at the price shown; the subscription renews automatically unless
        cancelled at least 24 hours before the end of the current period. Manage or cancel any time in
        your Apple ID subscription settings. Cancelling stops future charges; access continues to the end
        of the paid period. Refunds are handled by Apple under their standard terms.
      </p>

      <h2 style={H2}>AI answers</h2>
      <p style={P}>
        The deck assistant is a tool, not an oracle: suggestions can be wrong, and card legality or
        pricing shown in the app may lag reality. Verify anything that matters (tournament legality,
        purchase prices) against official sources.
      </p>

      <h2 style={H2}>Warranty and liability</h2>
      <p style={P}>
        Spellpool is provided &quot;as is&quot;, without warranties of any kind. To the extent permitted by law,
        we&apos;re not liable for lost decks, missed games, or any indirect damages arising from using the
        service. We may change or discontinue features; if we ever discontinue the service, we&apos;ll give
        reasonable notice so you can export your decks.
      </p>

      <h2 style={H2}>Fan content</h2>
      <p style={P}>
        Spellpool is unofficial Fan Content permitted under the Wizards of the Coast Fan Content Policy.
        Portions of the materials used are property of Wizards of the Coast LLC. Spellpool is not
        produced by, affiliated with, or endorsed by Wizards of the Coast. Card data and imagery are
        provided by Scryfall, which is likewise unaffiliated.
      </p>

      <h2 style={H2}>Contact</h2>
      <p style={P}>
        Questions about these terms: <a href="mailto:pinzitasalonso@gmail.com" style={{ color: "var(--gold)" }}>pinzitasalonso@gmail.com</a>.
        See also the <Link href="/privacy" style={{ color: "var(--gold)" }}>Privacy Policy</Link>.
      </p>
    </main>
  );
}
