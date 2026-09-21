"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { CardArt } from "@/components/mtg";
import { PoolEntry } from "@/lib/pool-client";
import { hypergeometric, hypergeometricAtLeast } from "@/lib/probability";
import {
  PlayCard,
  PlaytestState,
  Zone,
  adjustLife,
  bottomCard,
  draw,
  isLandCard,
  moveCard,
  mulligan,
  nextTurn,
  play,
  resolvesToGraveyard,
  shuffleLibrary,
  startGame,
  toggleTap,
  untapAll,
} from "@/lib/playtest";

type Pile = "library" | "graveyard" | "exile";

interface MenuState {
  card: PlayCard;
  zone: Zone;
  anchor: DOMRect;
}
interface Zoom {
  card: PlayCard;
  /** Where the card was when it was hovered. The preview only lives while the
      card is still there: a card that was just played or cast leaves its zone,
      and an unmounted element never fires pointerleave to clear the hover. */
  zone: Zone;
  anchor: DOMRect;
}
type Step = (s: PlaytestState) => PlaytestState;

const ZONE_LABEL: Record<Zone, string> = {
  library: "Library",
  hand: "Hand",
  battlefield: "Battlefield",
  graveyard: "Graveyard",
  exile: "Exile",
  command: "Command zone",
};

/* The playtest table — a solo game against a goldfish, full-screen so the
   cards are readable. The hand runs along the bottom, the battlefield keeps
   the lands on their own row, and the library, graveyard, exile and command
   zone are piles down the side. Click a card in hand to play it, a permanent
   to tap it; every card also has a ⋯ menu for any other move. The rules live
   in lib/playtest; this is only the table. */
