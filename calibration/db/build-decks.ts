// Score every deck in calibration/decks and record the result — axis by axis,
// against its reference — in calibration.db.
//
// Usage: npx tsx calibration/db/build-decks.ts <db>

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { nameKey, type ScoredCard } from "../../lib/deck-score-classify";
import { scoreDeck } from "../../lib/deck-score-report";

const db = new Database(process.argv[2]!);
const HERE = join(process.cwd(), "calibration");
const cache = existsSync(join(HERE, ".cache.json"))
  ? JSON.parse(readFileSync(join(HERE, ".cache.json"), "utf8")) : { ids: {}, facts: {}, combos: {} };

for (const t of ["deck_metrics", "deck_scores", "deck_cards", "decks"]) db.exec(`DELETE FROM ${t}`);
const insDeck = db.prepare("INSERT INTO decks VALUES (?,?,?,?,?,?,?)");
const insCard = db.prepare("INSERT OR REPLACE INTO deck_cards VALUES (?,?,?,?,?)");
const insScore = db.prepare("INSERT OR REPLACE INTO deck_scores VALUES (?,?,?,?,?,?,?,?)");
const insMetric = db.prepare("INSERT OR REPLACE INTO deck_metrics VALUES (?,?,?)");

for (const file of readdirSync(join(HERE, "decks")).filter((f) => f.endsWith(".json")).sort()) {
  const slug = file.replace(/\.json$/, "");
  const deck = JSON.parse(readFileSync(join(HERE, "decks", file), "utf8"));
  const commanders = new Set<string>(deck.commanders.map(nameKey));
  const counts = new Map<string, number>();
  for (const line of deck.list as string[]) {
    const m = line.trim().match(/^(\d+)x?\s+(.+)$/);
    const n = m ? m[2]!.trim() : line.trim();
    counts.set(n, (counts.get(n) ?? 0) + (m ? Number(m[1]) : 1));
  }
  insDeck.run(slug, deck.name, deck.source?.kind ?? null, deck.source?.url ?? null, deck.source?.scannedAt ?? null,
    (deck.commanders as string[]).join(" + "), [...counts.values()].reduce((a, b) => a + b, 0));

  const cards: ScoredCard[] = [];
  db.transaction(() => {
    for (const [name, quantity] of counts) {
      const id = cache.ids[name.toLowerCase()];
      const f = id ? cache.facts[id] : undefined;
      insCard.run(slug, nameKey(name), name, quantity, f ? 1 : 0);
      if (!f) continue;
      cards.push({ name: f.name, typeLine: f.typeLine ?? "", oracleText: f.oracleText ?? "", manaCost: f.manaCost,
        manaValue: f.manaValue, quantity, power: f.power, toughness: f.toughness, keywords: f.keywords,
        producedMana: f.producedMana, isCommander: commanders.has(nameKey(f.name)) });
    }
  })();
  const comboKey = cards.map((c) => `${nameKey(c.name)}x${c.quantity}${c.isCommander ? "*" : ""}`).sort().join("|");
  const combos = cache.combos[comboKey] ?? [];
  const r: any = scoreDeck(cards as any, combos, 2);
  const tol = deck.expected.tolerance ?? 0.75;

  const axes: [string, number][] = [["index", r.index], ["consistency", r.consistency], ["resilience", r.resilience],
    ["interaction", r.interaction], ["speed", r.speed], ["bracket", r.bracketFloor]];
  db.transaction(() => {
    for (const [axis, ours] of axes) {
      const e = deck.expected[axis];
      let ref = null, lo = null, hi = null, delta = null, ok = null;
      if (e !== undefined) {
        if (Array.isArray(e)) { lo = e[0]; hi = e[1]; ok = ours >= lo! && ours <= hi! ? 1 : 0; }
        else { ref = e; delta = Number((ours - e).toFixed(4)); ok = Math.abs(ours - e) <= (axis === "bracket" ? 0 : tol) ? 1 : 0; }
      }
      insScore.run(slug, axis, ours, ref, lo, hi, delta, ok);
    }
    insMetric.run(slug, "fundamental_turn", r.fundamentalTurn);
    insMetric.run(slug, "combo_lines", combos.length);
    insMetric.run(slug, "unresolved_cards", [...counts.keys()].filter((n) => !cache.ids[n.toLowerCase()]).length);
    for (const a of r.axes ?? []) for (const [k, v] of Object.entries(a.counts ?? {}))
      if (typeof v === "number") insMetric.run(slug, `${a.key}_${k}`, v);
  })();
  console.log(`${slug.padEnd(26)} idx ${String(r.index).padStart(5)}  turn ${r.fundamentalTurn}`);
}
console.log(db.prepare("SELECT COUNT(*) decks FROM decks").get(),
            db.prepare("SELECT COUNT(*) rows FROM deck_scores").get(),
            db.prepare("SELECT COUNT(*) cards FROM deck_cards").get());
db.close();
