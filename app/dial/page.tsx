import type { Metadata } from "next";
import Link from "next/link";
import Logo from "@/components/Logo";
import DialsPanel from "@/components/DialsPanel";
import SignInLink from "@/components/SignInLink";
import { currentUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Your dials",
  description: "Pair a Spellpool Dial and choose the decks it carries.",
  robots: { index: false },
};

// /dial — where a Spellpool Dial is paired (it shows a code; you type it
// here) and where you choose the decks it carries. ?send=<deck> comes from a
// deck page's "Send to dial".
export default async function DialPage({ searchParams }: { searchParams: Promise<{ send?: string; code?: string }> }) {
  const [user, { send, code }] = await Promise.all([currentUser(), searchParams]);
  const back = `/dial${send ? `?send=${encodeURIComponent(send)}` : code ? `?code=${encodeURIComponent(code)}` : ""}`;
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "28px 20px 80px", width: "100%" }}>
      <Link href="/" style={{ textDecoration: "none" }}><Logo size={18} /></Link>
      <h1 className="id-display" style={{ fontSize: "clamp(34px,6vw,52px)", margin: "26px 0 10px", color: "var(--t1)" }}>
        Your dials
      </h1>
      <p style={{ margin: "0 0 22px", color: "var(--t2)", fontSize: 15.5, lineHeight: 1.6 }}>
        A Spellpool Dial sits by your deck: it shows your commander and counts your life. Pair it here, then choose the decks it carries.
      </p>
      {user ? (
        <DialsPanel send={send ?? null} code={code ?? null} />
      ) : (
        <p style={{ color: "var(--t2)", fontSize: 15.5 }}>
          <SignInLink next={back as `/${string}`} />{" "}to pair a dial.
        </p>
      )}
    </main>
  );
}
