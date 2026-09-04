-- Queries against calibration.db. Run with any sqlite client:
--   sqlite3 calibration/calibration.db < calibration/db/queries.sql
-- or one at a time. Each is here because it answered a real question.

-- ---------------------------------------------------------------- coverage --
-- Where the corpus actually sits, by our own index. Power bands per the brief.
SELECT CASE
         WHEN s.ours >= 8.5 THEN '4 cEDH'
         WHEN s.ours >= 7.0 THEN '3 high power'
         WHEN s.ours >= 5.5 THEN '2 mid casual'
         ELSE                     '1 precon / near-precon' END AS band,
       COUNT(*) AS decks, GROUP_CONCAT(d.name, ' | ') AS which
FROM deck_scores s JOIN decks d ON d.slug = s.slug
WHERE s.axis = 'index' GROUP BY band ORDER BY band;

-- Which decks still have no DeckCheck scan behind them.
SELECT slug, name, source_kind, COALESCE(source_url,'-') url FROM decks ORDER BY source_kind, slug;

-- ------------------------------------------------------------ axis health --
-- Every axis, ours against its reference, worst first.
SELECT d.name, s.axis, s.ours, COALESCE(s.reference, s.reference_lo || '-' || s.reference_hi) AS ref,
       s.delta, CASE s.in_tolerance WHEN 1 THEN 'ok' WHEN 0 THEN 'FAIL' ELSE '-' END AS verdict
FROM deck_scores s JOIN decks d ON d.slug = s.slug
WHERE s.in_tolerance = 0 ORDER BY ABS(COALESCE(s.delta, 0)) DESC;

-- Is the bias systematic? Mean signed delta per axis says which way we lean.
SELECT axis, COUNT(*) n, ROUND(AVG(delta), 3) mean_delta, ROUND(MIN(delta), 2) worst_low, ROUND(MAX(delta), 2) worst_high
FROM deck_scores WHERE delta IS NOT NULL GROUP BY axis ORDER BY mean_delta;

-- ---------------------------------------------------------------- defects --
SELECT rule, severity, COUNT(*) n FROM defects GROUP BY rule, severity ORDER BY n DESC;

-- Curated entries that change nothing, by list. The percentage is the point:
-- it is the share of that list which is decoration.
SELECT lm.list_name, COUNT(*) inert,
       (SELECT COUNT(*) FROM list_membership x WHERE x.list_name = lm.list_name) total,
       ROUND(100.0 * COUNT(*) / (SELECT COUNT(*) FROM list_membership x WHERE x.list_name = lm.list_name), 1) pct
FROM list_membership lm
JOIN defects d ON d.name_key = lm.name_key AND d.rule = 'list_membership_inert'
GROUP BY lm.list_name ORDER BY pct DESC;

-- The cards a curated list names but the classifier reads as nothing.
SELECT d.name, d.detail FROM defects d WHERE d.rule = 'list_membership_inert' ORDER BY d.name;

-- Fast mana the goldfish is blind to: real acceleration, zero mana read.
SELECT d.name, c.mv, c.type_line, d.detail
FROM defects d JOIN cards c ON c.name_key = d.name_key
WHERE d.rule = 'fast_mana_goldfish_blind' ORDER BY c.mv;

-- How much of the format the MDFC lookup bug silently drops.
SELECT COUNT(*) AS commander_legal_dfcs_dropped FROM defects WHERE rule = 'dfc_dropped_by_name_lookup';
SELECT c.front_name, c.layout, c.type_line FROM defects d JOIN cards c ON c.name_key = d.name_key
WHERE d.rule = 'dfc_dropped_by_name_lookup' AND c.mv <= 3 ORDER BY c.front_name LIMIT 40;

-- Do any of those DFCs actually appear in the corpus? (They score as absent.)
SELECT dc.slug, dc.printed_name FROM deck_cards dc
JOIN defects d ON d.name_key = dc.name_key AND d.rule = 'dfc_dropped_by_name_lookup'
ORDER BY dc.slug, dc.printed_name;

-- ------------------------------------------------------------ list health --
-- Size of every curated list, and how much of it the classifier honours.
SELECT lm.list_name, COUNT(*) cards,
       SUM(CASE WHEN r.name_key IS NULL THEN 1 ELSE 0 END) AS not_a_real_card
FROM list_membership lm LEFT JOIN card_reads r ON r.name_key = lm.name_key
GROUP BY lm.list_name ORDER BY cards DESC;

-- FAST_MANA vs MANA_OUTPUT: the two are meant to describe the same cards.
SELECT 'in FAST_MANA, no MANA_OUTPUT' AS gap, COUNT(*) n
FROM list_membership lm LEFT JOIN mana_output m ON m.name_key = lm.name_key
WHERE lm.list_name = 'FAST_MANA' AND m.name_key IS NULL
UNION ALL
SELECT 'in MANA_OUTPUT, not FAST_MANA', COUNT(*)
FROM mana_output m LEFT JOIN list_membership lm ON lm.name_key = m.name_key AND lm.list_name = 'FAST_MANA'
WHERE lm.name_key IS NULL;

-- --------------------------------------------------------- the whole file --
-- Every card the classifier reads as nothing at all, by type. Sanity check on
-- how much of the format the text reader simply has no opinion about.
SELECT c.type_line, COUNT(*) n FROM cards c JOIN card_reads r ON r.name_key = c.name_key
WHERE c.legal_commander = 1 AND r.reads_as_nothing = 1
GROUP BY c.type_line ORDER BY n DESC LIMIT 20;
