# Brief for Cowork: calibrate Spellpool's deck Score against DeckCheck

You are running on a Mac with a browser and a terminal. Your job is to keep
Spellpool's deck Score in line with DeckCheck's CRISPI scan, deck by deck and
card by card, without a person in the loop. You pick the decks, capture what
DeckCheck says about them, compare it with what our scorer says, fix the
misreads that are fixable, and open a pull request with the result.

Read this whole brief before you start. The rules in **Never** are absolute.

## Where things are

- Repository: `https://github.com/pinzitasalonso/mtg-builder`. Clone it to
  `~/code/mtg-builder` if it is not already there. `npm install` once.
- The calibration corpus is `calibration/decks/*.json`, one file per deck.
  `calibration/README.md` describes the file shape. Read it.
- `npm run calibrate` scores every deck in the corpus and writes
  `calibration/last-run.md`. It prints, per deck, each axis against the
  reference and every card whose reading differs from DeckCheck's.
- The scorer's card knowledge lives in `lib/deck-score-cards.ts`: named lists
  of cards (`PREMIUM_TUTORS`, `STANDARD_TUTORS`, `NARROW_TUTORS`, `BURST_DRAW`,
  `PREMIUM_DRAW`, `STANDARD_DRAW`, `SELECTION`, `FREE_INTERACTION`,
  `EFFECTIVE_COUNTERS`, `STAX_PIECES`, `HARD_WIPES`, `RECURSION_ENGINES`,
  `FAST_MANA`, `INFINITE_MANA_OUTLETS`, and so on). Each list has a comment
  saying what it means and what points it carries. This file is the only code
  you edit.
- DeckCheck is at `https://deckcheck.co`. The account is already signed in in
  the browser. Its deck library, and any scan already run, are free to read.
  Running a **new** scan costs credits.

## Never

- Never push to `main`. A push to `main` deploys production. Work on a branch
  named `calibration/<YYYY-MM-DD>` and open a **draft** pull request.
- Never edit any file other than `lib/deck-score-cards.ts` and files under
  `calibration/`. The classifier, the goldfish and the rubric maths are not
  yours to change. If a misread cannot be fixed by moving a card between
  lists, it is a finding for the PR body, not a code change.
- Never re-scan a deck on DeckCheck that already has a scan. Never run more
  than **3** new scans in one session. If the account shows fewer than 5
  credits, run no new scans at all and work only with existing ones.
- Never commit `calibration/.cache.json` or `calibration/last-run.md`. They
  are ignored by git; leave them that way.
- Never change a deck file's `expected` or `cards` to make a run pass. Those
  are DeckCheck's numbers. If you think DeckCheck is wrong, say so in the PR
  body and leave the number alone.
- Never enter passwords, buy credits, or change account settings.

## The loop

Do these in order. Stop and write the report (section 6) when any step says
to stop, or after two hours of work, whichever comes first.

### 1. Take stock

```
cd ~/code/mtg-builder
git fetch origin && git checkout -B calibration/$(date +%F) origin/main
npm install
npm run calibrate
```

Read `calibration/last-run.md`. Note which decks fail an axis and which cards
differ. This is your baseline. Keep a copy of the file as
`calibration/baseline.md` for the diff at the end (delete it before you commit).

### 2. Decide which decks need work

Look at every file in `calibration/decks/`:

- **Incomplete captures.** A file with `source.kind` `deckcheck` whose `cards`
  object lists fewer cards than DeckCheck's breakdown shows for that deck is
  incomplete. Open the deck on DeckCheck and count the cards across every
  *Complete Breakdown* (see step 3). If DeckCheck lists a card that the file
  does not, the file is incomplete. Finish those first: they cost no credits.
- **Anchors to replace.** A file with `source.kind` `anchor` has no DeckCheck
  scan behind it, only a rough expected range. If the same list, or one very
  close to it, exists in the DeckCheck library with a scan, capture that scan
  and change the file to a `deckcheck` source. Otherwise leave it.
- **Coverage gaps.** The corpus should span the power range: at least two
  precons or near-precons, two mid-power casual decks, two high-power decks,
  and two cEDH decks, across different colours and plans (combo, combat,
  stax, voltron, reanimator). Count what the corpus has. Where a band is
  short, add a deck from the DeckCheck library that already has a scan. Only
  if the library has no scanned deck in that band, and the credit rules in
  **Never** allow it, scan one: pick a well-known list (a current precon, or
  a list from the cEDH database) and paste it into DeckCheck.

Order of work: incomplete captures, then anchors to replace, then coverage
gaps. Each deck you touch goes through step 3.

### 3. Capture one deck from DeckCheck

For a deck already in the corpus, keep its file and update it. For a new
deck, create `calibration/decks/<slug>.json` with the shape in
`calibration/README.md`.

1. Open the deck on DeckCheck. Export its decklist; the export gives one card
   per line as `1 Card Name`. Save the lines into `list`. Put the commander
   name(s), without a count, first in `list` and also in `commanders`. Front
   face only for double-faced cards.
