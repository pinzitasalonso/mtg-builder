"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Download, RefreshCw } from "lucide-react";
import Logo from "@/components/Logo";
import { getIdentityTheme, getIdentityField } from "@/lib/identity-theme";
import type { AccountRow, AdminSummary } from "@/lib/admin-stats";

/* The admin dashboard: who signed up, what they do, and where they stop.
   Sections, top to bottom: the headline numbers, growth, how far people get,
   the AI assistant, every account, and the event counters. Gated to
   ANALYTICS_ADMIN_EMAIL by both API routes it reads. */

const theme = getIdentityTheme("U");
const field = getIdentityField("U");

interface Accounts {
  summary: AdminSummary;
  formats: { format: string; count: number }[];
  aiDays: { day: string; count: number }[];
  deckDays: { day: string; count: number }[];
  accounts: AccountRow[];
}

interface Events {
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

const SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "growth", label: "Growth" },
  { id: "journey", label: "Journey" },
  { id: "ai", label: "AI" },
  { id: "accounts", label: "Accounts" },
  { id: "events", label: "Events" },
];

export default function AdminPage() {
  const [events, setEvents] = useState<Events | null>(null);
  const [acc, setAcc] = useState<Accounts | null>(null);
  const [status, setStatus] = useState<"loading" | "forbidden" | "ok" | "error">("loading");
  const [updated, setUpdated] = useState<Date | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [e, a] = await Promise.all([fetch("/api/analytics/summary", { cache: "no-store" }), fetch("/api/analytics/accounts", { cache: "no-store" })]);
      if (e.status === 403 || a.status === 403) {
        setStatus("forbidden");
        return;
      }
      if (!e.ok || !a.ok) {
        setStatus((s) => (s === "ok" ? s : "error"));
        return;
      }
      setEvents(await e.json());
      setAcc(await a.json());
      setUpdated(new Date());
      setStatus("ok");
    } catch {
      setStatus((s) => (s === "ok" ? s : "error"));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main style={{ flex: 1, minHeight: "100dvh", ...theme.vars, background: `radial-gradient(120% 80% at 78% -10%, ${field.bg}, ${field.deep} 78%)`, color: "#fff" }}>
      {/* Sticky bar: home, the sections, when it was loaded, refresh. */}
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 10,
          display: "flex",
          alignItems: "center",
          gap: 16,
          padding: "12px clamp(16px,4vw,52px)",
          background: "rgba(20,16,70,.55)",
          backdropFilter: "blur(14px)",
          WebkitBackdropFilter: "blur(14px)",
          borderBottom: "1px solid var(--w-line)",
        }}
      >
        <Link href="/" aria-label="Spellpool home" style={{ textDecoration: "none", flex: "none" }}>
          <Logo size={18} />
        </Link>
        <nav aria-label="Sections" style={{ display: "flex", gap: 4, overflowX: "auto", flex: 1, minWidth: 0, scrollbarWidth: "none" }}>
          {SECTIONS.map((s) => (
            <a key={s.id} href={`#${s.id}`} className="admin-nav" style={{ padding: "6px 11px", borderRadius: 999, fontSize: 13, fontWeight: 600, color: "var(--w-2)", textDecoration: "none", whiteSpace: "nowrap" }}>
              {s.label}
            </a>
          ))}
        </nav>
        <button
          type="button"
          onClick={() => void load()}
          disabled={busy}
          title="Load the numbers again"
          style={{ flex: "none", display: "flex", alignItems: "center", gap: 7, padding: "7px 12px", borderRadius: 999, border: "1px solid var(--w-line)", background: "transparent", color: "var(--w-2)", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}
        >
          <RefreshCw size={13} strokeWidth={2.25} style={busy ? { animation: "spin 1s linear infinite" } : undefined} />
          <span className="admin-hide-sm">{updated ? `Updated ${updated.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}` : "Refresh"}</span>
        </button>
      </header>

      <div style={{ maxWidth: 1180, margin: "0 auto", padding: "clamp(22px,4vw,40px) clamp(16px,4vw,52px) 96px" }}>
        <div className="id-label" style={{ color: "var(--w-3)", marginBottom: 10 }}>Admin</div>
        <h1 className="id-display" style={{ fontSize: "clamp(32px,5vw,52px)", margin: "0 0 8px", color: "var(--w-1)" }}>How Spellpool is doing</h1>
        <p style={{ fontSize: 14.5, color: "var(--w-2)", margin: "0 0 30px", maxWidth: 620, lineHeight: 1.5 }}>
          Who signed up, what they do with it, and where they stop. From the database, plus first-party event counts (no cookies or IPs).
        </p>

        {status === "loading" && <p style={{ color: "var(--w-3)" }}>Loading…</p>}
        {status === "forbidden" && (
          <Card style={{ maxWidth: 520 }}>
            <div className="id-display" style={{ fontSize: 22, marginBottom: 6, color: "var(--w-1)" }}>Not authorized</div>
            <p style={{ fontSize: 14, color: "var(--w-2)", margin: 0, lineHeight: 1.5 }}>
              Sign in with the admin account, and make sure <code>ANALYTICS_ADMIN_EMAIL</code> is set to that email in the environment.
            </p>
          </Card>
        )}
        {status === "error" && <p style={{ color: "var(--danger)" }}>Couldn&apos;t load the numbers.</p>}

        {status === "ok" && events && acc && <Dashboard events={events} acc={acc} />}
      </div>
    </main>
  );
}

