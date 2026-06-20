import { randomBytes } from "crypto";

// A short, URL-safe, unguessable deck identifier (16 chars of base64url ≈ 96
// bits of entropy) — used in /deck/<publicId> so decks can't be enumerated.
export function newPublicId(): string {
  return randomBytes(12).toString("base64url");
}
