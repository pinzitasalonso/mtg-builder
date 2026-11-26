// Which instants and sorceries the table can carry out by itself, and how.
// A spell it doesn't know is left to the model's effects, and the built-in
// planner never casts it: for a competitive list those are dead cards.
// (calibration/practice/coverage.bench.ts lists them for the benchmark's decks.)

import { counterOf, removalOf, wheelSpellOf } from "./cards";
import { drawSpellOf, pumpSpellOf, tutorOf, wipeOf } from "./spells";
import { treasureSpellOf } from "./treasure";
import type { PlayCard } from "../playtest";
import type { CardBook, CardInfo } from "./types";
import { adNauseamOf, burnOf, extraTurnOf, impulseOf, landsForManaOf, libraryExilerOf, ritualMana } from "./wincons";

/** What the table knows a spell as, or null when it knows nothing of it. */
export function spellKnown(info: CardInfo, book: CardBook): string | null {
  const card: PlayCard = { iid: 0, name: info.name, imageUri: "", typeLine: info.typeLine, tapped: false, commander: false };
  if (tutorOf(info)) return "tutor";
  if (drawSpellOf(info)) return "draw";
  if (ritualMana(info, { graveyard: 0, ritesInGraveyards: 0, foeHand: 1 })) return "ritual";
  if (landsForManaOf(info)) return "lands for mana";
  if (impulseOf(info)) return "impulse";
  if (libraryExilerOf(info)) return "library exiler";
  if (adNauseamOf(info)) return "ad nauseam";
  if (extraTurnOf(info)) return "extra turn";
  if (wheelSpellOf(book, card)) return "wheel";
  if (treasureSpellOf(book, card)) return "treasures";
  if (wipeOf(info)) return "board wipe";
  if (counterOf(info)) return "counterspell";
  if (removalOf(info) || removalOf(info, "sorcery")) return "removal";
  if (burnOf(info) > 0) return "burn";
  if (pumpSpellOf(info)) return "pump";
  return null;
}