function Dashboard({ events, acc }: { events: Events; acc: Accounts }) {
  const s = acc.summary;
  const pct = (n: number, of: number) => (of ? Math.round((n / of) * 100) : 0);
  const decks7 = sum(acc.deckDays.slice(-7).map((d) => d.count));
  const decksPrev7 = sum(acc.deckDays.slice(-14, -7).map((d) => d.count));
  const ai7 = s.ai.last7d;
  const aiPrev7 = sum(acc.aiDays.slice(-14, -7).map((d) => d.count));

  return (
    <>
      {/* ── OVERVIEW ── */}
      <Section id="overview" title="Overview" note="The numbers that matter this week.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 200px), 1fr))", gap: 14 }}>
          <Kpi label="Accounts" value={s.accounts} accent sub={change(s.signups7d, s.signupsPrev7d, "new this week")} spark={s.signups.map((d) => d.count)} sparkUnit="new" />
          <Kpi
            label="Active this week"
            value={s.active.d7}
            sub={`${pct(s.active.d7, s.accounts)}% of accounts · ${s.active.d1} today · ${s.returning7d} returning`}
            meter={s.accounts ? s.active.d7 / s.accounts : 0}
          />
          <Kpi label="AI questions this week" value={ai7} sub={`${s.ai.askers7d} ${s.ai.askers7d === 1 ? "person" : "people"} · ${change(ai7, aiPrev7)}`} spark={acc.aiDays.map((d) => d.count)} sparkUnit="questions" />
          <Kpi label="Decks" value={events.decks} sub={change(decks7, decksPrev7, "made this week")} spark={acc.deckDays.map((d) => d.count)} sparkUnit="decks" />
          <Kpi label="Pro" value={s.pro} sub={`${pct(s.pro, s.accounts)}% of accounts`} meter={s.accounts ? s.pro / s.accounts : 0} />
        </div>
      </Section>

      {/* ── GROWTH ── */}
      <Section id="growth" title="Growth" note="New accounts and new decks, day by day, over the last 30 days.">
        <div style={grid2}>
          <Card>
            <CardHead title="New accounts" note={`${sum(s.signups.map((d) => d.count))} in 30 days`} />
            <DayBars series={s.signups.map((d) => ({ day: d.day, value: d.count }))} unit="new account" />
          </Card>
          <Card>
            <CardHead title="Decks made" note={`${sum(acc.deckDays.map((d) => d.count))} in 30 days`} />
            <DayBars series={acc.deckDays.map((d) => ({ day: d.day, value: d.count }))} unit="deck" />
          </Card>
        </div>
      </Section>

      {/* ── JOURNEY ── */}
      <Section id="journey" title="Journey" note="How far accounts get, and what they build.">
        <div style={grid2}>
          <Card>
            <CardHead title="How far people get" note="Accounts that reached each step, and how many the step lost" />
            <Funnel steps={s.funnel} />
          </Card>
          <Card>
            <CardHead title="Deck formats" note={`${sum(acc.formats.map((f) => f.count))} decks in accounts`} />
            <HBars rows={acc.formats.map((f) => ({ label: cap(f.format), value: f.count }))} total={sum(acc.formats.map((f) => f.count))} />
          </Card>
        </div>
      </Section>

      {/* ── AI ── */}
      <Section id="ai" title="AI assistant" note="Questions to the assistant, counted from its server-side thread since 27 Sep.">
        <div style={grid2}>
          <Card>
            <CardHead title="Questions per day" note={`${sum(acc.aiDays.map((d) => d.count))} in 30 days · ${s.ai.total} in all`} />
            <DayBars series={acc.aiDays.map((d) => ({ day: d.day, value: d.count }))} unit="question" />
          </Card>
          <Card>
            <CardHead title="Most active this week" note={s.ai.askers7d ? `Each asker averages ${round1(ai7 / Math.max(1, s.ai.askers7d))} questions` : "No questions this week"} />
            <TopAskers rows={acc.accounts} />
          </Card>
        </div>
      </Section>

      {/* ── ACCOUNTS ── */}
      <Section id="accounts" title="Accounts" note="Everyone who signed up. Click a row for their decks.">
        <AccountsTable rows={acc.accounts} />
      </Section>

      {/* ── EVENTS ── */}
      <Section id="events" title="Events" note="First-party counters, the last 30 days. The change compares the last 14 days with the 14 before.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 240px), 1fr))", gap: 14 }}>
          {events.types.map((t) => {
            const v = events.series.map((d) => d[t] ?? 0);
            const last14 = sum(v.slice(-14));
            const prev14 = sum(v.slice(-28, -14));
            return (
              <Card key={t} style={{ padding: "14px 16px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--w-1)" }}>{LABELS[t] ?? t}</span>
                  <Trend cur={last14} prev={prev14} />
                </div>
                <div className="id-mono" style={{ fontSize: 24, fontWeight: 700, color: "var(--w-1)", margin: "6px 0 2px", fontVariantNumeric: "tabular-nums" }}>
                  {sum(v).toLocaleString()}
                </div>
                <div style={{ fontSize: 11.5, color: "var(--w-3)", marginBottom: 10 }}>in 30 days · {(events.totals[t] ?? 0).toLocaleString()} all-time</div>
                <Spark values={v} unit={(LABELS[t] ?? t).toLowerCase()} days={events.series.map((d) => d.day)} />
              </Card>
            );
          })}
        </div>
      </Section>
    </>
  );
}

