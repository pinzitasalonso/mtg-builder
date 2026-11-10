"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ClipboardCopy, Minus, Plus, Trash2 } from "lucide-react";
import CommanderInput from "@/components/CommanderInput";
import {
  EMPTY_WISHLIST,
  addToWishlist,
  clearOwnedFromWishlist,
  clearWishlist,
  fetchWishlist,
  gotWishlistCard,
  setWishlistQty,
  wishlistText,
  type Wishlist,
} from "@/lib/wishlist-client";
import { stillWanted, wishlistSummary, type WishlistCard } from "@/lib/wishlist";

/* The wishlist, a tab of the collection screen: the cards you want and don't
   have yet. Add one by name, set how many you want, and when you get it,
   "Got it" moves it into your collection. A card you already own says so. */

const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function WishlistPanel({ onChanged, onCollectionChanged }: { onChanged?: (unique: number) => void; onCollectionChanged?: () => void }) {
  const [list, setList] = useState<Wishlist>(EMPTY_WISHLIST);
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"name" | "price" | "new">("name");

  // Local edits keep the totals in step without another request.
  const apply = (cards: WishlistCard[]) => {
    setList({ cards, ...wishlistSummary(cards) });
    onChanged?.(cards.length);
  };
  async function load() {
    const w = await fetchWishlist();
    if (!w) return;
    setLoaded(true);
    setList(w);
    onChanged?.(w.unique);
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function add(raw: string) {
    const n = raw.trim();
    if (!n || busy) return;
    setBusy(true);
    setNote(null);
    const r = await addToWishlist([{ name: n }]);
    setBusy(false);
    if (!r.ok) {
      setNote(r.error ?? "Couldn’t add it.");
      return;
    }
    setName("");
    setNote(r.added ? null : `${n} is already on your wishlist.`);
    load();
  }

  async function setQty(card: WishlistCard, next: number) {
    setRowBusy(card.name);
    if (await setWishlistQty(card.name, next)) {
      apply(next <= 0 ? list.cards.filter((c) => c.name !== card.name) : list.cards.map((c) => (c.name === card.name ? { ...c, quantity: Math.min(next, 99) } : c)));
    }
    setRowBusy(null);
  }

  async function got(card: WishlistCard) {
    setRowBusy(card.name);
    if (await gotWishlistCard(card.name)) {
      apply(list.cards.filter((c) => c.name !== card.name));
      setNote(`${card.name} is in your collection now.`);
      onCollectionChanged?.();
    }
    setRowBusy(null);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(wishlistText(list.cards));
      setNote("Copied the cards you still need.");
    } catch {
      setNote("Couldn’t copy. Your browser blocked the clipboard.");
    }
  }

  async function removeOwned() {
    if (busy) return;
    setBusy(true);
    if (await clearOwnedFromWishlist()) await load();
    setBusy(false);
  }

  async function clearAll() {
    if (busy || !list.unique) return;
    if (!confirm("Clear your whole wishlist?")) return;
    setBusy(true);
    if (await clearWishlist()) apply([]);
    setBusy(false);
  }

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const out = list.cards.filter((c) => !q || c.name.toLowerCase().includes(q));
    out.sort((a, b) => {
      if (sort === "price") return Number(b.usdPrice ?? -1) - Number(a.usdPrice ?? -1) || a.name.localeCompare(b.name);
      if (sort === "new") return b.addedAt.localeCompare(a.addedAt) || a.name.localeCompare(b.name);
      return a.name.localeCompare(b.name);
    });
    return out;
  }, [list.cards, search, sort]);

  // Cards you now own enough of: nothing left to get.
  const done = list.cards.filter((c) => stillWanted(c) === 0).length;
  const pill: React.CSSProperties = { padding: "9px 14px", border: "1px solid var(--line)", borderRadius: 999, background: "var(--bg3)", color: "var(--text)", outline: "none", fontSize: 16 };

  return (
    <>
      <div style={{ padding: "12px clamp(16px, 4vw, 22px)", borderBottom: "1px solid var(--line)" }}>
        <div className="mn-label" style={{ color: "var(--text-muted)" }} data-testid="wishlist-summary">
          {!loaded
            ? "loading…"
            : list.unique === 0
              ? "empty"
              : `${list.unique} card${list.unique === 1 ? "" : "s"} · ${list.missing} cop${list.missing === 1 ? "y" : "ies"} still to get` +
                (list.cost > 0 ? ` · about ${usd(list.cost)}` : "") +
                (list.unpriced > 0 ? ` (${list.unpriced} without a price)` : "")}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
          <div style={{ flex: "1 1 220px", minWidth: 0, maxWidth: 360 }}>
            <CommanderInput value={name} onChange={setName} onPick={add} placeholder="Add a card you want…" style={{ ...pill, width: "100%" }} />
          </div>
          <button onClick={() => add(name)} disabled={busy || !name.trim()} className="mn-btn" style={{ padding: "9px 18px", fontSize: 14 }}>
            {busy ? "Adding…" : "Add"}
          </button>
          <button onClick={copy} disabled={list.missing === 0} className="mn-ghost" style={{ padding: "8px 14px", fontSize: 13 }} title="Copy the cards you still need, as a list">
            <ClipboardCopy size={15} strokeWidth={2.25} /> Copy list
          </button>
          {done > 0 && (
            <button onClick={removeOwned} disabled={busy} className="mn-ghost" style={{ padding: "8px 14px", fontSize: 13 }} title="Take off the cards you now own enough of">
              Remove owned ({done})
            </button>
          )}
          {list.unique > 0 && (
            <button onClick={clearAll} disabled={busy} className="mn-ghost" style={{ padding: "8px 14px", fontSize: 13 }}>
              Clear all
            </button>
          )}
        </div>
        {note && (
          <div role="status" style={{ marginTop: 8, fontSize: 13, color: "var(--text-muted)" }}>
            {note}
          </div>
        )}
      </div>

      {list.unique > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px clamp(16px, 4vw, 22px)", borderBottom: "1px solid var(--line)", flexWrap: "wrap" }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search…"
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            style={{ ...pill, flex: "1 1 180px", minWidth: 0, maxWidth: 320 }}
          />
          <select value={sort} onChange={(e) => setSort(e.target.value as "name" | "price" | "new")} style={{ padding: "7px 10px", border: "1px solid var(--line)", borderRadius: 999, background: "var(--bg3)", color: "var(--text)", fontSize: 13.5, cursor: "pointer" }}>
            <option value="name">Sort: Name</option>
            <option value="price">Sort: Price</option>
            <option value="new">Sort: Newest</option>
          </select>
          <span style={{ fontSize: 13, color: "var(--text-muted)", marginLeft: "auto" }}>
            {shown.length} card{shown.length === 1 ? "" : "s"}
          </span>
        </div>
      )}

      <div style={{ flex: 1, overflowY: "auto", padding: "18px clamp(16px, 4vw, 22px) 40px" }}>
        {!loaded ? (
          <div style={{ textAlign: "center", color: "var(--text-muted)", padding: "60px 20px", fontSize: 15 }}>Loading your wishlist…</div>
        ) : list.unique === 0 ? (
          <div style={{ textAlign: "center", color: "var(--text-muted)", padding: "60px 20px", fontSize: 15, lineHeight: 1.5 }}>
            Your wishlist is empty. Add the cards you want and don’t have yet.
            <br />
            You can also add one from any deck: open a card you don’t own and choose “Add to wishlist”.
          </div>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(132px, 1fr))", gap: 14 }}>
              {shown.map((c) => (
                <WishTile key={c.name} card={c} busy={rowBusy === c.name} onInc={() => setQty(c, c.quantity + 1)} onDec={() => setQty(c, c.quantity - 1)} onDelete={() => setQty(c, 0)} onGot={() => got(c)} />
              ))}
            </div>
            {shown.length === 0 && <p style={{ textAlign: "center", color: "var(--text-dim)", fontSize: 14, marginTop: 40 }}>No cards match.</p>}
          </>
        )}
      </div>
    </>
  );
}

