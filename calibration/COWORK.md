# Brief: capture a DeckCheck scan as a calibration deck

You are collecting reference data for Spellpool's deck Score. For each deck
below, you will read DeckCheck's scan of it and write one JSON file into
`calibration/decks/` in the `pinzitasalonso/mtg-builder` repository, in the
shape described in `calibration/README.md`. Then run `npm run calibrate` and
paste the deck's section of the report into your summary.

DeckCheck is at https://deckcheck.co. The account is already signed in on
this machine. A scan costs credits; only scan a deck that has no scan yet, and
never re-scan one that does.

## Steps, per deck

1. Open the deck on DeckCheck. Export its decklist (the share / export action
   gives one card per line as `1 Card Name`). Save it as `list`. Put the
   commander(s) first and in `commanders`.
2. Open the CRISPI Score dialog (tap the CRISPI chip). Record the four
   attribute scores and the index into `expected`. Record the bracket it shows.
3. For each attribute, tap the ⓘ and open every *Complete Breakdown*:
   - **Consistency → Tutors & search**: every card with its `+N` → `"tutor": N`.
   - **Consistency → Card draw & selection**: every card with its `+N` → `"draw": N`.
   - **Interaction → Interaction pieces**: every card listed → `"piece": true`.
   - **Interaction → Stack interaction & timing**: every card with its points → `"stack": N`.
     A card in *Interaction pieces* with no stack entry is `"stack": 0`.
   - **Resilience → Combo lines**: copy the line count and each line's cards
     into `notes` as text (e.g. `Dramatic Reversal + Isochron Scepter +1`).
   - **Resilience → Board & rebuild**: recursion cards with their points →
     `"recursion": N`; threats → `"threat": 1` (or 0.5 where it says half).
   - Also record any *RULE APPLIED* box text into `notes`, verbatim.
4. Set `source` to `{"kind": "deckcheck", "scannedAt": "<today>"}`.
5. Save as `calibration/decks/<slug>.json`, run `npm run calibrate`, and copy
   that deck's section of the output into your summary. Do not change any
   code: a mismatch is a finding, not something to fix here.

## Decks to capture

- (list the deck names or DeckCheck URLs here)

## What good looks like

Every card that appears in any breakdown is in `cards`. Points are copied, not
inferred. If a screen is cut off, scroll; if a section is empty on DeckCheck,
leave those keys out rather than guessing.