/* ───────────────────────── pieces ───────────────────────── */

const grid2: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 440px), 1fr))", gap: 16 };

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}
function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
function round1(n: number): string {
  return String(Math.round(n * 10) / 10);
}
/** "+3 on last week", "same as last week"; with a lead, "5 new this week · +3 on last week". */
function change(cur: number, prev: number, lead?: string): string {
  const d = cur - prev;
  const tail = d === 0 ? "same as last week" : `${d > 0 ? "+" : "−"}${Math.abs(d)} on last week`;
  return lead ? `${cur} ${lead} · ${tail}` : tail;
}
function fmtDay(day: string): string {
  return day ? new Date(day + "T00:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" }) : "";
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div className="id-panel" style={{ padding: "18px clamp(14px,2vw,22px)", minWidth: 0, ...style }}>
      {children}
    </div>
  );
}

function CardHead({ title, note }: { title: string; note?: string }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 16, fontWeight: 700, color: "var(--w-1)" }}>{title}</div>
      {note && <div style={{ fontSize: 12.5, color: "var(--w-3)", marginTop: 3 }}>{note}</div>}
    </div>
  );
}

function Section({ id, title, note, children }: { id: string; title: string; note?: string; children: React.ReactNode }) {
  return (
    <section id={id} style={{ scrollMarginTop: 72, marginBottom: 40 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <h2 className="id-display" style={{ fontSize: "clamp(22px,2.6vw,28px)", margin: 0, color: "var(--w-1)" }}>{title}</h2>
        {note && <span style={{ fontSize: 13, color: "var(--w-3)" }}>{note}</span>}
      </div>
      {children}
    </section>
  );
}

/* A headline number, what it means, and a small picture of it: the last 30
   days as bars, or a share as a meter. */
function Kpi({ label, value, sub, spark, sparkUnit, meter, accent }: { label: string; value: number; sub?: string; spark?: number[]; sparkUnit?: string; meter?: number; accent?: boolean }) {
  return (
    <Card style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 6 }}>
      <div className="id-label" style={{ color: "var(--w-3)" }}>{label}</div>
      <div className="id-mono" style={{ fontSize: 34, fontWeight: 700, lineHeight: 1, color: accent ? "var(--gold)" : "var(--w-1)", fontVariantNumeric: "tabular-nums" }}>
        {value.toLocaleString()}
      </div>
      {sub && <div style={{ fontSize: 12.5, color: "var(--w-2)", lineHeight: 1.4 }}>{sub}</div>}
      <div style={{ marginTop: "auto", paddingTop: 8 }}>
        {spark && <Spark values={spark} unit={sparkUnit ?? ""} />}
        {meter !== undefined && (
          <div role="img" aria-label={`${Math.round(meter * 100)}%`} style={{ height: 6, borderRadius: 3, background: "var(--w-line)" }}>
            <div style={{ width: `${Math.min(100, meter * 100)}%`, minWidth: meter > 0 ? 4 : 0, height: "100%", borderRadius: 3, background: "var(--gold)" }} />
          </div>
        )}
      </div>
    </Card>
  );
}

