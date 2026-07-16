import { randomBytes } from "crypto";

// Play codes are read aloud and typed across a table, so the alphabet drops
// the lookalikes (0/O, 1/I/L) and sticks to uppercase.
export const PLAY_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const PLAY_CODE_LENGTH = 6;
// A code is JOINABLE for 10 minutes (expiresAt) — long enough to read it
// across the table, short enough not to float around. The seated game still
// gets to REPORT its result long after: commander games outlive the join
// window, so reporting is gated by this grace from mint instead.
export const PLAY_CODE_TTL_MS = 10 * 60 * 1000;
export const PLAY_CODE_REPORT_WINDOW_MS = 24 * 60 * 60 * 1000;

export function newPlayCode(): string {
  const bytes = randomBytes(PLAY_CODE_LENGTH);
  let out = "";
  for (let i = 0; i < PLAY_CODE_LENGTH; i++) {
    out += PLAY_CODE_ALPHABET[bytes[i] % PLAY_CODE_ALPHABET.length];
  }
  return out;
}

// Forgiving lookup key for whatever the host typed: trimmed, uppercased,
// spaces and dashes dropped. Returns null when it can't be a code at all.
export function normalizePlayCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.toUpperCase().replace(/[\s-]/g, "");
  return code.length === PLAY_CODE_LENGTH && [...code].every((c) => PLAY_CODE_ALPHABET.includes(c))
    ? code
    : null;
}
