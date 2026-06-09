// Pure legality checks — format legality + commander color identity.

// Formats we can check against Scryfall's legalities map.
const KNOWN_FORMATS = new Set([
  "standard", "pioneer", "modern", "legacy", "vintage", "commander", "pauper", "brawl",
]);

export interface LegalityWarning {
  kind: "format" | "identity";
  message: string;
}

// True when `cardIdentity` (WUBRG letters) fits inside `commanderIdentity`.
// "" (colorless) always fits. Unknown (null) identities never warn.
export function fitsIdentity(cardIdentity: string | null, commanderIdentity: string | null): boolean {
  if (cardIdentity === null || commanderIdentity === null) return true;
  const allowed = new Set(commanderIdentity.toUpperCase());
  return [...cardIdentity.toUpperCase()].every((l) => allowed.has(l));
}

// Collect warnings for one card relative to the deck's format and (for
// commander) the commander's color identity. Missing data never warns —
// guardrails should not cry wolf on un-enriched rows.
export function cardWarnings(
  card: { legalities: Record<string, string> | null; colorIdentity: string | null },
  format: string | null | undefined,
  commanderIdentity: string | null
): LegalityWarning[] {
  const out: LegalityWarning[] = [];
  const fmt = (format ?? "").toLowerCase();

  if (card.legalities && KNOWN_FORMATS.has(fmt)) {
    const status = card.legalities[fmt];
    if (status && status !== "legal" && status !== "restricted") {
      out.push({
        kind: "format",
        message: status === "banned" ? `Banned in ${fmt}` : `Not legal in ${fmt}`,
      });
    } else if (status === "restricted") {
      out.push({ kind: "format", message: `Restricted in ${fmt} (max 1 copy)` });
    }
  }

  if (fmt === "commander" && !fitsIdentity(card.colorIdentity, commanderIdentity)) {
    out.push({ kind: "identity", message: "Outside your commander's color identity" });
  }

  return out;
}