export default function PlaytestModal({
  cards,
  sourceLabel,
  commander,
  format,
  onClose,
}: {
  cards: PoolEntry[];
  sourceLabel: string;
  commander?: string | null;
  format?: string;
  onClose: () => void;
}) {
  const commanderGame = (format ?? "").toLowerCase() === "commander";
  const startingLife = commanderGame ? 40 : 20;
  const newGame = () => startGame(cards, { commander: commanderGame ? commander : null, startingLife });
  const [state, setState] = useState<PlaytestState>(newGame);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [pile, setPile] = useState<Pile | null>(null);
  const [oddsOpen, setOddsOpen] = useState(false);
  const [zoom, setZoom] = useState<Zoom | null>(null);

  // The page behind must not scroll while the table is up.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
  // Esc closes the topmost thing: a menu or panel first, then the table.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (menu || pile || oddsOpen || zoom) {
        setMenu(null);
        setPile(null);
        setOddsOpen(false);
        setZoom(null);
      } else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu, pile, oddsOpen, zoom, onClose]);

  // Every move goes through here so the menu it came from closes with it — and
  // so does the hover zoom: the card under the pointer may have just left the
  // zone, and an unmounted card never fires pointerleave.
  const act = (step: Step) => {
    setMenu(null);
    setZoom(null);
    setState(step);
  };

  // Deck-wide land odds — the old sample-hand table, kept behind a button.
  // Counts the library deck: everything but a seated commander.
  const { deckSize, landCount } = useMemo(() => {
    const seats = new Set(
      commanderGame ? (commander ?? "").split("+").map((s) => s.trim().toLowerCase()).filter(Boolean) : []
    );
    let deckSize = 0;
    let landCount = 0;
    for (const c of cards) {
      for (let i = 0; i < Math.max(1, c.quantity); i++) {
        const key = c.name.trim().toLowerCase();
        if (seats.has(key)) {
          seats.delete(key);
          continue;
        }
        deckSize++;
        if (isLandCard(c.typeLine)) landCount++;
      }
    }
    return { deckSize, landCount };
  }, [cards, commander, commanderGame]);

  const lands = state.battlefield.filter((c) => isLandCard(c.typeLine));
  const perms = state.battlefield.filter((c) => !isLandCard(c.typeLine));
  const landsInHand = state.hand.filter((c) => isLandCard(c.typeLine)).length;

  // Hand cards shrink to fit the row, down to a floor, before it scrolls.
  const n = Math.max(7, state.hand.length);
  const handVars = {
    "--pt-hand": `max(72px, min(var(--pt-hand-max), calc((100vw - 64px - ${(n - 1) * 10}px) / ${n})))`,
  } as React.CSSProperties;

  const onPrimary = (card: PlayCard, zone: Zone, anchor: DOMRect) => {
    if (zone === "hand") act((s) => (s.toBottom > 0 ? bottomCard(s, card.iid) : play(s, card.iid)));
    else if (zone === "battlefield") act((s) => toggleTap(s, card.iid));
    else if (zone === "command") act((s) => play(s, card.iid));
    else setMenu({ card, zone, anchor }); // a pile card: the menu is the move
  };
  const openMenu = (anchor: DOMRect, card: PlayCard, zone: Zone) => setMenu({ card, zone, anchor });
  const onZoom = (card: PlayCard | null, zone?: Zone, anchor?: DOMRect) =>
    setZoom(card && zone && anchor ? { card, zone, anchor } : null);
  const zoomLive = zoom !== null && state[zoom.zone].some((c) => c.iid === zoom.card.iid);

  // Everything a card can do from where it is. The primary click is listed
  // first so the menu is a complete list, not just the extras.
  const optionsFor = (card: PlayCard, zone: Zone): { label: string; step: Step }[] => {
    const to = (z: Zone, position?: "top" | "bottom"): Step => (s) => moveCard(s, card.iid, z, { position });
    const out: { label: string; step: Step }[] = [];
    if (zone === "hand") out.push({ label: resolvesToGraveyard(card.typeLine) ? "Cast — to graveyard" : "Play", step: (s) => play(s, card.iid) });
    if (zone === "command") out.push({ label: "Cast", step: (s) => play(s, card.iid) });
    if (zone === "battlefield") out.push({ label: card.tapped ? "Untap" : "Tap", step: (s) => toggleTap(s, card.iid) });
    if (zone !== "battlefield" && (zone !== "hand" || resolvesToGraveyard(card.typeLine))) out.push({ label: "Put onto battlefield", step: to("battlefield") });
    if (zone !== "hand") out.push({ label: "Return to hand", step: to("hand") });
    if (zone !== "graveyard") out.push({ label: zone === "hand" ? "Discard" : "Graveyard", step: to("graveyard") });
    if (zone !== "exile") out.push({ label: "Exile", step: to("exile") });
    out.push({ label: "Top of library", step: to("library", "top") });
    out.push({ label: "Bottom of library", step: to("library", "bottom") });
    if (card.commander && zone !== "command") out.push({ label: "Command zone", step: to("command") });
    return out;
  };

  const cardProps = { onPrimary, onMenu: openMenu, onZoom };
  const pileCards =
    pile === "graveyard"
      ? [...state.graveyard].reverse()
      : pile === "library"
        ? [...state.library].sort((a, b) => a.name.localeCompare(b.name))
        : pile === "exile"
          ? state.exile
          : [];

  return (
    <div className="pt-root" role="dialog" aria-label="Playtest">
      <header className="pt-top">
        <div className="pt-title">
          <span className="id-display" style={{ fontSize: 22, color: "#fff" }}>🎲 Playtest</span>
          <span className="pt-sub">
            from {sourceLabel} · {deckSize} cards · {landCount} lands
          </span>
        </div>
        <div className="pt-top-right">
          <span className="pt-turn">Turn {state.turn}</span>
          <LifeCounter label="Opp" value={state.oppLife} onDelta={(d) => act((s) => adjustLife(s, "opp", d))} />
          <LifeCounter label="You" value={state.life} onDelta={(d) => act((s) => adjustLife(s, "you", d))} />
          <button type="button" className="pt-btn" onClick={() => setOddsOpen(true)}>
            Odds
          </button>
          <button type="button" className="pt-btn" onClick={onClose} aria-label="Close playtest">
            ✕ Close
          </button>
        </div>
      </header>

      <div className="pt-tools">
        <button type="button" className="pt-btn pt-btn-gold" onClick={() => act(newGame)}>
          New game
        </button>
        <button type="button" className="pt-btn" onClick={() => act((s) => mulligan(s))} disabled={state.mulligans >= 6}>
          Mulligan{state.mulligans ? ` (${state.mulligans})` : ""}
        </button>
        <button type="button" className="pt-btn" onClick={() => act((s) => draw(s, 1))} disabled={state.library.length === 0}>
          Draw
        </button>
        <button type="button" className="pt-btn" onClick={() => act(nextTurn)}>
          Next turn ⟳
        </button>
        <button type="button" className="pt-btn" onClick={() => act(untapAll)} disabled={!state.battlefield.some((c) => c.tapped)}>
          Untap all
        </button>
        <button type="button" className="pt-btn" onClick={() => act((s) => shuffleLibrary(s))} disabled={state.library.length < 2}>
          Shuffle
        </button>
        <span className="pt-status">
          {state.toBottom > 0 ? (
            <b style={{ color: "var(--gold)" }}>
              Mulligan — click {state.toBottom} card{state.toBottom === 1 ? "" : "s"} in hand to put on the bottom
            </b>
          ) : (
            <>
              Hand {state.hand.length} · {landsInHand} land{landsInHand === 1 ? "" : "s"} in hand
            </>
          )}
        </span>
      </div>

      <div className="pt-main">
        <aside className="pt-zones">
          <div className="pt-zone">
            <div className="pt-zone-label">
              Library <span>{state.library.length}</span>
            </div>
            <div
              className="pt-pile pt-pile-library"
              role="button"
              tabIndex={0}
              title="Draw a card"
              onClick={() => act((s) => draw(s, 1))}
              onKeyDown={(e) => e.key === "Enter" && act((s) => draw(s, 1))}
            >
              <span className="pt-pile-count">{state.library.length}</span>
            </div>
            <button type="button" className="pt-zone-action" onClick={() => setPile("library")}>
              Search
            </button>
          </div>
          <PileZone label="Graveyard" cards={state.graveyard} top={state.graveyard[state.graveyard.length - 1]} onOpen={() => setPile("graveyard")} />
          <PileZone label="Exile" cards={state.exile} top={state.exile[state.exile.length - 1]} onOpen={() => setPile("exile")} />
          {(commanderGame || state.command.length > 0) && (
            <div className="pt-zone">
              <div className="pt-zone-label">Command</div>
              {state.command.length ? (
                state.command.map((c) => <PtCard key={c.iid} card={c} zone="command" {...cardProps} />)
              ) : (
                <div className="pt-pile pt-pile-empty" title="The commander is on the battlefield">—</div>
              )}
            </div>
          )}
        </aside>

        <section className="pt-field" onClick={() => setMenu(null)}>
          {state.battlefield.length === 0 ? (
            <div className="pt-empty">
              Click a card in your hand to play it. Click a permanent to tap or untap it. The ⋯ on any card has every other move.
            </div>
          ) : (
            <div className="pt-row pt-row-perms">
              {perms.map((c) => (
                <PtCard key={c.iid} card={c} zone="battlefield" {...cardProps} />
              ))}
            </div>
          )}
          {lands.length > 0 && (
            <div className="pt-row pt-row-lands">
              {lands.map((c) => (
                <PtCard key={c.iid} card={c} zone="battlefield" {...cardProps} />
              ))}
            </div>
          )}
        </section>
      </div>

      <footer className="pt-hand" style={handVars}>
        {state.hand.length === 0 ? (
          <div className="pt-empty">No cards in hand.</div>
        ) : (
          state.hand.map((c) => <PtCard key={c.iid} card={c} zone="hand" {...cardProps} />)
        )}
      </footer>

      {menu &&
        createPortal(
          <ActionMenu menu={menu} options={optionsFor(menu.card, menu.zone)} onPick={act} onClose={() => setMenu(null)} />,
          document.body
        )}
      {zoom && zoomLive && createPortal(<ZoomPreview zoom={zoom} onDismiss={() => setZoom(null)} />, document.body)}

      {pile && (
        <Panel title={`${ZONE_LABEL[pile]} · ${pileCards.length}`} onClose={() => setPile(null)}>
          {pile === "library" && (
            <p className="pt-panel-note">
              Shown in alphabetical order, as a search would. Click a card to move it, then shuffle when you&apos;re done.
              <button type="button" className="pt-btn" style={{ marginLeft: 10 }} onClick={() => act((s) => shuffleLibrary(s))}>
                Shuffle
              </button>
            </p>
          )}
          {pileCards.length === 0 ? (
            <div className="pt-empty">Nothing here.</div>
          ) : (
            <div className="pt-row">
              {pileCards.map((c) => (
                <PtCard key={c.iid} card={c} zone={pile} {...cardProps} />
              ))}
            </div>
          )}
        </Panel>
      )}

      {oddsOpen && (
        <Panel title="Land odds" onClose={() => setOddsOpen(false)}>
          <OddsTable deckSize={deckSize} landCount={landCount} />
        </Panel>
      )}
    </div>
  );
}

