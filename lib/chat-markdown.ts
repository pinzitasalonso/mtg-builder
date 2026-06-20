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
