# Calibration

The Score is a rubric run over a card reader, and the reader is where it goes
wrong: a tutor it does not recognise, a wheel it does not count, a combo it
prices as two lines. This folder is how those are found without checking decks
one at a time.

Each file in `decks/` is one deck with what it SHOULD read — DeckCheck's scan
of the same list where we have one, or a rubric anchor (a precon reads about
5, cEDH above 8.5) where we do not. `npm run calibrate` scores every deck and
prints, per deck, the axis deltas and every card whose reading differs from the
reference. It fails when an axis is out of tolerance.

It hits Scryfall and Commander Spellbook, cached in `.cache.json` after the
first run, so it stays out of `npm test`.

## A deck file

```json
{
  "name": "Braids, Conjurer Adept (mono-blue combo)",
  "source": { "kind": "deckcheck", "scannedAt": "2026-09-02" },
  "commanders": ["Braids, Conjurer Adept"],
  "list": ["Braids, Conjurer Adept", "1 Ancient Tomb", "27 Island", "..."],
  "expected": {
    "index": 7.88, "consistency": 6, "resilience": 9.75, "interaction": 8.75, "speed": 7,
    "bracket": 4
  },
  "cards": {
    "Mystical Tutor": { "tutor": 6 },
    "Rhystic Study": { "draw": 5 },
    "Counterspell": { "piece": true, "stack": 3 },
    "Back to Basics": { "piece": true, "stack": 0 }
  }
}
```

- `expected` values are a number (exact, within `tolerance`, default 0.75) or
  a `[min, max]` range. Any axis can be left out.
- `cards` is the real-world proof: the per-card points DeckCheck shows under
  each attribute's *Complete Breakdown*. `tutor` and `draw` are the points it
  gave; `piece` is whether it counted the card as interaction and `stack` its
  stack/timing points; `recursion` its recursion points; `threat` 1 or 0.5.
  Cards not listed are not checked. A card DeckCheck did NOT count in a
  section is recorded as 0 (or `piece: false`) so we learn not to count it
  either.
- `source.kind` is `deckcheck` or `anchor`. Anchors carry a `why`.

Card names are printed names, front face only for double-faced cards.

## Adding decks

`COWORK.md` is a brief for a Claude Cowork agent with a browser: it walks a
DeckCheck scan's screens and writes the file. By hand, the same steps apply.