/* One card on the table. The primary click is the zone's natural move; ⋯
   opens the full menu; hover (mouse) or 🔍 (touch) shows it large. */
function PtCard({
  card,
  zone,
  onPrimary,
  onMenu,
  onZoom,
}: {
  card: PlayCard;
  zone: Zone;
  onPrimary: (card: PlayCard, zone: Zone, anchor: DOMRect) => void;
  onMenu: (anchor: DOMRect, card: PlayCard, zone: Zone) => void;
  onZoom: (card: PlayCard | null, zone?: Zone, anchor?: DOMRect) => void;
}) {
  return (
    <div
      className="pt-card"
      data-tapped={card.tapped ? "true" : undefined}
      aria-label={card.name}
      onClick={(e) => {
        e.stopPropagation();
        onPrimary(card, zone, e.currentTarget.getBoundingClientRect());
      }}
      onPointerEnter={(e) => {
        if (e.pointerType === "mouse") onZoom(card, zone, e.currentTarget.getBoundingClientRect());
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === "mouse") onZoom(null);
      }}
    >
      <div className="pt-card-inner">
        <CardArt name={card.name} src={card.imageUri || undefined} prefer="src" version="normal" loading="lazy" radius={0} style={{ position: "absolute", inset: 0 }} />
      </div>
      {card.commander && (
        <span className="pt-cmdr" title="Commander">
          ★
        </span>
      )}
      <button
        type="button"
        className="pt-card-btn pt-card-menu"
        aria-label={`${card.name}: more moves`}
        onClick={(e) => {
          e.stopPropagation();
          onMenu(e.currentTarget.getBoundingClientRect(), card, zone);
        }}
      >
        ⋯
      </button>
      <button
        type="button"
        className="pt-card-btn pt-card-zoom"
        aria-label={`Preview ${card.name}`}
        onClick={(e) => {
          e.stopPropagation();
          onZoom(card, zone, e.currentTarget.getBoundingClientRect());
        }}
      >
        🔍
      </button>
    </div>
  );
}