function WishTile({ card, busy, onInc, onDec, onDelete, onGot }: { card: WishlistCard; busy: boolean; onInc: () => void; onDec: () => void; onDelete: () => void; onGot: () => void }) {
  const [failed, setFailed] = useState(false);
  // Every card is resolved when it's added, so it has its scan; one that
  // somehow hasn't shows its name. Never a lookup by name from the browser.
  const src = card.imageUri;
  return (
    <div data-testid="wish-tile" aria-label={card.name} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ position: "relative", borderRadius: "4.8%/3.5%", overflow: "hidden", aspectRatio: "5 / 7", background: "rgba(0,0,0,.28)", boxShadow: "0 4px 12px -4px rgba(0,0,0,.45)" }}>
        {failed || !src ? (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: 10, textAlign: "center", fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,.82)" }}>{card.name}</div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={card.name} loading="lazy" decoding="async" onError={() => setFailed(true)} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        )}
        <span style={{ position: "absolute", top: 7, left: 7, background: "rgba(124,92,255,.94)", color: "#fff", fontSize: 12, fontWeight: 800, padding: "1px 8px", borderRadius: 999, boxShadow: "0 1px 4px rgba(0,0,0,.35)" }} title="Copies wanted">
          ×{busy ? "…" : card.quantity}
        </span>
        {card.owned > 0 && (
          <span style={{ position: "absolute", top: 7, right: 7, display: "inline-flex", alignItems: "center", gap: 3, background: "rgba(13,138,95,.94)", color: "#fff", fontSize: 11.5, fontWeight: 800, padding: "1px 7px", borderRadius: 999, boxShadow: "0 1px 4px rgba(0,0,0,.35)" }} title="In your collection">
            <Check size={11} strokeWidth={3.5} /> Own {card.owned}
          </span>
        )}
        {/* Always shown, not on hover: a wishlist is short, and "Got it" is the point. */}
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 6, padding: 6, background: "linear-gradient(transparent, rgba(0,0,0,.7))" }}>
          <button onClick={onDec} disabled={busy} aria-label={`Want one fewer ${card.name}`} style={tileBtn}><Minus size={15} strokeWidth={2.5} /></button>
          <button onClick={onInc} disabled={busy} aria-label={`Want one more ${card.name}`} style={tileBtn}><Plus size={15} strokeWidth={2.5} /></button>
          <button onClick={onDelete} disabled={busy} aria-label={`Take ${card.name} off the wishlist`} style={{ ...tileBtn, color: "#ff9b8a" }}><Trash2 size={15} strokeWidth={2.25} /></button>
        </div>
      </div>
      <button onClick={onGot} disabled={busy} className="mn-ghost" aria-label={`Got ${card.name}: move it to your collection`} title="Move it to your collection" style={{ justifyContent: "center", padding: "6px 8px", fontSize: 12.5, gap: 5 }}>
        <Check size={14} strokeWidth={2.75} /> Got it{card.usdPrice ? <span style={{ color: "var(--text-muted)", fontWeight: 500 }}> · ${card.usdPrice}</span> : null}
      </button>
    </div>
  );
}

const tileBtn: React.CSSProperties = {
  width: 26,
  height: 26,
  borderRadius: 7,
  border: "none",
  cursor: "pointer",
  background: "rgba(10,8,6,.78)",
  color: "#fff",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  backdropFilter: "blur(4px)",
};