/* Thirty tiny bars. Hover a bar for its day and value. */
function Spark({ values, unit, days }: { values: number[]; unit: string; days?: string[] }) {
  const max = Math.max(1, ...values);
  return (
    <div role="img" aria-label={`Last ${values.length} days of ${unit}: ${values.join(", ")}`} style={{ display: "flex", alignItems: "flex-end", gap: 1.5, height: 34 }}>
      {values.map((v, i) => (
        <div
          key={i}
          title={`${days ? fmtDay(days[i]) + ": " : ""}${v} ${unit}`}
          style={{ flex: 1, height: `${(v / max) * 100}%`, minHeight: v ? 2 : 1, borderRadius: 2, background: v ? "var(--gold)" : "var(--w-line)", opacity: v ? 0.9 : 1 }}
        />
      ))}
    </div>
  );
}

function Trend({ cur, prev }: { cur: number; prev: number }) {
  if (!prev && !cur) return <span style={{ fontSize: 11.5, color: "var(--w-3)" }}>—</span>;
  if (!prev) return <span style={{ fontSize: 11.5, color: "var(--w-2)" }}>new</span>;
  const p = Math.round(((cur - prev) / prev) * 100);
  return (
    <span className="id-mono" style={{ fontSize: 11.5, fontWeight: 700, color: p >= 0 ? "#8ef0b8" : "#ffb4a3" }}>
      {p >= 0 ? "▲" : "▼"} {Math.abs(p)}%
    </span>
  );
}

/* One bar per day, one series. Hover (or tap) a day for its value; otherwise
   the line above names the busiest day. */