function PileZone({ label, cards, top, onOpen }: { label: string; cards: PlayCard[]; top?: PlayCard; onOpen: () => void }) {
  return (
    <div className="pt-zone">
      <div className="pt-zone-label">
        {label} <span>{cards.length}</span>
      </div>
      <div
        className={`pt-pile${top ? "" : " pt-pile-empty"}`}
        role="button"
        tabIndex={0}
        title={`Open ${label.toLowerCase()}`}
        onClick={onOpen}
        onKeyDown={(e) => e.key === "Enter" && onOpen()}
      >
        {top ? (
          <CardArt name={top.name} src={top.imageUri || undefined} prefer="src" version="normal" loading="lazy" radius={0} style={{ position: "absolute", inset: 0 }} />
        ) : (
          "—"
        )}
      </div>
    </div>
  );
}

function LifeCounter({ label, value, onDelta }: { label: string; value: number; onDelta: (d: number) => void }) {
  return (
    <div className="pt-life" title={`${label} life`}>
      <span className="pt-life-label">{label}</span>
      <button type="button" onClick={() => onDelta(-5)} aria-label={`${label} minus five`}>
        −5
      </button>
      <button type="button" onClick={() => onDelta(-1)} aria-label={`${label} minus one`}>
        −
      </button>
      <span className="pt-life-value">{value}</span>
      <button type="button" onClick={() => onDelta(1)} aria-label={`${label} plus one`}>
        +
      </button>
      <button type="button" onClick={() => onDelta(5)} aria-label={`${label} plus five`}>
        +5
      </button>
    </div>
  );
}

/* The ⋯ menu, anchored to its card. Fixed and portalled to <body> so the
   scrolling battlefield can't clip it; opens upward from the hand row. */
function ActionMenu({
  menu,
  options,
  onPick,
  onClose,
}: {
  menu: MenuState;
  options: { label: string; step: Step }[];
  onPick: (step: Step) => void;
  onClose: () => void;
}) {
  const W = 236;
  const a = menu.anchor;
  const up = a.bottom > window.innerHeight - 320;
  const left = Math.max(8, Math.min(a.left, window.innerWidth - W - 8));
  const place: React.CSSProperties = up ? { bottom: window.innerHeight - a.top + 6 } : { top: a.bottom + 6 };
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 89 }} />
      <div className="pt-menu" style={{ position: "fixed", left, width: W, zIndex: 90, ...place }} role="menu">
        <div className="pt-menu-title">{menu.card.name}</div>
        {options.map((o) => (
          <button key={o.label} type="button" role="menuitem" onClick={() => onPick(o.step)}>
            {o.label}
          </button>
        ))}
      </div>
    </>
  );
}

