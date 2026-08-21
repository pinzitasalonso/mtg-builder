// A tiny, purpose-built Markdown tokenizer for the AI chat assistant's replies.
// We control the model's output format (headings, bold, bullet/numbered lists,
// paragraphs, and [[Card Name]] links), so a focused tokenizer is simpler and
// dependency-free compared to a full Markdown engine — and it degrades cleanly
// while text streams in: a half-arrived "[[Blightste" or "**bol" stays plain
// text until its closing delimiter shows up.

export type InlineToken =
  | { type: "text"; value: string }
  | { type: "bold"; tokens: InlineToken[] }
  | { type: "card"; value: string };

export type Block =
  | { type: "h1" | "h2" | "h3" | "p"; inline: InlineToken[] }
  | { type: "ul" | "ol"; items: InlineToken[][] };

// Split a line of text into inline tokens. Only COMPLETE [[...]] / **...**
// pairs become card/bold tokens; anything unterminated stays as text. Bold
// spans are tokenized recursively so a [[Card]] inside **...** is still a link.
export function tokenizeInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  // Match a complete card link or a complete bold span, whichever comes first.
  const re = /\[\[([^\]]+)\]\]|\*\*([^*]+?)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) tokens.push({ type: "text", value: text.slice(last, m.index) });
    if (m[1] !== undefined) tokens.push({ type: "card", value: m[1].trim() });
    else tokens.push({ type: "bold", tokens: tokenizeInline(m[2]) });
    last = m.index + m[0].length;
  }
  if (last < text.length) tokens.push({ type: "text", value: text.slice(last) });
  return tokens;
}

const HEADING_RE = /^(#{1,3})\s+(.*)$/;
const UL_RE = /^[-*]\s+(.*)$/;
const OL_RE = /^\d+\.\s+(.*)$/;

// Parse a Markdown string into block-level tokens. Consecutive list items of the
// same kind group into one list block; consecutive plain lines join into one
// paragraph; blank lines separate blocks.
export function parseBlocks(md: string): Block[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];

  const flushPara = () => {
    if (para.length) {
      blocks.push({ type: "p", inline: tokenizeInline(para.join(" ")) });
      para = [];
    }
  };

  for (const rawLine of lines) {
    const raw = rawLine.trim();
    if (!raw) {
      flushPara();
      continue;
    }
    // Strip a leading blockquote marker ("> …") so the inner cards still link.
    const trimmed = raw.replace(/^>+\s?/, "");
    if (!trimmed) {
      flushPara();
      continue;
    }

    const heading = HEADING_RE.exec(trimmed);
    if (heading) {
      flushPara();
      const level = heading[1].length;
      const type = level === 1 ? "h1" : level === 2 ? "h2" : "h3";
      blocks.push({ type, inline: tokenizeInline(heading[2]) });
      continue;
    }

    const ul = UL_RE.exec(trimmed);
    if (ul) {
      flushPara();
      const item = tokenizeInline(ul[1]);
      const prev = blocks[blocks.length - 1];
      if (prev && prev.type === "ul") prev.items.push(item);
      else blocks.push({ type: "ul", items: [item] });
      continue;
    }

    const ol = OL_RE.exec(trimmed);
    if (ol) {
      flushPara();
      const item = tokenizeInline(ol[1]);
      const prev = blocks[blocks.length - 1];
      if (prev && prev.type === "ol") prev.items.push(item);
      else blocks.push({ type: "ol", items: [item] });
      continue;
    }

    para.push(trimmed);
  }
  flushPara();
  return blocks;
}

// Collect the distinct card names referenced anywhere in a Markdown string.
export function cardNamesIn(md: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of md.matchAll(/\[\[([^\]]+)\]\]/g)) {
    const name = m[1].trim();
    const key = name.toLowerCase();
    if (name && !seen.has(key)) {
      seen.add(key);
      out.push(name);
    }
  }
  return out;
}

// Canonical lookup key for a card name: trimmed, internal whitespace collapsed,
// lowercased. Every name map/set (verified, not-found, pool membership) must be
// keyed through this so a streaming quirk like a doubled space can't make the
// same name hash differently in different code paths.
export function normalizeCardKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

// Bold spans the model wrote WITHOUT brackets — candidate card names. The AI
// often bolds a card name instead of bracketing it (e.g. "**Birds of
// Paradise**"); the client verifies these against Scryfall and links the ones
// that are real cards, so a suggestion is never left unclickable.
export function boldNamesIn(md: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of md.matchAll(/\*\*([^*]+?)\*\*/g)) {
    const inner = m[1].trim().replace(/\s+/g, " ");
    const key = inner.toLowerCase();
    // Only spans that look like card names: they start with a capital (or a
    // digit), stay short, and never end with ':'. This keeps bold prose
    // emphasis ("**removal**", "**Strategy:**") from being verified against
    // Scryfall and becoming an accidental add-to-deck link when the word
    // happens to also be a real card (Fog, Ponder, …).
    const nameLike =
      inner.length <= 60 &&
      /^[\p{Lu}\d]/u.test(inner) &&
      !inner.endsWith(":") &&
      inner.split(" ").length <= 8 &&
      !inner.includes("[[");
    if (nameLike && !seen.has(key)) {
      seen.add(key);
      out.push(inner);
    }
  }
  return out;
}

