// Rule-driven audit of the curated lists and the text reader, over the whole
// Scryfall card universe. Every finding lands in `defects`.
//
// Usage: npx tsx calibration/db/find-defects.ts <db>

import Database from "better-sqlite3";

const db = new Database(process.argv[2]!);
db.exec("DELETE FROM defects");
const add = db.prepare("INSERT OR REPLACE INTO defects (name_key,name,rule,severity,detail) VALUES (?,?,?,?,?)");

const TUTOR_LISTS = ["PREMIUM_TUTORS","TUTOR_ENGINES","STANDARD_TUTORS","COMBO_TUTORS","NARROW_TUTORS","GRAVEYARD_TUTORS"];
const DRAW_LISTS  = ["BURST_DRAW","PREMIUM_DRAW","STANDARD_DRAW","SELECTION","ONE_SHOT_DRAW"];
const IX_LISTS    = ["FREE_INTERACTION","EFFECTIVE_COUNTERS","BOARD_LEVEL_PROTECTION","HARD_WIPES","TURN_PROTECTION","STAX_PIECES"];

const run = (rule: string, severity: string, sql: string, detail: (r: any) => string) => {
  const rows = db.prepare(sql).all() as any[];
  const tx = db.transaction(() => { for (const r of rows) add.run(r.name_key, r.name ?? r.name_key, rule, severity, detail(r)); });
  tx();
  console.log(`${rule.padEnd(34)} ${String(rows.length).padStart(6)}  (${severity})`);
};

// 1. A name in a curated list that matches no card in the universe at all.
//    These are dead weight: they can never fire.
run("curated_name_matches_no_card", "high", `
  SELECT lm.name_key, lm.name_key AS name, GROUP_CONCAT(DISTINCT lm.list_name) AS lists
  FROM list_membership lm LEFT JOIN cards c ON c.name_key = lm.name_key
  WHERE c.name_key IS NULL GROUP BY lm.name_key`,
  (r) => `not found in Scryfall oracle data; listed in ${r.lists}`);

// 2. In FAST_MANA but the goldfish reads no mana from it.
run("fast_mana_goldfish_blind", "high", `
  SELECT lm.name_key, c.front_name AS name, c.type_line, c.mv
  FROM list_membership lm JOIN cards c ON c.name_key = lm.name_key
  JOIN card_reads r ON r.name_key = lm.name_key
  LEFT JOIN mana_output m ON m.name_key = lm.name_key
  WHERE lm.list_name = 'FAST_MANA' AND m.name_key IS NULL
    AND r.sim_rock = 0 AND r.sim_dork = 0 AND r.sim_ritual_amount = 0 AND r.sim_land_ramp = 0
    AND (r.sim_is_land = 0 OR r.sim_land_mana <= 1)
    AND c.oracle_text NOT LIKE '%additional land%'`,
  (r) => `${r.type_line} (mv ${r.mv}) is in FAST_MANA but has no MANA_OUTPUT row and the text reader scores it 0`);

// 3. Oracle text adds mana, but the goldfish reads zero. Whole universe.
run("text_adds_mana_sim_zero", "medium", `
  SELECT c.name_key, c.front_name AS name, c.type_line
  FROM cards c JOIN card_reads r ON r.name_key = c.name_key
  WHERE c.legal_commander = 1
    AND c.type_line NOT LIKE 'Basic Land%'
    AND (c.oracle_text LIKE '%Add {%' OR c.oracle_text LIKE '%Add one%' OR c.oracle_text LIKE '%Add two%' OR c.oracle_text LIKE '%Add three%')
    AND r.sim_rock = 0 AND r.sim_dork = 0 AND r.sim_ritual_amount = 0 AND r.sim_land_ramp = 0 AND r.mana_produced = 0
    AND (r.sim_is_land = 0 OR r.sim_land_mana <= 1)`,
  (r) => `${r.type_line}: oracle text adds mana, every mana read is 0`);

// 4. PREMIUM_TUTORS says "CMC <= 2, unrestricted (or as good as)".
run("premium_tutor_breaks_own_comment", "medium", `
  SELECT lm.name_key, c.front_name AS name, c.mv, c.type_line
  FROM list_membership lm JOIN cards c ON c.name_key = lm.name_key
  WHERE lm.list_name = 'PREMIUM_TUTORS' AND c.mv > 2
    AND lm.name_key NOT IN ('cruel tutor')`,
  (r) => `mv ${r.mv} but PREMIUM_TUTORS is documented as "CMC <= 2, unrestricted (or as good as)"`);