/* A large, readable copy of a card beside the one under the pointer — to the
   right when there's room, else the left, else centred (phones). Touch opens
   it with 🔍 and dismisses it with a tap anywhere. The copy itself ignores
   the pointer: if it ever overlapped the hovered card it would otherwise
   steal the hover, close, and reopen in a flicker. */
function ZoomPreview({ zoom, onDismiss }: { zoom: Zoom; onDismiss: () => void }) {
  const W = Math.min(300, window.innerWidth - 24);
  const H = Math.round(W * 1.4);
  const a = zoom.anchor;
  const left =
    a.right + 12 + W <= window.innerWidth
      ? a.right + 12
      : a.left - 12 - W >= 0
        ? a.left - 12 - W
        : Math.round((window.innerWidth - W) / 2);
  const top = Math.max(8, Math.min(a.top + a.height / 2 - H / 2, window.innerHeight - H - 8));
  return (
    <>
      <div className="pt-zoom-backdrop" onClick={onDismiss} style={{ position: "fixed", inset: 0, zIndex: 91 }} />
      <div style={{ position: "fixed", top, left, width: W, height: H, zIndex: 92, pointerEvents: "none", animation: "sp-fade .12s ease", borderRadius: "4.8%/3.5%", overflow: "hidden", boxShadow: "0 24px 60px -18px rgba(0,0,0,.9), 0 0 0 1px rgba(255,255,255,.14)", background: "#000" }}>
        <CardArt name={zoom.card.name} src={zoom.card.imageUri || undefined} prefer="src" version="normal" loading="eager" radius={0} style={{ position: "absolute", inset: 0 }} />
      </div>
    </>
  );
}

function Panel({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="pt-panel-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="pt-panel" role="dialog" aria-label={title}>
        <div className="pt-panel-head">
          <span className="id-display" style={{ fontSize: 20, color: "#fff" }}>
            {title}
          </span>
          <button type="button" className="pt-btn" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="pt-panel-body">{children}</div>
      </div>
    </div>
  );
}

/* Hypergeometric land odds for the deck, as the old sample-hand view showed them. */
function OddsTable({ deckSize: N, landCount }: { deckSize: number; landCount: number }) {
  const pct = (p: number) => `${Math.round(p * 100)}%`;
  const rows = [2, 3, 4].map((k) => ({
    k,
    open: hypergeometricAtLeast(N, landCount, Math.min(7, N), k),
    t3: hypergeometricAtLeast(N, landCount, Math.min(10, N), k),
  }));
  const noLand = N >= 7 ? hypergeometric(N, landCount, 7, 0) : 0;
  if (N < 7) return <div className="pt-empty">Not enough cards for odds — you need at least 7.</div>;
  return (
    <div style={{ fontSize: 14, color: "#fff" }}>
      <p className="pt-panel-note" style={{ marginTop: 0 }}>
        {N} cards, {landCount} lands.
      </p>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "right", color: "rgba(255,255,255,.6)" }}>
            <th style={{ textAlign: "left", fontWeight: 500, paddingBottom: 6 }}></th>
            <th style={{ fontWeight: 500 }}>Opening 7</th>
            <th style={{ fontWeight: 500 }}>By turn 3*</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((o) => (
            <tr key={o.k} style={{ textAlign: "right" }}>
              <td style={{ textAlign: "left", padding: "3px 0" }}>≥ {o.k} lands</td>
              <td>{pct(o.open)}</td>
              <td>{pct(o.t3)}</td>
            </tr>
          ))}
          <tr style={{ textAlign: "right", color: "#f0a58a" }}>
            <td style={{ textAlign: "left", padding: "3px 0" }}>0 lands (mull)</td>
            <td>{pct(noLand)}</td>
            <td>—</td>
          </tr>
        </tbody>
      </table>
      <div style={{ fontSize: 12, color: "rgba(255,255,255,.55)", marginTop: 8 }}>*top 10 cards — 7 + three draws, on the draw.</div>
    </div>
  );
}
