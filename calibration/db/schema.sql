-- Calibration database.
--
-- Three things live here, and the point is the join between them:
--   1. the card universe (Scryfall oracle bulk) and how OUR classifier reads
--      every single card in it;
--   2. the curated lists in lib/deck-score-cards.ts, as data rather than source;
--   3. the corpus decks, our axis scores, and the reference we score against.
--
-- Nothing here is DeckCheck's card database. The `reference_*` columns carry
-- only the axis numbers for decks already cited in calibration/decks/.

PRAGMA journal_mode = WAL;

DROP TABLE IF EXISTS cards;
CREATE TABLE cards (
  name_key      TEXT PRIMARY KEY,   -- nameKey(): lowercased, front face only
  name          TEXT NOT NULL,      -- Scryfall's full name ("A // B" for DFCs)
  front_name    TEXT NOT NULL,      -- printed front face, what decklists use
  oracle_id     TEXT,
  layout        TEXT,
  is_dfc        INTEGER NOT NULL,   -- name contains " // "
  type_line     TEXT,
  oracle_text   TEXT,
  mana_cost     TEXT,
  mv            REAL,
  power         TEXT,
  toughness     TEXT,
  colors        TEXT,
  color_identity TEXT,
  produced_mana TEXT,
  keywords      TEXT,
  rarity        TEXT,
  legal_commander INTEGER NOT NULL
);
CREATE INDEX cards_front ON cards(front_name);
CREATE INDEX cards_legal ON cards(legal_commander);

-- How lib/deck-score-classify.ts + lib/goldfish.ts read each card, in isolation.
DROP TABLE IF EXISTS card_reads;
CREATE TABLE card_reads (
  name_key       TEXT PRIMARY KEY REFERENCES cards(name_key),
  tutor_points   REAL, tutor_premium INTEGER, tutor_engine INTEGER, tutor_graveyard INTEGER, tutor_battlefield INTEGER,
  draw_points    REAL, draw_kind TEXT,
  ix_piece INTEGER, ix_counter INTEGER, ix_free INTEGER, ix_removal INTEGER,
  ix_wipe INTEGER, ix_hard_wipe INTEGER, ix_symmetric_wipe INTEGER, ix_stax INTEGER,
  ix_instant INTEGER, ix_turn_protection INTEGER,
  threat_weight REAL, threat_self_protecting INTEGER, threat_anthem INTEGER, threat_token_engine INTEGER,
  recursion_points REAL, recursion_kind TEXT, recursion_engine INTEGER,
  mana_produced REAL,
  sim_is_land INTEGER, sim_land_mana REAL, sim_rock REAL, sim_dork REAL,
  sim_ritual_amount REAL, sim_ritual_net REAL, sim_land_ramp REAL, sim_enters_tapped INTEGER,
  reads_as_nothing INTEGER            -- classifier found no role at all
);

-- The curated lists in lib/deck-score-cards.ts, exploded.
DROP TABLE IF EXISTS list_membership;
CREATE TABLE list_membership (
  name_key  TEXT NOT NULL,
  list_name TEXT NOT NULL,
  PRIMARY KEY (name_key, list_name)
);
CREATE INDEX lm_list ON list_membership(list_name);

-- Named mana output, which only the goldfish reads.
DROP TABLE IF EXISTS mana_output;
CREATE TABLE mana_output (
  name_key TEXT PRIMARY KEY,
  amount   REAL NOT NULL,
  kind     TEXT NOT NULL
);

-- Rule-driven findings. One row per (card, rule).
DROP TABLE IF EXISTS defects;
CREATE TABLE defects (
  name_key TEXT NOT NULL,
  name     TEXT NOT NULL,
  rule     TEXT NOT NULL,
  severity TEXT NOT NULL,             -- high | medium | low
  detail   TEXT,
  PRIMARY KEY (name_key, rule)
);
CREATE INDEX defects_rule ON defects(rule);
CREATE INDEX defects_sev  ON defects(severity);

-- Corpus decks.
DROP TABLE IF EXISTS decks;
CREATE TABLE decks (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source_kind TEXT, source_url TEXT, scanned_at TEXT,
  commanders TEXT, card_count INTEGER
);

DROP TABLE IF EXISTS deck_cards;
CREATE TABLE deck_cards (
  slug TEXT NOT NULL REFERENCES decks(slug),
  name_key TEXT NOT NULL,
  printed_name TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  resolved INTEGER NOT NULL,          -- did it resolve through our Scryfall path
  PRIMARY KEY (slug, name_key)
);

DROP TABLE IF EXISTS deck_scores;
CREATE TABLE deck_scores (
  slug TEXT NOT NULL REFERENCES decks(slug),
  axis TEXT NOT NULL,
  ours REAL,
  reference REAL, reference_lo REAL, reference_hi REAL,
  delta REAL, in_tolerance INTEGER,
  PRIMARY KEY (slug, axis)
);

DROP TABLE IF EXISTS deck_metrics;
CREATE TABLE deck_metrics (
  slug TEXT NOT NULL REFERENCES decks(slug),
  metric TEXT NOT NULL,
  value REAL,
  PRIMARY KEY (slug, metric)
);
