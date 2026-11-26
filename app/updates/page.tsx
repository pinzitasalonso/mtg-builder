import type { Metadata } from "next";
import Link from "next/link";
import Logo from "@/components/Logo";
import { UPDATES, byArea, weekLabel } from "@/lib/updates";

export const metadata: Metadata = {
  title: "What's new",
  description: "What changed on Spellpool, week by week: new tools for your decks, a sharper practice opponent, and everything that got better.",
  alternates: { canonical: "/updates" },
};

// The public log: what changed, week by week, in a few lines each
// (lib/updates.ts). A plain reading page like /terms, linked from the home
// footer. Each week is a date, a title and its lines under the part of the
// app they're about.
export default function UpdatesPage() {
  return (
    <main className="up">
      <Link href="/" style={{ textDecoration: "none" }}>
        <Logo size={18} />
      </Link>
      <header className="up-head">
        <h1 className="id-display">What&apos;s new</h1>
        <p>What changed on Spellpool, week by week.</p>
      </header>
      {UPDATES.map((u) => (
        <section key={u.week} className="up-week" aria-labelledby={`w-${u.week}`}>
          <div className="id-label up-date">
            <time dateTime={u.week}>{weekLabel(u.week)}</time>
          </div>
          <h2 id={`w-${u.week}`} className="up-title">
            {u.title}
          </h2>
          <dl className="up-items">
            {byArea(u.items).map((g) => (
              <div key={g.area} className="up-row">
                <dt>{g.area}</dt>
                <dd>
                  {g.texts.map((t) => (
                    <p key={t}>{t}</p>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
      <p className="up-foot">
        Something you&apos;d like to see here? <a href="mailto:pinzitasalonso@gmail.com">Tell us</a>.
      </p>
    </main>
  );
}
