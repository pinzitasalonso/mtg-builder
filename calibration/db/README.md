# calibration.db

The corpus was five decks, which is too few to tell a card misread from a
rubric disagreement. This is the substrate that makes the difference visible:
the whole card universe, how our own classifier reads every card in it, the
curated lists as data, and the corpus decks scored against their references —
in one SQLite file you can query.

```
calibration/db/build.sh                     # downloads Scryfall bulk, builds calibration.db
calibration/db/build.sh path/to.db oracle.jsonl   # or point it at a file you already have
```

Roughly three minutes end to end, ~17 MB out. The file is gitignored; the
scripts that produce it are not, so anyone can rebuild it.

## What is in it

| table | rows | what it is |
|---|---|---|
| `cards` | ~34.5k | every non-token card in Scryfall's oracle export, 31.8k commander-legal |
| `card_reads` | ~34.5k | how `deck-score-classify.ts` and `goldfish.ts` read each card **in isolation** — tutor tier, draw tier, interaction roles, threat, recursion, and the goldfish's mana read |
| `list_membership` | ~900 | the 22 curated lists in `deck-score-cards.ts`, exploded to (card, list) |
| `mana_output` | 49 | `MANA_OUTPUT`, the only mana table the goldfish actually consults |
| `defects` | ~1.4k | rule-driven findings, one row per (card, rule) |
| `decks`, `deck_cards`, `deck_scores`, `deck_metrics` | 5 / 439 / 30 | the corpus, our axes, and the reference each is scored against |

`queries.sql` holds the questions worth asking, including the ones that
produced the findings below.

## Why it exists

Three things fell out of it that reading the source did not surface.

**`FAST_MANA` has no consumers.** Sixty-eight curated cards, imported by
nothing. Only `MANA_OUTPUT` reaches the goldfish, and the two lists have
drifted: 41 cards are in `FAST_MANA` with no `MANA_OUTPUT` row, 20 the other
way. That drift is invisible precisely because half of it is dead code.

**Being on a curated list is inert for 82 cards.** The file's header promises
that "when a score looks wrong for a named card, the fix belongs in this
file". For these it does not, because several paths in
`deck-score-classify.ts` consult the list only *after* a text regex has
already returned. `drawReading` is the clearest case: an instant or sorcery
whose draw is not on the first line hits `return null` before the
`ONE_SHOT_DRAW` fallback is ever reached, so Village Rites, Deadly Dispute
and ten others score zero draw points while sitting in the list meant to fix
exactly that.

**The MDFC name lookup drops 825 commander-legal cards.**
`collectionByName` keys its map by the name Scryfall returns rather than the
name requested, so every modal double-faced card resolves and is then thrown
away. Join `defects` to `deck_cards` and you can watch it happen inside the
corpus: Prosper's three unresolved cards are exactly its three MDFCs.

## Reading the numbers honestly

`card_reads` is a card in isolation. Several readings are context-dependent
by design — `symmetricWipe` is judged against the deck's creature count, the
graveyard tutors only score with a recursion package — so a per-card row is
the classifier's opinion before the deck gets a vote. Treat single rows as a
lead and the aggregates as the evidence.

Nothing here is derived from any third-party scoring service. `deck_scores`
carries reference numbers only for decks already cited in
`calibration/decks/`.
