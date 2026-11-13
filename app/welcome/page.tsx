import type { Metadata } from "next";
import Link from "next/link";
import Logo from "@/components/Logo";

export const metadata: Metadata = {
  title: "Welcome",
  robots: { index: false },
};

// Where checkout lands after a successful payment. It only says thanks:
// access is granted from Paddle's webhook, never from a visit to this page.
export default function WelcomePage() {
  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "28px 20px 80px", width: "100%" }}>
      <Link href="/" style={{ textDecoration: "none" }}><Logo size={18} /></Link>
      <h1 className="id-display" style={{ fontSize: "clamp(34px,6vw,52px)", margin: "26px 0 8px", color: "var(--t1)" }}>
        Welcome aboard
      </h1>
      <p style={{ color: "var(--t2)", fontSize: 16, lineHeight: 1.6, margin: "0 0 24px" }}>
        Your Spellpool Pro subscription is set up. Paddle is emailing your receipt, and Pro unlocks on your account within a minute.
      </p>
      <Link href="/" style={{ color: "var(--accent)", fontWeight: 600 }}>Go to your decks →</Link>
    </main>
  );
}
