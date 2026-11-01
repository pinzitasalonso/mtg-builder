# Practice games against the AI

A practice opponent for the playtest: you play your deck against a real
deck that the AI pilots. It is a table, not a rules engine. You play your
side by hand, as in the solo playtest. The app keeps the bookkeeping that
makes a game work: turns, mana, combat and life. The AI decides what its
side does.

## What it is, and what it isn't

- **It is**: two players, two decks, a real opponent deck (a recent
  tournament list from MTGTop8, a cEDH commander's list, EDHREC's average
  deck for any commander, or one of your own decks), and an opponent that plays lands, casts spells it can pay for,
  targets your things, attacks and blocks.
- **It isn't**: a full rules engine. The opponent acts on its own turn and
  when blocking. It does not respond at instant speed on your turn. Card
  text the app can't model becomes a note for you to resolve ("Resolve:
  each player sacrifices a creature"), as you would at a real table.

## The pieces

1. **The engine** (`lib/practice/`, pure and tested). Two sides, each the
   solo playtest's zones. It adds the turn, whose turn it is, a land drop,
   summoning sickness, damage marked on creatures, +1/+1 counters, tokens,
   commander tax and commander damage. It works out:
   - **Mana**: the untapped sources and the colours each makes, from
     Scryfall's `produced_mana` and the card text ("Add {C}{C}" is two).
     It pays a cost by its colours first, then the generic part.
   - **Casting**: what's castable now (in hand or the command zone, with a
     land drop left for lands).
   - **Effects**: a small vocabulary the AI's plan is written in: damage,
     life, destroy, exile, bounce, tap/untap, draw, discard, mill, tokens,
     counters, pump until end of turn, search the library, and a note. Every
     target is checked. Anything that isn't a legal target is skipped and
     logged.
   - **Combat**: attackers (not summoning sick, haste aside; vigilance
     doesn't tap), blocks that respect flying/reach, menace and "can't be
     blocked", then damage with first strike, double strike, deathtouch,
     trample, lifelink and indestructible. Commander damage counts toward
     21.
   - **The end**: life at 0 or less, 21 commander damage, or drawing from
     an empty library.

2. **The opponent's brain** (`/api/practice/<id>/turn`). One model call per
   opponent turn, at low effort for speed. The engine
   does the counting first, so the model only decides:
   - the prompt lists the opponent's hand with what's castable and its mana
     right now, both boards with power/toughness and keywords, life totals
     and the turn;
   - the answer is a JSON plan, enforced by the API's structured outputs:
     a land, spells in order with their targets and effects, attackers,
     spells after combat, and one line of table talk;
   - the rules and the opponent's decklist (with card text) are a cached
     prefix, so only the board is new each turn.

   If the model fails, refuses or is slow, a built-in planner takes the
   turn: a land, the most expensive permanents it can pay for, and safe
   attacks. The game never stalls.

3. **Blocking** is decided by the app, not the model. It's instant and
   free. The opponent blocks to survive, blocks when its creature kills the
   attacker and lives, and trades when the attacker is worth more.

4. **Opponents** (`/api/practice/opponents`):
   - a constructed deck: the format's top archetypes on MTGTop8 (their best
     recent list);
   - a Commander deck: any commander you search for, playing EDHREC's
     average deck for it (`lib/edhrec.ts`, `/api/practice/commander`),
     overall or for one bracket. The bracket your deck scanned at is picked
     first, and a bracket with no decks falls back to the overall average.
     Also cEDH's most played commanders, and your own other Commander decks;
   - any deck: a mirror match, and your other decks of the same format.

5. **Limits**: AI routes need an account. Starting a game counts: free
   accounts get a few practice games a day (`FREE_PRACTICE_PER_DAY` in
   `lib/limits.ts`), Pro is unlimited. Each game allows a fixed number of
   AI turns (`PracticeGame.turns`), so a game can't run up the bill.

6. **The table** (`components/deck/PracticeTable.tsx`, opened from the
   playtest's "vs AI"):
   - top: the opponent's life, hand (card backs), library, graveyard and
     its battlefield;
   - middle: the log, and the opponent's line of table talk;
   - bottom: your side, as in the solo playtest;
   - a bar of the moves that make sense right now: Attack, End turn,
     Confirm blocks, and "Opponent is thinking…" while it plans.

   You can act on the opponent's cards from their ⋯ menu (destroy, exile,
   return to hand, tap) to resolve your own spells.

   **Phones play it sideways**, like the solo table (the `.pt-table`
   landscape block in `app/globals.css`). One bar on top; each side is one
   row of cards that scrolls sideways, with its counts in a column to its
   left; the hand is a strip of card tops that a tap raises over the board
   (`HandToggle`). A web page can't turn an iPhone's screen, so held upright
   the table shows "Turn your phone sideways" (`RotateHint`); on Android the
   playtest opens fullscreen and locked to landscape (`useLandscapeLock`).
   The opponent picker works either way.

## Order of work

1. Engine, with tests.
2. Server: opponents, start (deck loading, card facts, the limit), the
   turn (prompt, schema, sanitising the plan, the fallback), with tests.
3. The table.
4. End to end on a production build, with a stub model playing scripted
   plans, at phone and desktop sizes.
