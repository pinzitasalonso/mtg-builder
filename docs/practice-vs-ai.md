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
- **It isn't**: a full rules engine. On your turn the opponent only blocks
  and answers your spells with its hard counterspells (below); nothing
  else of its happens at instant speed. Card
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
   opponent turn, at medium effort (the model's default: it thinks the turn
   through). The engine does the counting first, so the model only decides:
   - the prompt lists the opponent's hand with what's castable and its mana
     right now, both boards with power/toughness and keywords, life totals
     and the turn;
   - the answer is a JSON plan, enforced by the API's structured outputs:
     a land, spells in order with their targets and effects, attackers,
     spells after combat, and one line of table talk;
   - the rules and the opponent's decklist (with card text) are a cached
     prefix, so only the board is new each turn.

   If the model fails, refuses or is slow, a built-in planner takes the
   turn: a land (the colour the hand needs, untapped), the most expensive
   permanents it can pay for, spells that only draw, and safe attacks. The
   game never stalls. Admin counts both kinds of turn ("Practice turns by
   the AI" / "by the fallback"); the server log says why a turn fell back.

   **Mana the engine handles for the AI**, so the model never has to:
   - fetch lands crack the moment they're played, for the land that suits
     the hand best (the colours it's missing, untapped); shock lands enter
     untapped for 2 life while the AI is above 6;
   - one-shot sources (Lotus Petal) are tapped last and sacrificed;
   - a ritual's mana is a `mana` effect: it floats until the end of the
     phase and is spent before any land is tapped.

   **Counterspells.** A hard counter in the AI's hand (`counterOf`: "counter
   target … spell", not "unless its controller pays") answers your spell
   the moment you cast it (`aiResponds`), if it can hit that spell, the
   spell is worth a card (mana value 2 or more, your commander, or exactly
   what the counter was made for, like Mental Misstep on a one-drop), and
   the AI left the mana open. Free versions count: Fierce Guardianship with
   its commander out, Force of Will pitching a blue card at a spell of 4 or
   more. A countered commander goes back to the command zone. The brief
   marks counterspells so the model knows to hold mana for them.

3. **Blocking** is decided by the app, not the model. It's instant and
   free. The opponent blocks to survive, blocks when its creature kills the
   attacker and lives, and trades when the attacker is worth more.

4. **Opponents** (`/api/practice/opponents`, `lib/practice/opponents.ts`,
   `components/deck/OpponentPicker.tsx`). Every opponent is a tile with a
   card's art and its colours, in tabs:
   - **For your deck** (a Commander deck): a few of the year's most played
     commanders on EDHREC, a different few each day, each playing EDHREC's
     average deck (`lib/edhrec.ts`);
   - **Any commander**: a search that only offers cards that can be a
     commander (`/api/practice/commanders`), the most played first;
   - **cEDH / Tournament**: the format's top archetypes on MTGTop8, each with
     its best recent list. A cEDH partner pair is named by its commanders
     ("Kraum + Tymna", not "Partner WUBR"). A tile's picture needs that list
     (two MTGTop8 pages), so those are fetched behind the first answer and
     the picker asks again while `more` is true;
   - **Your decks**: a mirror match, and your other decks of the format.

   The last few opponents a deck played are offered on top ("Play again":
   `PracticeGame.deck` and `.opponent`). Picking a tile doesn't start the
   game: it goes to a bar at the foot with **Play**. For a commander the bar
   asks which bracket (`/api/practice/commander`), with the deck's own Score
   bracket picked first; a bracket with no decks falls back to the overall
   average. A free account sees its games left today before it spends one.

   The deck page opens the picker directly ("vs AI" in its header, "Play vs
   AI" in Tools), so it's reachable on a phone held upright; the solo
   playtest's "vs AI" still leads there too.

5. **Limits**: AI routes need an account. Starting a game against the AI
   counts: free accounts get one a day (`FREE_PRACTICE_PER_DAY` in
   `lib/limits.ts`), Pro is unlimited. Each game allows a fixed number of
   AI turns (`PracticeGame.turns`), so a game can't run up the bill.

   **The basic bot** is the other pilot (the picker's bar: "AI" or "Basic
   bot"): the built-in planner plays every turn, in the browser, with no
   model call. Those games are free and unlimited (`PracticeGame.bot`; they
   aren't counted, and don't count), and they're what a free account plays
   once its day's game is spent.

   **A turn with nothing to decide** skips the model too (`simpleTurn` in
   `lib/practice/ai.ts`, asked by the turn route before it spends a turn):
   after its land drop the opponent can cast nothing, has no creature that
   could attack, and controls nothing with an ability to use. Early turns
   are mostly these, and they're played at once.

   **Resume.** The game lives in the browser, so it's kept there
   (`lib/practice/save.ts`, localStorage, one per deck) at each steady
   point: your mulligan, your turn as it stands, and the start of the
   opponent's turn. A reload or a closed tab loses nothing: the picker
   offers "A game in progress… Resume". Picked up in the opponent's turn,
   that turn is played again from its start. A finished game is forgotten.

   **Results.** When a game ends the table reports it once
   (`/api/practice/<id>/result`: `result` "won" or "lost", `endTurn`), and
   the deck's record (wins and losses against the AI) shows in the picker
   and on the end-of-game banner. "Concede" (on your turn) ends a game as
   a loss.

   **The review.** "Review the game" on a finished game
   (`/api/practice/<id>/review`, `lib/practice/review.ts`): the model reads
   the player's decklist, the result, the final board and the log, and
   writes what decided it, what the deck did well and lacked, and a change
   or two to try. Streamed, then kept on the game (`PracticeGame.review`),
   so asking again costs nothing. It's part of a game against the AI; for
   a bot game it spends one of the day's AI questions.

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

   **Your side's helpers** (you're still the rules; Undo takes any of it back):
   - your casts are tapped for (`playerCast`): the lands a spell needs, then
     a Treasure; not a card with another way to be cast (Force of Will), nor
     one you can't pay for, and X is left to you;
   - a tutor you cast, or a creature that searches as it enters
     (`searchOnCast`), opens a search of your library showing only what it can
     find, and each pick goes where the card says (hand, battlefield tapped,
     or on top after the shuffle); a permanent's search ability (a fetch
     land, Evolving Wilds: `searchAbility`) is in its ⋯ menu, with its tap,
     life and sacrifice paid;
   - Token makes Treasures, Food, Clues and creature tokens (a Treasure pays
     mana); any creature's ⋯ menu adds +1/+1 or -1/-1 counters.
   - Scry, next to Draw (on both tables: `ScryPanel`, `scry` in
     lib/playtest): pick how many, tap a card to send it to the bottom,
     arrows for the order. The log says how many went where, never which
     (the AI reads the log).

   **Answering each other.** The opponent's casts are staged (`applyAction`
   with `stage`: "pay", then "resolve" or "counter"). When it casts a spell
   and you could answer (an instant or flash card you can pay for, or one
   with another way to cast it), the table pauses: "Counter with X" for each
   counterspell in your hand that can hit it, your other instants castable
   from your hand, or "Let it resolve"; "Don't ask again" stops the pauses
   for the game. On your turn the AI answers too, beyond counters
   (`aiRemovalAction`): instant removal (destroy, exile, return to hand,
   damage: `removalOf`) at your biggest attacker (power 3+, or everything
   when the attack is lethal) before it blocks, and at your biggest threat
   (power 4+, or your commander) at the end of your turn; you can answer
   that the same way. When the game ends, the banner names what it held and
   "Its hand" shows the cards.

   **Borrowed from Arena**, so the table reads at a glance:
   - every opponent spell is shown big in the middle while it's cast (paid,
     then resolved a moment later), its target pulsing red; while it waits
     for your answer it stays up, with your answer's buttons right under it
     (beside it on a phone held sideways);
   - what you can do glows: on your turn the cards you can afford and a
     land while your drop is there; when answering or blocking, the
     instants and flash cards you can afford; when attacking, the creatures
     that can;
   - a life total that changes flashes, and the difference floats from it;
   - the opponent's end step stops for you when you could cast an instant
     ("Go to my turn" to move on; "Don't ask again" ends the stops).

   Where there's room (a wide screen, or a phone held sideways) a column
   runs the full height beside the board and the hand: the opponent's
   table talk, **Last played** (the latest spells cast by either side, like
   the stack; a tap shows the card large) and the **History**. Nothing sits
   between the boards then. The log lines carry the card they're about.

   Both halves are laid out the same: each side is one line, its
   permanents and then its lands, the lands in one pile (each on top of the
   one before, a thin strip of the one below showing), so they take about a
   card's width however many there are. A crowded line shrinks its cards a
   little to fit, down to 85% (CSS container units
   on `.pt-side-cards`, with `--pt-slots` from the table), before it wraps
   or, on a phone, scrolls. The opponent's half has a slightly warmer
   ground. Its graveyard and commander sit in the column of piles at the
   left, above yours, with its hand, library and exile as counts; where
   that column is hidden (a narrow screen, a phone held sideways) each side
   has a head of counts at its left instead. A commander in the command
   zone is dimmed until it's cast, and shows its tax.

   **Abilities the table carries out** (read from the card's text, so any
   card worded the same way works, on either side):
   - "For each {B} in a cost, you may pay 2 life rather than pay that mana"
     (K'rrik): your casts pay with mana first and 2 life for each {B} the
     mana can't cover, never the life you have left (`youPay`; a card you
     could pay that way glows); the AI does the same, but never below the
     power of your creatures plus one (`lifeFor`, `payCost`'s `lifeFor`);
   - "Whenever you cast a … spell" (`castTriggerOf`): +1/+1 counters on
     itself (K'rrik), damage or life loss to each opponent (Vivi), life,
     a card, a creature token, and prowess, when the spell is cast (a
     countered spell still triggers);
   - Kefka, Court Mage as it enters or attacks (`discardTriggerOf`): the AI
     discards what it would rather lose (a spare land, else its priciest
     card), you pick yours (the game's `choice`: your hand glows and the
     table waits), then Kefka's controller draws one card for each card
     type discarded;
   - "{8}: Each opponent sacrifices a permanent of their choice. Transform
     Kefka" (`edictOf`): the AI uses it (the model, or the planner when it
     has the mana) and you pick what you sacrifice; yours is in Kefka's ⋯
     menu, and the AI gives up a token, a spare land, or its cheapest
     card. Kefka turns over, with its back's stats (`CardInfo.back`) and
     keywords: a double-faced card has only the keywords of the face that's
     up;
   - "Whenever an opponent loses life during your turn, you draw that many
     cards" (Kefka, Ruler of Ruin): every life loss goes through `loseLife`
     (damage, payments, drains, the life buttons);
   - "During your turn, Kefka has indestructible" (Kefka, Dancing Mad).
     Its end-step exile and free casts are left to you.
   - Ninjutsu and commander ninjutsu (Yuriko: `ninjutsuOf`): once blocks
     are in, a ninja you could bring in (from your hand, or the command
     zone for commander ninjutsu, paid from your untapped mana) stops the
     attack with "Ninjutsu X for Y" buttons and "To damage"; the ninja
     glows, and clicking it takes your weakest unblocked attacker. The AI
     does it after your blocks (`aiNinjutsu`): a ninja with a hit trigger
     first, for its least valuable unblocked attacker. Ninjutsu isn't a
     cast: no commander tax, no counterspell;
   - "Whenever a Ninja you control deals combat damage to a player"
     (`hitTriggersOf`): Yuriko's reveal (the card goes to its owner's hand
     and the other player loses its mana value) and a card (Ingenious
     Infiltrator), and a creature's own "deals combat damage to a player,
     draw a card".
   More commanders, read the same way (`lib/practice/abilities.ts`), on
   both sides unless it says otherwise:
   - **Winota**: each non-Human attacker looks at the top six; the best
     Human (priciest) comes in tapped and attacking, indestructible this
     turn (`eot` keywords); the rest go to the bottom at random. Picked for
     you too.
   - **Vivi**'s {0} mana (X = its power, your turn, once a turn) and
     **Selvala**'s {G},{T} (X = your greatest power, a {G} source paying
     the {G}) are mana sources (`availableMana`): they make all X at once
     and what a payment leaves floats (`Source.float`, pool units like
     "UR"). Selvala also draws for a creature entering bigger than every
     other. Thranduil the Strategist's Elves tap for {G} or {U}.
   - **Braids, Arisen Nightmare**: at your end step you're asked to
     sacrifice (or "Don't sacrifice"); the AI then gives up a token, a copy
     or a spare land (with six or more), else loses 2 and you draw. At the
     AI's end step it sacrifices such fodder and you answer the same way,
     with "Lose 2 life" (`playerEndStep`, `aiEndStep`, `declineChoice`).
   - **Rograkh** is its keywords (first strike, menace, trample);
     **Silas Renn** hitting lets its controller cast the priciest artifact
     in its graveyard this turn (`mayCast`: yours shows "Cast it" in its
     menu; the AI casts it after combat: `aiGraveyardCasts`).
   - **Witherbloom, the Balancer**: affinity for creatures, for itself and
     your instants and sorceries; **Beledros Witherbloom**: a Pest every
     upkeep, and "Pay 10 life: untap your lands" (its menu; once a turn).
     Costs go through `spellCost` (tax, affinity, "<kind> spells cost {1}
     less", The Ur-Dragon's eminence from the command zone).
   - **Inalla**: a nontoken Wizard entering gets a hasty copy for {1}
     (paid for you), exiled at the end step; the AI's copy repeats the
     plan's enters effects, yours asks you to resolve its enters ability.
     "Tap five Wizards: lose 7" is in Inalla's menu; the AI uses it at its
     end step whenever it can.
   - **Light-Paws** and Auras: Auras attach (`attachedTo`; one that loses
     its creature goes to the graveyard) and give their bonus
     ("Enchanted creature gets +2/+2 and has flying"). Your Aura asks for
     its creature (a `choice`), then Light-Paws opens a search for an Aura
     no pricier with a new name, which goes on Light-Paws. The AI's Aura
     goes on its plan's target, a curse on your best creature, otherwise
     Light-Paws or its commander, and Light-Paws searches for it.
   - **Thranduil**: lords ("Other Elves you control get +1/+1"), landfall
     Elf tokens, the Strategist's mana, and the Elvenking's draw two and
     discard one (you pick, as a loot) when another legendary Elf enters.
   - **The Ur-Dragon**: Dragons cost {1} less, from the command zone too;
     attacking Dragons draw that many, then a permanent from the hand comes
     in (the AI's priciest; you choose, or "None").
   - **Kratos, God of War**: all creatures have haste; at each end step,
     each creature its player controls that didn't attack deals 1 to them
     (`attacked`).
   Lords, Auras and "all creatures have" are worked out again after every
   move (`refreshStatics` in `checkState`) into each card's `boost`.

   **The triggers most decks are full of** (`lib/practice/triggers.ts`),
   on either side, for any card worded this way:
   - when it **enters** or **attacks** (Baleful Strix, Breya, Omnath);
   - at **your upkeep** or **your end step** (Phyrexian Arena, Oloro);
   - **landfall**; a **creature entering**, with its conditions ("with
     power 4 or greater": Garruk's Uprising, Temur Ascendancy; "with
     defender": Arcades; any creature: Soul Warden);
   - **another creature dying** (Zulaport Cutthroat);
   - **an opponent drawing**: Nekusar's damage, and Smothering Tithe's
     Treasure; the Draw button counts (`playerDraws`);
   - **an opponent casting**, unless they pay (Rhystic Study, Esper
     Sentinel: `castTaxes`). Mystic Remora is left alone: its cumulative
     upkeep isn't kept.

   **Paying, or not, is yours to decide.** When the AI's card says "unless
   that player pays", the table asks: "Rhystic Study: pay {1}, or the
   opponent draws a card", with **Pay {1}** and **Don't pay**
   (`PracticeGame.taxes`, `payTax`, `declineTax`). Smothering Tithe asks
   for each card you draw, and you can pay for some of them. There's
   nothing to ask when you couldn't pay: it happens at once. A payment left
   unanswered when the turn ends wasn't made. The AI decides for itself:
   it pays Rhystic Study when it has the mana left after its spell, and
   never pays Smothering Tithe.

   One rule keeps it honest: a trigger is carried out only when the table
   can do **all** of what it says. Its vocabulary is small: draw, gain or
   lose life, each opponent loses life, damage to each opponent, +1/+1
   counters on itself, creature tokens with keywords, Treasure, Food and
   Clue. Anything else in the sentence ("for each…", "if you control…", a
   target) and the trigger is left to you, or to the model's plan, as
   before. Two triggers of one kind on a card are both left alone.

   **Removal** the AI casts on your turn (`removalOf`) reads the wider
   targets a creature fits: a permanent (Beast Within, Generous Gift,
   Assassin's Trophy), a nonland permanent (Anguished Unmaking, Void Rend),
   an artifact or creature (Putrefy), a mana value (Despark). What its
   controller gets is carried out when the table can: Beast Within's 3/3,
   Swords to Plowshares' life.

   **The built-in planner** (the basic bot, and any turn the model misses)
   also casts ramp spells that only find lands (Cultivate, Kodama's Reach,
   Rampant Growth, Farseek, Nature's Lore, Three Visits: each land goes
   where the card puts it, the colour it's missing first), and uses a
   sorcery to remove your biggest threat. Its instants wait for your turn.

   The model is told which of its deck's cards these are, so its plan
   leaves them out (`automatedNotes`); a plan's discard for Kefka's entry
   is dropped anyway.

   A modal card with a land on its back (Shatterskull Smashing) is played
   by the face that's up, on both sides: clicked, it's cast; turned over
   first, it's your land. The AI can do either, and its land goes in land
   side up.

   When the built-in planner plays a turn, the note says why in a few words
   ("the AI took too long", "AI error 529", "no answer in time"), so a
   player can report it.

   **With a mouse** (a computer: not a phone, not a tablet) the table is
   laid out for the board. The hand is a strip of card tops along the foot:
   a card rises whole when the mouse is on it, and a crowded hand overlaps
   to fit (`.pt-hand:not([data-up])` in `globals.css`; the mulligan, and a
   choice from your hand, show it whole). Each side's life sits under its
   name in the piles column, large, instead of in the top bar. The bar says
   whose turn it is and where in it: Main, Combat, Main 2, End
   (`phaseStep` in the table).

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