// 5. In a tutor list but the classifier gives it no tutor points.
run("tutor_list_scores_zero", "medium", `
  SELECT lm.name_key, c.front_name AS name, lm.list_name, c.type_line
  FROM list_membership lm JOIN cards c ON c.name_key = lm.name_key
  JOIN card_reads r ON r.name_key = lm.name_key
  WHERE lm.list_name IN (${TUTOR_LISTS.map((l) => `'${l}'`).join(",")}) AND r.tutor_points = 0
    AND lm.name_key NOT IN ('brainstorm','scroll rack')`,
  (r) => `in ${r.list_name} but tutorReading() returns 0 points`);

// 6. In a draw list but the classifier gives it no draw points.
run("draw_list_scores_zero", "medium", `
  SELECT lm.name_key, c.front_name AS name, lm.list_name
  FROM list_membership lm JOIN cards c ON c.name_key = lm.name_key
  JOIN card_reads r ON r.name_key = lm.name_key
  WHERE lm.list_name IN (${DRAW_LISTS.map((l) => `'${l}'`).join(",")}) AND r.draw_points = 0`,
  (r) => `in ${r.list_name} but drawReading() returns 0 points`);

// 7. In an interaction list but not read as an interaction piece.
run("interaction_list_not_a_piece", "low", `
  SELECT lm.name_key, c.front_name AS name, lm.list_name
  FROM list_membership lm JOIN cards c ON c.name_key = lm.name_key
  JOIN card_reads r ON r.name_key = lm.name_key
  WHERE lm.list_name IN (${IX_LISTS.map((l) => `'${l}'`).join(",")}) AND r.ix_piece = 0
    AND lm.name_key NOT IN ('cavern of souls','gush','sphinx''s revelation','ghostly flicker','deflecting swat','ratchet bomb','settle the wreckage','gods willing','rebuff the wicked')`,
  (r) => `in ${r.list_name} but interactionReadingCard() does not count it as a piece`);

// 8. Same card in two tutor tiers.
run("card_in_conflicting_tutor_tiers", "medium", `
  SELECT a.name_key, c.front_name AS name, GROUP_CONCAT(DISTINCT a.list_name) AS lists
  FROM list_membership a JOIN cards c ON c.name_key = a.name_key
  WHERE a.list_name IN ('PREMIUM_TUTORS','STANDARD_TUTORS','NARROW_TUTORS')
  GROUP BY a.name_key HAVING COUNT(DISTINCT a.list_name) > 1`,
  (r) => `listed in ${r.lists}`);

// 9. Named mana output for a card nobody flagged as fast mana.
run("mana_output_not_in_fast_mana", "low", `
  SELECT m.name_key, COALESCE(c.front_name, m.name_key) AS name, m.amount, m.kind
  FROM mana_output m LEFT JOIN list_membership lm ON lm.name_key = m.name_key AND lm.list_name = 'FAST_MANA'
  LEFT JOIN cards c ON c.name_key = m.name_key
  WHERE lm.name_key IS NULL`,
  (r) => `MANA_OUTPUT ${r.amount} ${r.kind} but not in FAST_MANA`);

// 10. Double-faced cards: every one of these is dropped by lib/scryfall.ts:84,
//     which keys its map by the returned "A // B" name.
run("dfc_dropped_by_name_lookup", "high", `
  SELECT name_key, front_name AS name, layout, type_line
  FROM cards WHERE is_dfc = 1 AND legal_commander = 1`,
  (r) => `${r.layout}: decklists print "${r.name}", Scryfall returns the "A // B" name, collectionByName keys on the latter`);

// 11. The headline: a card sits in a role list, exists, and STILL reads as
//     nothing at all. The file promises "when a score looks wrong for a named
//     card, the fix belongs in this file" - for these, it does not.
run("list_membership_inert", "high", `
  SELECT lm.name_key, c.front_name AS name, GROUP_CONCAT(DISTINCT lm.list_name) AS lists, c.type_line
  FROM list_membership lm JOIN cards c ON c.name_key = lm.name_key
  JOIN card_reads r ON r.name_key = lm.name_key
  WHERE r.reads_as_nothing = 1
    AND lm.list_name NOT IN ('MANA_OUTPUT')
  GROUP BY lm.name_key`,
  (r) => `${r.type_line}: listed in ${r.lists} but the classifier reads no role at all - the list entry is inert`);

console.log("\nBY RULE:");
for (const r of db.prepare("SELECT rule, severity, COUNT(*) n FROM defects GROUP BY rule ORDER BY n DESC").all() as any[])
  console.log(`  ${String(r.n).padStart(6)}  ${r.severity.padEnd(7)} ${r.rule}`);
console.log("TOTAL", db.prepare("SELECT COUNT(*) n FROM defects").get());
db.close();
