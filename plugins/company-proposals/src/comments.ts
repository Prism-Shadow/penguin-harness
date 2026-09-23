/**
 * Where a comment stands, and how an agent reads it.
 *
 * A comment is anchored to a RANGE of one section's Markdown source — the passage a person
 * selected — stored as offsets, because offsets are exact and cheap to validate. Offsets are
 * a poor thing to hand an agent, though: "characters 40–96 of section 2" is easy to misread
 * and useless in a terminal. So an agent never sees them. What it gets is the section's
 * source with the passage wrapped in `⟦<id>⟧…⟦/<id>⟧`, then the comments by id — the same
 * id it resolves with. The brackets are the mathematical white brackets (U+27E6 / U+27E7):
 * they occur in no Markdown syntax and in no ordinary prose, so a marker can be found again
 * without escaping anything.
 *
 * A revision moves text; the ledger re-anchors every comment by its `quote` (see
 * {@link locateQuote}): the first exact occurrence in the new source, else the first
 * occurrence with whitespace collapsed. A passage that is gone stays a comment "on revision
 * N" — listed, never lost.
 */
import type { ProposalComment, ProposalSection } from "@prismshadow/penguin-server/api";

/** The separator between a section's paragraphs in its source. */
export const PARAGRAPH_GAP = "\n\n";

/** A section's Markdown source: its paragraphs joined by a blank line. The one text a comment's offsets index. */
export function sectionSource(section: Pick<ProposalSection, "paragraphs">): string {
  return section.paragraphs.map((p) => p.text).join(PARAGRAPH_GAP);
}

/** The paragraph a source offset falls in (an offset inside the gap belongs to the paragraph before it), or null past the end. */
export function paragraphAtOffset(
  section: Pick<ProposalSection, "paragraphs">,
  offset: number,
): string | null {
  let at = 0;
  for (const p of section.paragraphs) {
    const end = at + p.text.length;
    if (offset <= end) return p.id;
    at = end + PARAGRAPH_GAP.length;
  }
  return null;
}

/** The span a whole paragraph occupies in its section's source, or null when the section has no such paragraph. */
export function paragraphSpan(
  section: Pick<ProposalSection, "paragraphs">,
  paragraphId: string,
): { start: number; end: number } | null {
  let at = 0;
  for (const p of section.paragraphs) {
    if (p.id === paragraphId) return { start: at, end: at + p.text.length };
    at += p.text.length + PARAGRAPH_GAP.length;
  }
  return null;
}

const collapse = (text: string): string => text.replace(/\s+/g, " ").trim();

/**
 * Where `quote` stands in `source`: the first exact occurrence, else the first occurrence
 * once whitespace is collapsed on both sides (a reflowed paragraph keeps its comment), else
 * null. An empty quote anchors nowhere.
 */
export function locateQuote(source: string, quote: string): { start: number; end: number } | null {
  if (quote === "") return null;
  const exact = source.indexOf(quote);
  if (exact >= 0) return { start: exact, end: exact + quote.length };
  const target = collapse(quote);
  if (target === "") return null;
  // Walk the source building its collapsed form with a map back to source offsets, so a
  // match in the collapsed text names a range in the real one.
  const plain: string[] = [];
  const map: number[] = [];
  let pendingSpace = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]!;
    if (/\s/.test(ch)) {
      pendingSpace = plain.length > 0;
      continue;
    }
    if (pendingSpace) {
      plain.push(" ");
      map.push(i);
      pendingSpace = false;
    }
    plain.push(ch);
    map.push(i);
  }
  const hit = plain.join("").indexOf(target);
  if (hit < 0) return null;
  const start = map[hit]!;
  const end = map[hit + target.length - 1]! + 1;
  return { start, end };
}

/**
 * The sections with every listed comment's passage marked, then the comments by id: what
 * `penguin org proposal comments` prints. Markers open at `start` and close at `end`; at one
 * position closes come before opens, and among opens the longer range opens first, so nested
 * ranges nest and overlapping ones each keep their own pair — in document order, never as
 * numbers. A comment whose passage is not in the current revision is listed after the
 * sections with the revision it belongs to.
 */
export function renderForAgent(
  proposal: { number: number; revision: number; sections: ProposalSection[] },
  comments: readonly ProposalComment[],
  opts: { resolveCommand?: (id: string) => string } = {},
): string {
  const out: string[] = [];
  const current = comments.filter((c) => c.revision === proposal.revision);
  for (const section of proposal.sections) {
    const source = sectionSource(section);
    const here = current.filter((c) => c.sectionId === section.id);
    out.push(`## ${section.heading}`);
    out.push("");
    out.push(markRanges(source, here));
    out.push("");
  }
  if (comments.length > 0) {
    out.push("### Comments");
    out.push("");
    for (const c of comments) {
      const state =
        c.resolved !== undefined
          ? `resolved: ${c.resolved.text === "" ? "(no note)" : c.resolved.text}`
          : c.batchId === null
            ? "pending"
            : "open";
      const where =
        c.revision === proposal.revision
          ? ""
          : ` (on revision ${c.revision}: "${collapse(c.quote)}")`;
      out.push(`⟦${c.id}⟧ ${c.by} (${state})${where}: ${c.text}`);
    }
    const open = comments.filter((c) => c.resolved === undefined && c.batchId !== null);
    if (open.length > 0 && opts.resolveCommand !== undefined) {
      out.push("");
      out.push(`Resolve each with: ${opts.resolveCommand("<id>")}`);
    }
  }
  return `${out.join("\n").trimEnd()}\n`;
}

/** `source` with each comment's range wrapped in its markers. */
export function markRanges(
  source: string,
  comments: readonly Pick<ProposalComment, "id" | "range">[],
): string {
  type Mark = { at: number; open: boolean; id: string; length: number };
  const marks: Mark[] = [];
  for (const c of comments) {
    const start = Math.max(0, Math.min(c.range.start, source.length));
    const end = Math.max(start, Math.min(c.range.end, source.length));
    marks.push({ at: start, open: true, id: c.id, length: end - start });
    marks.push({ at: end, open: false, id: c.id, length: end - start });
  }
  marks.sort((a, b) => {
    if (a.at !== b.at) return a.at - b.at;
    // Closes before opens at the same offset; the longer range opens first and closes last.
    if (a.open !== b.open) return a.open ? 1 : -1;
    return a.open ? b.length - a.length : a.length - b.length;
  });
  let out = "";
  let at = 0;
  for (const m of marks) {
    out += source.slice(at, m.at);
    out += m.open ? `⟦${m.id}⟧` : `⟦/${m.id}⟧`;
    at = m.at;
  }
  return out + source.slice(at);
}
