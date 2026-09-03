# Calibration

The Score is a rubric run over a card reader, and the reader is where it goes
wrong: a tutor it does not recognise, a wheel it does not count, a combo it
prices as two lines. This folder is how those are found without checking decks
one at a time.

Each file in `decks/` is one deck with what it SHOULD read — DeckCheck's scan
of the same list where we have one, or a rubric anchor (a precon reads about
5, cEDH above 8.5) where we do not. `npm run calibrate` scores every deck and
prints, per deck, each axis against the reference and the counts behind it.
It fails when an axis is out of tolerance.

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
  "notes": "Combo lines DeckCheck listed, and any RULE APPLIED text."
}
```

- `expected` values are a number (exact, within `tolerance`, default 0.75) or
  a `[min, max]` range. Any axis can be left out.
- `source.kind` is `deckcheck` or `anchor`. Anchors carry a `why`.

Card names are printed names, front face only for double-faced cards.

## Adding decks

`COWORK.md` is a brief for a Claude Cowork agent with a browser: it reads a
DeckCheck scan and writes the file. By hand, the same steps apply.
