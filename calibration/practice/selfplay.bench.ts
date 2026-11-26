// npm run practice:bench
//
// Replays seeded games of each list in decks/ with the built-in planner
// against a player who does nothing, and prints how fast the list wins and
// how many of its early turns it gives away. The games' logs go to .out/,
// one file a deck, to read the turns that went wrong.
//
//   GAMES=100 TURNS=12 DECK=rogsi npm run practice:bench

import fs from "node:fs";
import path from "node:path";
import { it } from "vitest";
import { report, selfplay, type SelfplayDeck, type SelfplayGame } from "@/lib/practice/selfplay";

const DIR = path.join(__dirname, "decks");
const OUT = path.join(__dirname, ".out");
const GAMES = Number(process.env.GAMES ?? 60);
const TURNS = Number(process.env.TURNS ?? 10);
const ONLY = process.env.DECK;

interface DeckFile extends SelfplayDeck {
  name: string;
}

const pct = (n: number, of: number) => `${Math.round((100 * n) / Math.max(1, of))}%`.padStart(4);

function detail(deck: DeckFile, games: SelfplayGame[]): string {
  const lines: string[] = [];
  const idle = games.flatMap((g) => g.turns.filter((t) => t.n <= 5 && !t.moves && (g.wonOn === null || t.n <= g.wonOn)).map((t) => `seed ${g.seed} turn ${t.n} (lands ${t.lands}): ${t.hand.join(", ")}`));
  lines.push(`${deck.name}: ${games.length} games`, "", `IDLE TURNS among its first five (* = it could pay for the card): ${idle.length}`, ...idle, "");
  for (const g of games) {
    lines.push(`===== seed ${g.seed}: ${g.wonOn ? `wins on its turn ${g.wonOn}` : g.how} =====`, `opening${g.mulligans ? ` (mulligan to ${7 - g.mulligans})` : ""}: ${g.opening.join(", ")}`);
    for (const t of g.turns) lines.push(`-- its turn ${t.n} · ${t.mana} · hand: ${t.hand.join(", ")}`, `   (in play: ${t.field.join(", ") || "nothing"})`, ...t.log.map((l) => `   ${l}`));
    lines.push("");
  }
  return lines.join("\n");
}

it("replays the lists", () => {
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".json") && (!ONLY || f.startsWith(ONLY)));
  fs.mkdirSync(OUT, { recursive: true });
  const rows: string[] = [];
  for (const f of files) {
    const deck = JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8")) as DeckFile;
    const games = Array.from({ length: GAMES }, (_, i) => selfplay(deck, i + 1, TURNS));
    const r = report(games, TURNS);
    fs.writeFileSync(path.join(OUT, f.replace(/\.json$/, ".txt")), detail(deck, games));
    const by = [3, 4, 5, 6, 8, TURNS].filter((n, i, a) => n <= TURNS && a.indexOf(n) === i);
    rows.push(
      `${deck.name}\n` +
        `  wins by its turn ${by.map((n) => `${n}: ${pct(r.wonBy[n] ?? 0, r.games)}`).join("   ")}\n` +
        `  half its games are won by turn ${r.median ?? `${TURNS}+`} · idle early turns ${pct(Math.round(r.idle * 1000), 1000)} · lost to itself ${r.lost}`
    );
  }
  console.log(`\nPractice benchmark: ${GAMES} games a list, ${TURNS} turns each\n\n${rows.join("\n\n")}\n\nLogs: calibration/practice/.out/\n`);
});