// Flatten inline tokens to their plain text (used to read a bold span's content).
export function flattenInline(tokens: InlineToken[]): string {
  return tokens
    .map((t) => (t.type === "bold" ? flattenInline(t.tokens) : t.value))
    .join("");
}

/* ------------------------------------------------------------------ cuts */

/* What a heading says to DO with the cards under it. */
type SectionAdvice = "cut" | "protect" | "neutral";

const CUT_RE = /\b(cut|cutting|cuts|remove|removing|removals?|trim|drop|swap out)\b/i;
/* "protect" covers both keeps and adds: a card named under either heading must
   never end up in a cut list, so they need no distinction here. */
const PROTECT_RE = /\b(working well|keep|keeping|strengths?|core|missing|add(?:s|ing|ition|itions)?|include|upgrades?)\b/i;

/* Classify a heading. Ambiguous wins nothing: a heading that says both ("Cuts
   and additions") is neutral, because it does not authorize deleting anything. */
function adviceOf(heading: string): SectionAdvice {
  const cut = CUT_RE.test(heading);
  const protect = PROTECT_RE.test(heading);
  if (cut && !protect) return "cut";
  if (protect && !cut) return "protect";
  return "neutral";
}

/* The first card named in a run of inline tokens, or null. */
function firstCardIn(tokens: InlineToken[]): string | null {
  for (const t of tokens) {
    if (t.type === "card") return t.value.trim();
    if (t.type === "bold") {
      const inner = firstCardIn(t.tokens);
      if (inner) return inner;
      // A bold span with no bracketed card inside is itself a candidate name,
      // which is how the model often writes a cut ("**Sol Ring** — worse than…").
      const flat = flattenInline(t.tokens).trim().replace(/\s+/g, " ");
      if (flat && /^[\p{Lu}\d]/u.test(flat) && !flat.endsWith(":") && flat.split(" ").length <= 8) {
        return flat;
      }
    }
  }
  return null;
}

/**
 * The cards a reply actually proposes CUTTING.
 *
 * This exists because the obvious reading of a reply — "every card named that
 * is already in the deck" — is wrong in the one direction that costs you a
 * deck. A cut is almost always argued FOR by naming something better:
 *
 *     ## Consider cutting
 *     - [[Divination]] — [[Rhystic Study]] already does this, better
 *
 * Both cards are named, both are in the deck, so a flat scan offers to remove
 * the card the reply told you to keep. Two rules keep that from happening:
 *
 *  1. Only headings that say cut and nothing else contribute candidates. No
 *     such heading means no bulk cut is offered at all — a free-form answer
 *     has no structure to trust, and cards stay removable one at a time.
 *  2. Within a cut section, only the FIRST card of each list item or paragraph
 *     is a candidate. The rest of that sentence is the justification, which is
 *     exactly where the cards you must keep get named.
 *
 * Anything named under a keep/add heading is then subtracted, so a card praised
 * in one section can never be cut by another.
 */
export function cutCandidates(md: string): string[] {
  const blocks = parseBlocks(md);
  let advice: SectionAdvice = "neutral";
  let sawCutHeading = false;
  const candidates: string[] = [];
  const protectedKeys = new Set<string>();

  const protectAll = (tokens: InlineToken[]) => {
    for (const n of cardNamesIn(flattenCards(tokens))) protectedKeys.add(normalizeCardKey(n));
  };

  const consume = (run: InlineToken[]) => {
    if (advice === "cut") {
      const first = firstCardIn(run);
      if (first) candidates.push(first);
    } else if (advice === "protect") {
      protectAll(run);
    }
  };

  for (const b of blocks) {
    if (b.type === "h1" || b.type === "h2" || b.type === "h3") {
      // A heading changes what the cards under it mean.
      advice = adviceOf(flattenInline(b.inline));
      if (advice === "cut") sawCutHeading = true;
    } else if (b.type === "p") {
      consume(b.inline);
    } else if (b.type === "ul" || b.type === "ol") {
      for (const item of b.items) consume(item);
    }
  }

  if (!sawCutHeading) return [];
  const seen = new Set<string>();
  return candidates.filter((n) => {
    const key = normalizeCardKey(n);
    if (protectedKeys.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/* Re-serialize inline tokens far enough that cardNamesIn can read the [[…]]
   names back out of them. */
function flattenCards(tokens: InlineToken[]): string {
  return tokens
    .map((t) =>
      t.type === "card" ? `[[${t.value}]]` : t.type === "bold" ? flattenCards(t.tokens) : t.value
    )
    .join("");
}
