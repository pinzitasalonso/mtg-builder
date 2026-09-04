#!/usr/bin/env bash
# Rebuild calibration.db end to end.
#   calibration/db/build.sh [db-path] [oracle.jsonl]
# With no oracle file, downloads the current Scryfall oracle bulk export.
set -euo pipefail
DB="${1:-calibration/calibration.db}"
SRC="${2:-}"
if [ -z "$SRC" ]; then
  SRC="$(mktemp -d)/oracle.jsonl"
  URL=$(curl -s https://api.scryfall.com/bulk-data \
    | python3 -c "import sys,json;print([b for b in json.load(sys.stdin)['data'] if b['type']=='oracle_cards'][0]['jsonl_download_uri'])")
  echo "downloading $URL"
  curl -sL "$URL" -o "$SRC.gz" && gunzip -f "$SRC.gz"
fi
npx tsx calibration/db/build-cards.ts  "$SRC" "$DB"
npx tsx calibration/db/find-defects.ts "$DB"
npx tsx calibration/db/build-decks.ts  "$DB"
echo "built $DB"
