"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Logo from "@/components/Logo";
import { getIdentityTheme, getIdentityField } from "@/lib/identity-theme";

const theme = getIdentityTheme("U");
const field = getIdentityField("U");

interface Summary {
  totals: Record<string, number>;
  series: ({ day: string } & Record<string, number>)[];
  users: number;
  decks: number;
  types: string[];
}

const LABELS: Record<string, string> = {
  visit: "Visits",
  signup: "Signups",
  login: "Logins",
  deck_created: "Decks created",
  deck_viewed: "Deck views",
  ai_message: "AI messages",
  card_search: "Card searches",
};

export default function AdminPage() {
  const [data, setData] = useState<Summary | null>(null);
  const [status, setStatus] = useState<"loading" | "forbidden" | "ok" | "error">("loading");
  const [metric, setMetric] = useState("visit");

  useEffect(() => {
    fetch("/api/analytics/summary")
      .then((r) => {
        if (r.status === 403) {
          setStatus("forbidden");
          return null;
        }
        if (!r.ok) {
          setStatus("error");
          return null;
        }
        return r.json();
      })
      .then((d) => {
        if (d) {
          setData(d);
          setStatus("ok");
        }
      })
      .catch(() => setStatus("error"));
  }, []);

  return (
    <main style={{ flex: 1, minHeight: "100dvh", ...theme.vars, background: `radial-gradient(120% 80% at 78% -10%, ${field.bg}, ${field.deep} 78%)`, color: "#fff" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px clamp(20px,4vw,52px)" }}>
        <Link href="/" aria-label="Spellpool home" style={{ textDecoration: "none" }}>
          <Logo size={19} />
        </Link>
        <span className="id-mono" style={{ fontSize: 12.5, color: "var(--w-3)" }}>Analytics</span>
      </header>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "clamp(16px,3vw,32px) clamp(20px,4vw,52px) 80px" }}>
        <div className="id-label" style={{ color: "var(--w-3)", marginBottom: 12 }}>Dashboard</div>
        <h1 className="id-display" style={{ fontSize: "clamp(36px,6vw,64px)", margin: "0 0 8px", color: "var(--w-1)" }}>How Spellpool is doing</h1>
        <p style={{ fontSize: 14.5, color: "var(--w-2)", margin: "0 0 32px", maxWidth: 560, lineHeight: 1.5 }}>
          First-party, privacy-respecting counts — no cookies, IPs, or personal data, just totals of what happened.
        </p>

        {status === "loading" && <p style={{ color: "var(--w-3)" }}>Loading…</p>}
        {status === "forbidden" && (
          <div className="id-panel" style={{ padding: 22, maxWidth: 520 }}>
            <div className="id-display" style={{ fontSize: 22, marginBottom: 6, color: "var(--w-1)" }}>Not authorized</div>
            <p style={{ fontSize: 14, color: "var(--w-2)", margin: 0, lineHeight: 1.5 }}>
              Sign in with the admin account, and make sure <code>ANALYTICS_ADMIN_EMAIL</code> is set to that email in the
              environment.
            </p>
          </div>
        )}
        {status === "error" && <p style={{ color: "var(--danger)" }}>Couldn&apos;t load analytics.</p>}

        {status === "ok" && data && (
          <>
            {/* headline stats */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 14, marginBottom: 36 }}>
              <Stat label="Total users" value={data.users} accent />
              <Stat label="Total decks" value={data.decks} accent />
              <Stat label="Visits" value={data.totals.visit ?? 0} />
              <Stat label="Signups" value={data.totals.signup ?? 0} />
              <Stat label="Decks created" value={data.totals.deck_created ?? 0} />
              <Stat label="AI messages" value={data.totals.ai_message ?? 0} />
            </div>

            {/* 30-day chart */}
            <div className="id-panel" style={{ padding: "20px clamp(14px,2vw,24px)", marginBottom: 30 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
                <span className="id-display" style={{ fontSize: 22, color: "var(--w-1)" }}>Last 30 days</span>
                <div className="id-seg">
                  {data.types.map((t) => (
                    <button key={t} type="button" data-on={metric === t} onClick={() => setMetric(t)}>
                      {LABELS[t] ?? t}
                    </button>
                  ))}
                </div>
              </div>
              <DayChart series={data.series} metric={metric} />
            </div>

            {/* all-time totals */}
            <div className="id-label" style={{ color: "var(--w-3)", marginBottom: 14 }}>All-time totals</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 14 }}>
              {data.types.map((t) => (
                <Stat key={t} label={LABELS[t] ?? t} value={data.totals[t] ?? 0} />
              ))}
            </div>
          </>
        )}
      </div>
    </main>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="id-panel" style={{ padding: "16px 18px" }}>
      <div className="id-mono" style={{ fontSize: 30, fontWeight: 700, color: accent ? "var(--gold)" : "var(--w-1)", lineHeight: 1 }}>
        {value.toLocaleString()}
      </div>
      <div className="id-label" style={{ marginTop: 8, color: "var(--w-3)" }}>{label}</div>
    </div>
  );
}

function DayChart({ series, metric }: { series: ({ day: string } & Record<string, number>)[]; metric: string }) {
  const max = Math.max(1, ...series.map((d) => d[metric] ?? 0));
  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 140 }}>
        {series.map((d) => {
          const v = d[metric] ?? 0;
          return (
            <div key={d.day} title={`${d.day}: ${v}`} style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", height: "100%" }}>
              <div
                style={{
                  height: `${(v / max) * 100}%`,
                  minHeight: v ? 3 : 0,
                  background: "var(--gold)",
                  borderRadius: 3,
                  transition: "height .4s cubic-bezier(.2,.8,.2,1)",
                }}
              />
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 11, color: "var(--w-3)", fontFamily: "var(--font-mono)" }}>
        <span>{series[0]?.day.slice(5)}</span>
        <span>{series[series.length - 1]?.day.slice(5)}</span>
      </div>
    </div>
  );
}