2. Open the CRISPI Score dialog (the CRISPI chip on the deck page). Copy the
   four attribute scores and the index into `expected` as `consistency`,
   `resilience`, `interaction`, `speed`, `index`. Copy the bracket it shows
   into `expected.bracket`.
3. For each attribute, open the ⓘ and every *Complete Breakdown* section.
   Scroll until the list ends. Record every card you see:
   - *Consistency → Tutors & search*: the card and its `+N` → `"tutor": N`.
   - *Consistency → Card draw & selection*: the card and its `+N` → `"draw": N`.
   - *Interaction → Interaction pieces*: every card listed → `"piece": true`.
   - *Interaction → Stack interaction & timing*: the card and its points →
     `"stack": N`. A card that is a piece but has no stack entry gets
     `"stack": 0`.
   - *Resilience → Board & rebuild*: recursion cards with their points →
     `"recursion": N`; threats → `"threat": 1`, or `0.5` where it says half.
   - *Resilience → Combo lines*: copy the line count and each line's cards as
     text into `notes`, one line per combo, for example
     `Dramatic Reversal + Isochron Scepter (+1)`.
   - Any *RULE APPLIED* box: copy its text into `notes` verbatim.
4. A card in the deck that DeckCheck does **not** list under a section is not
   recorded for that section. Do not write zeros for cards it never mentions.
   The exception is `"stack": 0` for a piece with no stack points, as above.
5. Set `source` to `{ "kind": "deckcheck", "scannedAt": "<the scan date shown
   on DeckCheck>", "url": "<the deck's DeckCheck URL>" }`.
6. Save the file. Run `npm run calibrate` and confirm the deck appears in
   `last-run.md` with no *Unresolved on Scryfall* line. If a card is
   unresolved, the name is misspelled or is a back face; fix the spelling in
   `list` and rerun.

Points are copied, never inferred. If a screen is cut off, scroll. If a
section is empty on DeckCheck, write nothing for it.

### 4. Learn from the diffs

Run `npm run calibrate` and read `last-run.md`. For every line marked `✗`
under *Cards checked*:

1. Find the card in `lib/deck-score-cards.ts`. Read the comment on the list it
   is in, and on the list its DeckCheck points suggest. The comments name the
   points each list carries, so a card DeckCheck scores at 6 tutor points
   belongs in the 6-point list.
2. Decide whether DeckCheck's reading follows the rubric the comments
   describe. It usually does. If it clearly does not (a 4-point tutor scored
   at 8 on one deck and 4 on another), leave our reading alone and note the
   card in the report.
3. If it does, move the card: add its exact printed name to the right list,
   and remove it from the wrong one if it is there. One card per change. Keep
   the list alphabetical if it already is.
4. Rerun:
   ```
   npx tsc --noEmit && npx vitest run && npm run calibrate
   ```
   All three must pass. Compare `last-run.md` with your baseline. The change
   is kept only if: the card now matches, no other card in any deck stopped
   matching, and no deck's axis moved further from its reference. Otherwise
   revert the change with `git checkout lib/deck-score-cards.ts` and note the
   card as *not fixable by the cards file*.
5. Commit each kept change on its own:
   ```
   git commit -am "Read <Card Name> as <what it is now> (DeckCheck: <deck>)"
   ```

An axis failure with no card diffs behind it, for example Speed reading two
points below DeckCheck on a deck whose cards all match, is **not** yours to
fix. It belongs to the goldfish or the rubric, which you do not edit. Record
it in the report with the deck, the axis, both numbers, and the fundamental
turn our run printed.

Stop this step when there are no `✗` card lines left that you can act on, or
after 20 card changes in one session.

### 5. Commit the captures and open the PR

```
rm -f calibration/baseline.md
git add calibration/decks
git commit -m "Calibration: capture <deck names> from DeckCheck"
git push -u origin calibration/$(date +%F)
```

Open a **draft** pull request against `main` titled
`Calibration <YYYY-MM-DD>`. Its body is the report from section 6. Do not
merge it, do not mark it ready, do not request review. A person will.

If nothing changed, meaning no decks captured and no cards moved, do not
open a PR; just write the report.

### 6. The report

Write it as Markdown, in this order, and keep it short. It goes in the PR
body and in your final message.

1. **Decks captured or updated**: name, DeckCheck index and the four
   attributes, how many cards recorded, and whether it was an existing scan
   or a new one. Credits used this session.
2. **Cards fixed**: one line each, `Card → list (was list)`, with the deck
   that showed it.
3. **Cards not fixable by the cards file**: card, our reading, DeckCheck's,
   and why moving it broke something else or why DeckCheck looks wrong.
4. **Axes still out of tolerance**: deck, axis, ours vs DeckCheck, and the
   fundamental turn where the axis is Speed.
5. **Corpus coverage**: how many decks per power band now, and which band is
   still short.
6. **The full `last-run.md`** at the end, in a collapsed `<details>` block.

## What good looks like

Every card that appears in any DeckCheck breakdown is in the deck file's
`cards`. Every change to `lib/deck-score-cards.ts` is one card, has a commit,
and left every other deck where it was or closer to DeckCheck. The PR body
says what is still wrong and whose it is to fix. Nothing was pushed to `main`
and no credits were spent that the rules did not allow.