function DayBars({ series, unit }: { series: { day: string; value: number }[]; unit: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...series.map((d) => d.value));
  const peak = series.findIndex((d) => d.value === max && max > 0);
  // Three gridlines: 0, half, max.
  const ticks = [max, Math.round(max / 2)];
  return (
    <div>
      <div style={{ height: 18, fontSize: 12.5, color: "var(--w-2)", marginBottom: 8 }}>
        {hover !== null ? (
          <>
            <b style={{ color: "var(--w-1)" }}>{series[hover].value.toLocaleString()}</b> {unit}
            {series[hover].value === 1 ? "" : "s"} · {fmtDay(series[hover].day)}
          </>
        ) : peak >= 0 ? (
          <>
            Busiest: <b style={{ color: "var(--w-1)" }}>{max.toLocaleString()}</b> on {fmtDay(series[peak].day)}
          </>
        ) : (
          "Nothing yet"
        )}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <div aria-hidden style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", height: 140, fontSize: 10.5, color: "var(--w-3)", fontFamily: "var(--font-mono)", textAlign: "right", minWidth: 16 }}>
          <span>{ticks[0]}</span>
          <span>{ticks[1]}</span>
          <span>0</span>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            role="img"
            aria-label={`${unit}s per day: ` + series.map((d) => `${d.day} ${d.value}`).join(", ")}
            onMouseLeave={() => setHover(null)}
            style={{ position: "relative", display: "flex", alignItems: "flex-end", gap: 2, height: 140, borderBottom: "1px solid var(--w-line)" }}
          >
            <div aria-hidden style={{ position: "absolute", left: 0, right: 0, top: 0, borderTop: "1px dashed var(--w-line)" }} />
            <div aria-hidden style={{ position: "absolute", left: 0, right: 0, top: "50%", borderTop: "1px dashed var(--w-line)" }} />
            {series.map((d, i) => (
              <div key={d.day} onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} style={{ flex: 1, height: "100%", display: "flex", alignItems: "flex-end", position: "relative" }}>
                <div
                  style={{
                    width: "100%",
                    height: `${(d.value / max) * 100}%`,
                    minHeight: d.value ? 3 : 0,
                    background: "var(--gold)",
                    opacity: hover === null || hover === i ? 1 : 0.4,
                    borderRadius: "4px 4px 0 0",
                    transition: "height .4s cubic-bezier(.2,.8,.2,1), opacity .12s",
                  }}
                />
              </div>
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 11, color: "var(--w-3)", fontFamily: "var(--font-mono)" }}>
            <span>{fmtDay(series[0]?.day ?? "")}</span>
            <span>{fmtDay(series[Math.floor(series.length / 2)]?.day ?? "")}</span>
            <span>{fmtDay(series[series.length - 1]?.day ?? "")}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* Each step as a bar against sign-ups, with what it kept of the step before. */
function Funnel({ steps }: { steps: { label: string; count: number }[] }) {
  const top = Math.max(1, steps[0]?.count ?? 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {steps.map((st, i) => {
        const prev = i ? steps[i - 1].count : st.count;
        const kept = prev ? Math.round((st.count / prev) * 100) : 0;
        return (
          <div key={st.label}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, marginBottom: 5 }}>
              <span style={{ fontSize: 13.5, color: "var(--w-1)", fontWeight: 600 }}>
                <span className="id-mono" style={{ color: "var(--w-3)", marginRight: 8 }}>{i + 1}</span>
                {st.label}
              </span>
              <span className="id-mono" style={{ fontSize: 13, color: "var(--w-1)", fontVariantNumeric: "tabular-nums" }}>
                {st.count.toLocaleString()}
                <span style={{ color: "var(--w-3)" }}> · {Math.round((st.count / top) * 100)}%</span>
              </span>
            </div>
            <div style={{ height: 10, borderRadius: 5, background: "var(--w-line)" }}>
              <div style={{ width: `${(st.count / top) * 100}%`, minWidth: st.count ? 4 : 0, height: "100%", borderRadius: 5, background: "var(--gold)", transition: "width .4s cubic-bezier(.2,.8,.2,1)" }} />
            </div>
            {i > 0 && (
              <div style={{ fontSize: 11.5, color: kept < 50 ? "#ffb4a3" : "var(--w-3)", marginTop: 4 }}>
                kept {kept}% of step {i}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* Labelled horizontal bars, one series, with each row's share of `total`. */
function HBars({ rows, total }: { rows: { label: string; value: number }[]; total?: number }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (rows.length === 0) return <div style={{ fontSize: 13, color: "var(--w-3)" }}>Nothing yet</div>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {rows.map((r) => (
        <div key={r.label}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13.5, color: "var(--w-1)", marginBottom: 5 }}>
            <span style={{ fontWeight: 600 }}>{r.label}</span>
            <span className="id-mono" style={{ fontSize: 13 }}>
              {r.value.toLocaleString()}
              {total ? <span style={{ color: "var(--w-3)" }}> · {Math.round((r.value / Math.max(1, total)) * 100)}%</span> : null}
            </span>
          </div>
          <div style={{ height: 10, borderRadius: 5, background: "var(--w-line)" }}>
            <div style={{ width: `${(r.value / max) * 100}%`, minWidth: r.value ? 4 : 0, height: "100%", borderRadius: 5, background: "var(--gold)" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function TopAskers({ rows }: { rows: AccountRow[] }) {
  const top = [...rows].filter((r) => r.aiQuestions7d > 0).sort((a, b) => b.aiQuestions7d - a.aiQuestions7d).slice(0, 6);
  if (top.length === 0) return <div style={{ fontSize: 13, color: "var(--w-3)" }}>Nobody has asked this week.</div>;
  const max = top[0].aiQuestions7d;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {top.map((r) => (
        <div key={r.id}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13, marginBottom: 4 }}>
            <span style={{ color: "var(--w-1)", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.email}</span>
            <span className="id-mono" style={{ color: "var(--w-1)", flex: "none" }}>
              {r.aiQuestions7d}
              <span style={{ color: "var(--w-3)" }}> · {r.aiQuestions} in all</span>
            </span>
          </div>
          <div style={{ height: 6, borderRadius: 3, background: "var(--w-line)" }}>
            <div style={{ width: `${(r.aiQuestions7d / max) * 100}%`, height: "100%", borderRadius: 3, background: "var(--gold)" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ───────────────────────── accounts ───────────────────────── */

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

const DAY = 86_400_000;
const FILTERS: { id: string; label: string; test: (r: AccountRow) => boolean }[] = [
  { id: "all", label: "All", test: () => true },
  { id: "active", label: "Active this week", test: (r) => Date.now() - Date.parse(r.lastActive) < 7 * DAY },
  { id: "new", label: "New this week", test: (r) => Date.now() - Date.parse(r.createdAt) < 7 * DAY },
  { id: "pro", label: "Pro", test: (r) => r.tier === "pro" },
  { id: "ai", label: "Asked the AI", test: (r) => r.aiQuestions > 0 },
  { id: "nodeck", label: "No deck yet", test: (r) => r.decks === 0 },
  { id: "unverified", label: "Unverified", test: (r) => !r.verified },
];

function ago(iso: string): string {
  const d = (Date.now() - new Date(iso).getTime()) / DAY;
  if (d < 1 / 24) return "just now";
  if (d < 1) return `${Math.floor(d * 24)}h ago`;
  if (d < 30) return `${Math.floor(d)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function toCsv(rows: AccountRow[]): string {
  const head = ["email", "tier", "sign_in", "verified", "joined", "last_active", "decks", "full_decks", "cards", "collection", "ai_questions", "ai_questions_7d", "scans", "versions", "games"];
  const esc = (v: unknown) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = rows.map((r) =>
    [r.email, r.tier, r.signIn.join("+"), r.verified, r.createdAt, r.lastActive, r.decks, r.builtDecks, r.cards, r.collection, r.aiQuestions, r.aiQuestions7d, r.scans, r.versions, r.games].map(esc).join(",")
  );
  return [head.join(","), ...lines].join("\n");
}

function AccountsTable({ rows }: { rows: AccountRow[] }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "lastActive", desc: true });
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.id, rows.filter(f.test).length])), [rows]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const f = FILTERS.find((x) => x.id === filter)!;
    const list = rows.filter((r) => f.test(r) && (!needle || r.email.toLowerCase().includes(needle) || (r.name ?? "").toLowerCase().includes(needle)));
    const dir = sort.desc ? -1 : 1;
    return list.sort((a, b) => {
      const x = a[sort.key];
      const y = b[sort.key];
      return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y))) * dir;
    });
  }, [rows, q, filter, sort]);
  const visible = all || q ? shown : shown.slice(0, 25);

  const download = () => {
    const url = URL.createObjectURL(new Blob([toCsv(shown)], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `spellpool-accounts-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const th: React.CSSProperties = { padding: "10px 10px", fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--w-3)", whiteSpace: "nowrap", cursor: "pointer", userSelect: "none", borderBottom: "1px solid var(--w-line)", position: "sticky", top: 0 };
  const td: React.CSSProperties = { padding: "11px 10px", fontSize: 13.5, color: "var(--w-2)", borderBottom: "1px solid var(--w-line)", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" };

  return (
    <Card style={{ padding: 0 }}>
      <div style={{ padding: "16px clamp(14px,2vw,20px) 12px", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search email"
            aria-label="Search accounts by email"
            style={{ flex: "1 1 220px", padding: "9px 12px", borderRadius: 10, border: "1px solid var(--w-line)", background: "rgba(255,255,255,.08)", color: "var(--w-1)", fontSize: 16, minWidth: 0 }}
          />
          <button type="button" onClick={download} style={{ display: "flex", alignItems: "center", gap: 7, padding: "9px 14px", borderRadius: 10, border: "1px solid var(--w-line)", background: "transparent", color: "var(--w-1)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
            <Download size={14} strokeWidth={2.25} /> CSV
          </button>
        </div>
        <div role="group" aria-label="Filter accounts" style={{ display: "flex", gap: 6, overflowX: "auto", scrollbarWidth: "none" }}>
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
              style={{
                flex: "none",
                padding: "6px 11px",
                borderRadius: 999,
                border: "1px solid " + (filter === f.id ? "transparent" : "var(--w-line)"),
                background: filter === f.id ? "var(--gold)" : "transparent",
                color: filter === f.id ? "var(--accent-ink, #181228)" : "var(--w-2)",
                fontSize: 12.5,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              {f.label} <span style={{ opacity: 0.7 }}>{counts[f.id]}</span>
            </button>
          ))}
        </div>
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
            {visible.map((r) => (
              <Fragment key={r.id}>
                <tr onClick={() => setOpen(open === r.id ? null : r.id)} className="admin-row" style={{ cursor: "pointer" }} aria-expanded={open === r.id}>
                  <td style={td}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {open === r.id ? <ChevronDown size={14} color="var(--w-3)" /> : <ChevronRight size={14} color="var(--w-3)" />}
                      <div>
                        <div style={{ color: "var(--w-1)", fontWeight: 600 }}>{r.email}</div>
                        <div style={{ display: "flex", gap: 6, marginTop: 3, fontSize: 11.5 }}>
                          {r.tier === "pro" && <span style={{ padding: "0 7px", borderRadius: 999, background: "var(--gold)", color: "var(--accent-ink, #181228)", fontWeight: 700 }}>Pro</span>}
                          <span style={{ color: "var(--w-3)" }}>{r.signIn.join(" + ") || "—"}</span>
                          {!r.verified && <span style={{ color: "#ffb4a3" }}>· unverified</span>}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td style={td} title={r.createdAt}>{ago(r.createdAt)}</td>
                  <td style={td} title={r.lastActive}>{ago(r.lastActive)}</td>
                  <td style={{ ...td, textAlign: "right" }}>
                    {r.decks}
                    {r.builtDecks > 0 && <div style={{ fontSize: 11.5, color: "var(--w-3)" }}>{r.builtDecks} full</div>}
                  </td>
                  <td style={{ ...td, textAlign: "right" }}>{r.cards.toLocaleString()}</td>
                  <td style={{ ...td, textAlign: "right" }}>{r.collection.toLocaleString()}</td>
                  <td style={{ ...td, textAlign: "right" }}>
                    <div style={{ color: r.aiQuestions ? "var(--w-1)" : undefined }}>{r.aiQuestions}</div>
                    {r.aiQuestions7d > 0 && <div style={{ fontSize: 11.5, color: "var(--w-3)" }}>{r.aiQuestions7d} this week</div>}
                  </td>
                  <td style={{ ...td, textAlign: "right" }}>{r.scans}</td>
                  <td style={{ ...td, textAlign: "right" }}>{r.games}</td>
                </tr>
                {open === r.id && (
                  <tr>
                    <td colSpan={COLS.length} style={{ padding: "4px 14px 16px 34px", borderBottom: "1px solid var(--w-line)", background: "rgba(255,255,255,.03)" }}>
                      <AccountDetail r={r} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={COLS.length} style={{ ...td, textAlign: "center", color: "var(--w-3)", padding: 24 }}>
                  No accounts match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div style={{ padding: "12px clamp(14px,2vw,20px)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 12.5, color: "var(--w-3)" }}>
        <span>
          Showing {visible.length} of {shown.length}
          {shown.length !== rows.length ? ` (${rows.length} in all)` : ""}
        </span>
        {!all && !q && shown.length > 25 && (
          <button type="button" onClick={() => setAll(true)} className="id-ghost" style={{ padding: "7px 14px", fontSize: 13 }}>
            Show all {shown.length}
          </button>
        )}
      </div>
    </Card>
  );
}

function AccountDetail({ r }: { r: AccountRow }) {
  const decks = r.deckList ?? [];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 8 }}>
      <div style={{ fontSize: 12.5, color: "var(--w-3)", whiteSpace: "normal" }}>
        Joined {new Date(r.createdAt).toLocaleString()} · last active {new Date(r.lastActive).toLocaleString()} · {r.versions} saved version{r.versions === 1 ? "" : "s"}
        {r.name ? ` · ${r.name}` : ""}
      </div>
      {decks.length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--w-3)" }}>No decks yet.</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8 }}>
          {decks.map((d) => (
            <Link
              key={d.publicId}
              href={`/deck/${d.publicId}`}
              style={{ display: "block", padding: "9px 12px", borderRadius: 10, background: "rgba(255,255,255,.06)", boxShadow: "inset 0 0 0 1px var(--w-line)", textDecoration: "none", whiteSpace: "normal" }}
            >
              <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--w-1)" }}>{d.name}</div>
              <div style={{ fontSize: 11.5, color: "var(--w-3)", marginTop: 2 }}>
                {cap(d.format)} · {d.cards} cards{d.scanned ? " · scanned" : ""} · {ago(d.createdAt)}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
