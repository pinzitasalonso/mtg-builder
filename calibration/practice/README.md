# Practice benchmark

How fast does the practice opponent win with a real list, and how many of
its turns does it give away? `npm run practice:bench` answers with numbers,
so a change to the planner is measured and not guessed.

It replays seeded games of each list in `decks/` with the built-in planner
(`lib/practice/selfplay.ts`) against a player who does nothing, and prints:

```
Rograkh + Silas Renn (turbo)
  wins by its turn 3:   3%   4:  12%   5:  20%   6:  29%   8:  48%   10:  61%
  half its games are won by turn 9 · idle early turns  26% · lost to itself 0
```

- A turn is the opponent's own turn: its turn 4 is the game's turn 8.
- An idle turn is one of its first five with no spell, ability or combo.
- A seed is the same game every time (`Math.random` is the seed's for the
  game), so two runs differ only where the code does.
- Sixty games is a quick look. A list's numbers move a few points between
  sets of seeds: compare a change over `GAMES=200`.

```
GAMES=200 TURNS=12 DECK=rogsi npm run practice:bench
```

Every game's log goes to `.out/<deck>.txt` (not committed): the opening
hand, then each turn's mana, hand (`*` marks a card it could pay for),
battlefield and what it did. The file starts with the idle turns. Reading
those is how the planner's mistakes are found: a tutor held at 8 life, a
winning pair thrown away by a wheel.

It needs no network: a deck file holds the list, each card's text and the
combos Commander Spellbook lists for it.

## Adding a list

```
ADD="Kinnan, Bonder Prodigy" SLUG=kinnan npm run practice:bench
```

`ADD` is a cEDH archetype as MTGTop8 names it (a commander, or "Partner
UBR" for a pair). It takes that archetype's best recent finish, and reaches
MTGTop8, Scryfall and Commander Spellbook once.

## What it doesn't measure

The smart opponent's turns come from the model, which this doesn't call.
The table plays the planner's line when the model's turn casts nothing, and
plays any win the planner can check, so the planner is the floor under
every match. What the model does above that floor is in the saved matches
(the admin page).
