"use client";

import { useEffect, useMemo, useState } from "react";
import type { AccountRow, AdminSummary } from "@/lib/admin-stats";
import Link from "next/link";
import Logo from "@/components/Logo";
import { getIdentityTheme, getIdentityField } from "@/lib/identity-theme";

const theme = getIdentityTheme("U");
const field = getIdentityField("U");

interface Accounts {
  summary: AdminSummary;
  formats: { format: string; count: number }[];
  aiDays: { day: string; count: number }[];
  accounts: AccountRow[];
}

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
  deck_duplicated: "Decks copied",
  deck_viewed: "Deck views",
  ai_message: "AI messages",
  card_search: "Card searches",
};

export default function AdminPage() {
  const [data, setData] = useState<Summary | null>(null);
  const [status, setStatus] = useState<"loading" | "forbidden" | "ok" | "error">("loading");
  const [metric, setMetric] = useState("visit");
  const [acc, setAcc] = useState<Accounts | null>(null);

  useEffect(() => {
    fetch("/api/analytics/accounts")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setAcc(d))
      .catch(() => {});
  }, []);

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
          Who has signed up and what they do with it, from the database, plus first-party event counts (no cookies or
          IPs).
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
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 14, marginBottom: 30 }}>
              <Stat label="Accounts" value={data.users} accent />
              <Stat label="Active today" value={acc?.summary.active.d1} />
              <Stat label="Active 7 days" value={acc?.summary.active.d7} />
              <Stat label="Active 30 days" value={acc?.summary.active.d30} />
              <Stat label="Pro" value={acc?.summary.pro} />
              <Stat label="Decks" value={data.decks} />
            </div>

            {/* The assistant. Counted from its server-side thread, so from
                when it moved there; older chats weren't kept. */}
            <div className="id-label" style={{ color: "var(--w-3)", marginBottom: 12 }}>AI assistant · since 27 Sep</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 14, marginBottom: 30 }}>
              <Stat label="Questions, 7 days" value={acc?.summary.ai.last7d} accent />
              <Stat label="People asking, 7 days" value={acc?.summary.ai.askers7d} />
              <Stat label="Questions in all" value={acc?.summary.ai.total} />
              <Stat
                label="Each asker, 7 days"
                value={acc && acc.summary.ai.askers7d ? Math.round((acc.summary.ai.last7d / acc.summary.ai.askers7d) * 10) / 10 : undefined}
              />
            </div>

            {acc && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))", gap: 18, marginBottom: 30 }}>
                <Panel title="New accounts" note={`${sum(acc.summary.signups.map((d) => d.count))} in the last 30 days`}>
                  <DayBars series={acc.summary.signups.map((d) => ({ day: d.day, value: d.count }))} unit="new account" />
                </Panel>
                <Panel title="AI questions" note={`${sum(acc.aiDays.map((d) => d.count))} in the last 30 days`}>
                  <DayBars series={acc.aiDays.map((d) => ({ day: d.day, value: d.count }))} unit="question" />
                </Panel>
                <Panel title="How far people get" note="Accounts that reached each step">
                  <HBars rows={acc.summary.funnel.map((f) => ({ label: f.label, value: f.count }))} of={acc.summary.accounts} />
                </Panel>
                <Panel title="Deck formats" note={`${sum(acc.formats.map((f) => f.count))} decks in accounts`}>
                  <HBars rows={acc.formats.map((f) => ({ label: cap(f.format), value: f.count }))} />
                </Panel>
              </div>
            )}

            {/* 30-day events */}
            <div className="id-panel" style={{ padding: "20px clamp(14px,2vw,24px)", marginBottom: 30 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
                <span className="id-display" style={{ fontSize: 22, color: "var(--w-1)" }}>
                  Events, last 30 days
                  <span className="id-mono" style={{ display: "block", fontSize: 12.5, color: "var(--w-3)", marginTop: 6 }}>
                    {periodNote(data.series, metric)}
                  </span>
                </span>
                <div className="id-seg" style={{ maxWidth: "100%", overflowX: "auto" }}>
                  {data.types.map((t) => (
                    <button key={t} type="button" data-on={metric === t} onClick={() => setMetric(t)}>
                      {LABELS[t] ?? t}
                    </button>
                  ))}
                </div>
              </div>
              <DayBars series={data.series.map((d) => ({ day: d.day, value: d[metric] ?? 0 }))} unit={(LABELS[metric] ?? metric).toLowerCase()} />
            </div>

            {acc && <AccountsTable rows={acc.accounts} />}

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

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}
function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/* This fortnight against the one before, for the chosen event. */
function periodNote(series: ({ day: string } & Record<string, number>)[], metric: string): string {
  const v = series.map((d) => d[metric] ?? 0);
  const last = sum(v.slice(-14));
  const prev = sum(v.slice(-28, -14));
  const change = prev ? Math.round(((last - prev) / prev) * 100) : null;
  return `${last.toLocaleString()} in the last 14 days` + (change === null ? "" : ` · ${change >= 0 ? "+" : ""}${change}% on the 14 before`);
}

function Stat({ label, value, accent }: { label: string; value: number | undefined; accent?: boolean }) {
  return (
    <div className="id-panel" style={{ padding: "16px 18px" }}>
      <div className="id-mono" style={{ fontSize: 30, fontWeight: 700, color: accent ? "var(--gold)" : "var(--w-1)", lineHeight: 1 }}>
        {value === undefined ? "–" : value.toLocaleString()}
      </div>
      <div className="id-label" style={{ marginTop: 8, color: "var(--w-3)" }}>{label}</div>
    </div>
  );
}

function Panel({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="id-panel" style={{ padding: "18px clamp(14px,2vw,22px)" }}>
      <div className="id-display" style={{ fontSize: 20, color: "var(--w-1)" }}>{title}</div>
      {note && <div className="id-mono" style={{ fontSize: 12, color: "var(--w-3)", margin: "4px 0 14px" }}>{note}</div>}
      {children}
    </section>
  );
}

/* One bar per day, one series. Hover (or tap) a day for its value; the
   biggest day is labelled, and a faint line marks it. */
function DayBars({ series, unit }: { series: { day: string; value: number }[]; unit: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...series.map((d) => d.value));
  const peak = series.findIndex((d) => d.value === max && max > 0);
  const shown = hover ?? null;
  const fmt = (day: string) => new Date(day + "T00:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
  return (
    <div>
      <div style={{ height: 18, fontSize: 12.5, color: "var(--w-2)", marginBottom: 6 }}>
        {shown !== null ? (
          <>
            <b style={{ color: "var(--w-1)" }}>{series[shown].value.toLocaleString()}</b> {unit}
            {series[shown].value === 1 ? "" : "s"} · {fmt(series[shown].day)}
          </>
        ) : peak >= 0 ? (
          <>
            Busiest: <b style={{ color: "var(--w-1)" }}>{max.toLocaleString()}</b> on {fmt(series[peak].day)}
          </>
        ) : (
          "Nothing yet"
        )}
      </div>
      <div
        role="img"
        aria-label={`${unit} per day: ` + series.map((d) => `${d.day} ${d.value}`).join(", ")}
        onMouseLeave={() => setHover(null)}
        style={{ position: "relative", display: "flex", alignItems: "flex-end", gap: 2, height: 140, borderBottom: "1px solid var(--w-line)" }}
      >
        <div aria-hidden style={{ position: "absolute", left: 0, right: 0, top: 0, borderTop: "1px dashed var(--w-line)" }} />
        {series.map((d, i) => (
          <div
            key={d.day}
            onMouseEnter={() => setHover(i)}
            onClick={() => setHover(i)}
            style={{ flex: 1, height: "100%", display: "flex", alignItems: "flex-end", cursor: "default" }}
          >
            <div
              style={{
                width: "100%",
                height: `${(d.value / max) * 100}%`,
                minHeight: d.value ? 3 : 0,
                background: "var(--gold)",
                opacity: hover === null || hover === i ? 1 : 0.45,
                borderRadius: "4px 4px 0 0",
                transition: "height .4s cubic-bezier(.2,.8,.2,1), opacity .12s",
              }}
            />
          </div>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 11, color: "var(--w-3)", fontFamily: "var(--font-mono)" }}>
        <span>{fmt(series[0]?.day ?? "")}</span>
        <span>{fmt(series[series.length - 1]?.day ?? "")}</span>
      </div>
    </div>
  );
}

/* Labelled horizontal bars, one series. With `of`, each row also says what
   share of that total it is (the funnel). */
function HBars({ rows, of }: { rows: { label: string; value: number }[]; of?: number }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (rows.length === 0) return <div style={{ fontSize: 13, color: "var(--w-3)" }}>Nothing yet</div>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
      {rows.map((r) => (
        <div key={r.label} title={`${r.label}: ${r.value}`}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13, color: "var(--w-2)", marginBottom: 4 }}>
            <span>{r.label}</span>
            <span className="id-mono" style={{ color: "var(--w-1)" }}>
              {r.value.toLocaleString()}
              {of ? <span style={{ color: "var(--w-3)" }}> · {Math.round((r.value / Math.max(1, of)) * 100)}%</span> : null}
            </span>
          </div>
          <div style={{ height: 8, borderRadius: 4, background: "var(--w-line)" }}>
            <div style={{ width: `${(r.value / max) * 100}%`, minWidth: r.value ? 4 : 0, height: "100%", borderRadius: 4, background: "var(--gold)", transition: "width .4s cubic-bezier(.2,.8,.2,1)" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

type SortKey = "email" | "createdAt" | "lastActive" | "decks" | "cards" | "collection" | "aiQuestions" | "scans" | "games";
const COLS: { key: SortKey; label: string; num?: boolean }[] = [
  { key: "email", label: "Account" },
  { key: "createdAt", label: "Joined" },
  { key: "lastActive", label: "Last active" },
  { key: "decks", label: "Decks", num: true },
  { key: "cards", label: "Cards", num: true },
  { key: "collection", label: "Owned", num: true },
  { key: "aiQuestions", label: "AI questions", num: true },
  { key: "scans", label: "Scans", num: true },
  { key: "games", label: "Games", num: true },
];

function ago(iso: string): string {
  const d = (Date.now() - new Date(iso).getTime()) / 86_400_000;
  if (d < 1 / 24) return "just now";
  if (d < 1) return `${Math.floor(d * 24)}h ago`;
  if (d < 30) return `${Math.floor(d)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/* Every account and what it has done. Search by email; click a heading to sort. */
function AccountsTable({ rows }: { rows: AccountRow[] }) {
  const [q, setQ] = useState("");
  const [all, setAll] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "createdAt", desc: true });
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle ? rows.filter((r) => r.email.toLowerCase().includes(needle) || (r.name ?? "").toLowerCase().includes(needle)) : rows;
    const dir = sort.desc ? -1 : 1;
    return [...list].sort((a, b) => {
      const x = a[sort.key];
      const y = b[sort.key];
      return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y))) * dir;
    });
  }, [rows, q, sort]);
  const th: React.CSSProperties = { padding: "10px 10px", fontSize: 11.5, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--w-3)", whiteSpace: "nowrap", cursor: "pointer", userSelect: "none", borderBottom: "1px solid var(--w-line)" };
  const td: React.CSSProperties = { padding: "10px 10px", fontSize: 13.5, color: "var(--w-2)", borderBottom: "1px solid var(--w-line)", whiteSpace: "nowrap" };
  return (
    <section className="id-panel" style={{ padding: "18px clamp(14px,2vw,22px)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <div>
          <div className="id-display" style={{ fontSize: 22, color: "var(--w-1)" }}>Accounts</div>
          <div className="id-mono" style={{ fontSize: 12, color: "var(--w-3)", marginTop: 4 }}>
            {shown.length === rows.length ? `${rows.length} accounts` : `${shown.length} of ${rows.length}`} · AI questions since 27 Sep
          </div>
        </div>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search email"
          aria-label="Search accounts by email"
          style={{ padding: "9px 12px", borderRadius: 10, border: "1px solid var(--w-line)", background: "rgba(255,255,255,.08)", color: "var(--w-1)", fontSize: 16, minWidth: 220 }}
        />
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {COLS.map((c) => (
                <th
                  key={c.key}
                  onClick={() => setSort((s) => ({ key: c.key, desc: s.key === c.key ? !s.desc : c.key !== "email" }))}
                  aria-sort={sort.key === c.key ? (sort.desc ? "descending" : "ascending") : undefined}
                  style={{ ...th, textAlign: c.num ? "right" : "left", color: sort.key === c.key ? "var(--w-1)" : th.color }}
                >
                  {c.label}
                  {sort.key === c.key ? (sort.desc ? " ↓" : " ↑") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(all || q ? shown : shown.slice(0, 25)).map((r) => (
              <tr key={r.id}>
                <td style={td}>
                  <div style={{ color: "var(--w-1)", fontWeight: 600 }}>{r.email}</div>
                  <div style={{ display: "flex", gap: 6, marginTop: 4, fontSize: 11.5 }}>
                    {r.tier === "pro" && <span style={{ padding: "1px 7px", borderRadius: 999, background: "var(--gold)", color: "var(--accent-ink, #181228)", fontWeight: 700 }}>Pro</span>}
                    <span style={{ color: "var(--w-3)" }}>{r.signIn.join(" + ") || "—"}</span>
                    {!r.verified && <span style={{ color: "var(--w-3)" }}>· unverified</span>}
                  </div>
                </td>
                <td style={td} title={r.createdAt}>{ago(r.createdAt)}</td>
                <td style={td} title={r.lastActive}>{ago(r.lastActive)}</td>
                <td style={{ ...td, textAlign: "right" }} title={`${r.builtDecks} full · ${r.versions} saved versions`}>{r.decks}</td>
                <td style={{ ...td, textAlign: "right" }}>{r.cards.toLocaleString()}</td>
                <td style={{ ...td, textAlign: "right" }}>{r.collection.toLocaleString()}</td>
                <td style={{ ...td, textAlign: "right" }}>
                  <div style={{ color: r.aiQuestions ? "var(--w-1)" : undefined }}>{r.aiQuestions}</div>
                  {r.aiQuestions7d > 0 && <div style={{ fontSize: 11.5, color: "var(--w-3)" }}>{r.aiQuestions7d} this week</div>}
                </td>
                <td style={{ ...td, textAlign: "right" }}>{r.scans}</td>
                <td style={{ ...td, textAlign: "right" }}>{r.games}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!all && !q && shown.length > 25 && (
        <button type="button" onClick={() => setAll(true)} className="id-ghost" style={{ marginTop: 14, padding: "8px 14px", fontSize: 13 }}>
          Show all {shown.length}
        </button>
      )}
    </section>
  );
}
