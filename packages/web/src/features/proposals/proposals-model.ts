import { toWorkspaceRelative } from "../../lib/file-path";
/**
 * The proposals page's pure shaping (unit tested, no React): the queue's order, a status's
 * tone, the `proposal:<n>[#<pattern>]` reference grammar every Markdown surface recognizes,
 * how a pattern is matched against a proposal's headings and paragraphs, the one-line text of
 * an event, and what the page may do to a proposal in each status.
 */
import type { BadgeTone } from "../../components/ui/badge";
import type {
  ProposalDetail,
  ProposalEvent,
  ProposalItem,
  ProposalSection,
  ProposalStatus,
} from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";

/**
 * The queue's order: whatever has unread events first (the reader's work), then newest first
 * within each half — the number is the creation order, so it is the date without parsing one.
 */
export function sortProposals<T extends { number: number; unread: number }>(
  items: readonly T[],
): T[] {
  return [...items].sort((a, b) => {
    const aUnread = a.unread > 0 ? 1 : 0;
    const bUnread = b.unread > 0 ? 1 : 0;
    if (aUnread !== bUnread) return bUnread - aUnread;
    return b.number - a.number;
  });
}

/**
 * A status as a pill tone, by what it asks of the reader: `ready` waits on the person
 * (attention), `approved` is settled well, `merged` is done and recedes into the neutral
 * emphasis, `rejected` is the one closed badly, `drafting` is nobody's turn but the author's.
 */
export const PROPOSAL_STATUS_TONE: Record<ProposalStatus, BadgeTone> = {
  drafting: "gray",
  ready: "amber",
  approved: "green",
  merged: "brand",
  rejected: "red",
};

/** A closed proposal takes no more comments, approvals or rejections. */
export function isProposalClosed(status: ProposalStatus): boolean {
  return status === "merged" || status === "rejected";
}

/** What the person may do from the action bar, given the status and their pending comments. */
export function proposalActions(
  status: ProposalStatus,
  pendingComments: number,
): { requestChanges: boolean; approve: boolean; reject: boolean; markMerged: boolean } {
  const closed = isProposalClosed(status);
  return {
    requestChanges: !closed && pendingComments > 0,
    approve: status === "ready",
    reject: !closed,
    markMerged: status === "approved",
  };
}

/** A parsed `proposal:<n>[#<pattern>]` reference. */
export interface ProposalRef {
  number: number;
  /** The fragment after `#`: a regular expression over headings and paragraph first lines, whose first capture group labels the link. */
  pattern?: string;
}

/**
 * The reference grammar, as it appears bare in prose: `proposal:` then the number, optionally
 * `#` and a pattern running to the next whitespace. A trailing sentence punctuation mark is not
 * part of the pattern — `see proposal:12.` names #12 — but inside a pattern a dot is a
 * regular-expression dot, so only the last character is given back.
 */
export const PROPOSAL_REF_RE = /proposal:(\d+)(?:#(\S+))?/g;

/** One reference from the whole of `text`, or null when it is not exactly one. */
export function parseProposalRef(text: string): ProposalRef | null {
  const m = /^proposal:(\d+)(?:#(.+))?$/.exec(text.trim());
  if (m === null) return null;
  const number = Number(m[1]);
  if (!Number.isSafeInteger(number) || number <= 0) return null;
  const pattern = m[2] === undefined ? undefined : trimPatternPunctuation(m[2]);
  return pattern === undefined || pattern === "" ? { number } : { number, pattern };
}

/**
 * Sentence punctuation a bare reference at the end of a sentence would otherwise swallow.
 * A closing bracket is only punctuation when nothing inside the pattern opened it: the
 * capture group of `proposal:12#Rename (\w+)` ends in `)` and keeps it.
 */
export function trimPatternPunctuation(pattern: string): string {
  const last = pattern.at(-1);
  if (last === undefined) return pattern;
  if (/[.,;:!?]/.test(last)) return pattern.slice(0, -1);
  const open = last === ")" ? "(" : last === "]" ? "[" : last === "}" ? "{" : null;
  if (open === null) return pattern;
  const opened = pattern.split(open).length - 1;
  const closed = pattern.split(last).length - 1;
  return closed > opened ? pattern.slice(0, -1) : pattern;
}

/** A reference as its canonical text, the value the capsule element carries. */
export function proposalRefText(ref: ProposalRef): string {
  return ref.pattern === undefined
    ? `proposal:${ref.number}`
    : `proposal:${ref.number}#${ref.pattern}`;
}

/** Where a pattern landed: the element to scroll to, and what the first capture group said. */
export interface ProposalMatch {
  /** A section id or a paragraph id. */
  targetId: string;
  /** The first capture group, or the whole match when the pattern has none. */
  label: string;
}

/**
 * The first heading, then the first paragraph first line, the pattern matches, in document
 * order. A pattern that is not a regular expression matches nothing rather than throwing: it
 * came from somebody's prose.
 */
export function matchProposalPattern(
  detail: Pick<ProposalDetail, "sections">,
  pattern: string,
): ProposalMatch | null {
  let re: RegExp;
  try {
    re = new RegExp(pattern);
  } catch {
    return null;
  }
  const found = (id: string, text: string): ProposalMatch | null => {
    const m = re.exec(text);
    if (m === null) return null;
    return { targetId: id, label: m[1] ?? m[0] };
  };
  for (const section of detail.sections) {
    const hit = found(section.id, section.heading);
    if (hit !== null) return hit;
  }
  for (const section of detail.sections) {
    for (const paragraph of section.paragraphs) {
      const firstLine = paragraph.text.split("\n")[0] ?? "";
      const hit = found(paragraph.id, firstLine);
      if (hit !== null) return hit;
    }
  }
  return null;
}

/** The hash the proposals page reads a pattern from (`#p=<encoded pattern>`), or a plain element id. */
export function proposalHashFor(ref: ProposalRef): string {
  return ref.pattern === undefined ? "" : `#p=${encodeURIComponent(ref.pattern)}`;
}

/** What a location hash asks the page to scroll to: a pattern to match, an element id, or nothing. */
export function parseProposalHash(hash: string): { pattern: string } | { targetId: string } | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (raw === "") return null;
  if (raw.startsWith("p=")) {
    try {
      const pattern = decodeURIComponent(raw.slice(2));
      return pattern === "" ? null : { pattern };
    } catch {
      return null;
    }
  }
  return { targetId: raw };
}

/** One line of the timeline: what happened, in the interface language. Read at render time — `S` is a live binding. */
export function eventLine(ev: ProposalEvent, names: ReadonlyMap<string, string>): string {
  const t = S.company.proposals.event;
  switch (ev.kind) {
    case "created":
      return t.created;
    case "revised":
      return t.revised(ev.revision ?? 0);
    case "ready":
      return t.ready;
    case "changes_requested":
      return t.changes_requested(Number(ev.text ?? 0) || 0);
    case "implementation_started":
      return t.implementation_started(ev.text === undefined ? "" : (names.get(ev.text) ?? ev.text));
    case "material_added":
      return t.material_added(ev.text ?? "");
    case "feedback":
      return t.feedback;
    case "runtime_feedback":
      return t.runtime_feedback;
    case "resolved":
      return t.resolved;
    case "approved":
      return t.approved;
    case "merged":
      return t.merged;
    case "rejected":
      return t.rejected;
    default:
      return ev.kind;
  }
}

/** The events whose `text` is prose the reader wants under the line, not a value the line already spent. */
export function eventDetail(ev: ProposalEvent): string | null {
  if (ev.text === undefined || ev.text === "") return null;
  return ev.kind === "feedback" ||
    ev.kind === "runtime_feedback" ||
    ev.kind === "rejected" ||
    ev.kind === "resolved"
    ? ev.text
    : null;
}

/** The separator between a section's paragraphs in its source — the plugin's `PARAGRAPH_GAP`, the one text a comment's offsets index. */
export const PARAGRAPH_GAP = "\n\n";

/** A section's Markdown source: its paragraphs joined by a blank line (the plugin's `sectionSource`). */
export function sectionSource(section: { paragraphs: readonly { text: string }[] }): string {
  return section.paragraphs.map((p) => p.text).join(PARAGRAPH_GAP);
}

/** The span a paragraph occupies in its section's source, or null when the section has no such paragraph. */
export function paragraphSpan(
  section: { paragraphs: readonly { id: string; text: string }[] },
  paragraphId: string,
): { start: number; end: number } | null {
  let at = 0;
  for (const p of section.paragraphs) {
    if (p.id === paragraphId) return { start: at, end: at + p.text.length };
    at += p.text.length + PARAGRAPH_GAP.length;
  }
  return null;
}

/**
 * A section's source as the reader sees it — the Markdown syntax that renders to nothing
 * dropped (fences, inline code marks, emphasis, heading and list marks, a link's target) —
 * with, for every kept character, the source offset it came from. What a selection of the
 * rendered text is matched against, so the match names a range of the source.
 */
export function projectMarkdown(source: string): { plain: string; map: number[] } {
  const plain: string[] = [];
  const map: number[] = [];
  const keep = (i: number) => {
    plain.push(source[i]!);
    map.push(i);
  };
  let i = 0;
  let lineStart = true;
  while (i < source.length) {
    const ch = source[i]!;
    if (lineStart) {
      // A fence line, a heading's marks, a blockquote's bar, a list marker: syntax only.
      const rest = source.slice(i);
      const fence = /^(`{3,}|~{3,})[^\n]*\n?/.exec(rest);
      if (fence !== null) {
        i += fence[0].length;
        continue;
      }
      const lead = /^(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/.exec(rest);
      if (lead !== null) {
        i += lead[0].length;
        lineStart = false;
        continue;
      }
      lineStart = false;
    }
    if (ch === "\n") {
      keep(i);
      i++;
      lineStart = true;
      continue;
    }
    // A link or image: its text stays, its target goes.
    const link = /^!?\[([^\]]*)\]\(([^)]*)\)/.exec(source.slice(i));
    if (link !== null) {
      const textAt = i + (source[i] === "!" ? 2 : 1);
      for (let k = 0; k < link[1]!.length; k++) keep(textAt + k);
      i += link[0].length;
      continue;
    }
    // Emphasis and code marks are syntax; an underscore or asterisk INSIDE a word
    // (`org_desk_notices`, `a*b`) is the word's own and is kept — what the rendering shows.
    if (
      ch === "`" ||
      (isMark(ch) && !isWordChar(source[i - 1])) ||
      (isMark(ch) && !isWordChar(source[i + 1]))
    ) {
      i++;
      continue;
    }
    keep(i);
    i++;
  }
  return { plain: plain.join(""), map };
}

const isMark = (ch: string | undefined): boolean => ch === "*" || ch === "_" || ch === "~";
const isWordChar = (ch: string | undefined): boolean =>
  ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
/** Inline syntax the projection drops; a placed range grows over the ones touching it so the quote is a whole `` `token` `` / `*word*`. */
const isInlineSyntax = (ch: string | undefined): boolean => ch === "`" || isMark(ch);

const collapse = (text: string): string => text.replace(/\s+/g, " ").trim();

/** `needle` in `haystack` with whitespace collapsed on both sides: the haystack range of the first match, or null. What places a quote in rendered text as well as in source. */
export function findPassage(
  haystack: string,
  needle: string,
): { start: number; end: number } | null {
  const target = collapse(needle);
  if (target === "") return null;
  const chars: string[] = [];
  const map: number[] = [];
  let pendingSpace = false;
  for (let i = 0; i < haystack.length; i++) {
    const ch = haystack[i]!;
    if (/\s/.test(ch)) {
      pendingSpace = chars.length > 0;
      continue;
    }
    if (pendingSpace) {
      chars.push(" ");
      map.push(i);
      pendingSpace = false;
    }
    chars.push(ch);
    map.push(i);
  }
  const hit = chars.join("").indexOf(target);
  if (hit < 0) return null;
  return { start: map[hit]!, end: map[hit + target.length - 1]! + 1 };
}

/**
 * The source range a selection of the rendered text names: the selection found in the
 * source's plain projection (whitespace collapsed), else in the raw source, else — when the
 * words cannot be placed — the whole paragraph the selection began in, else null.
 */
export function rangeOfSelection(
  source: string,
  selectedText: string,
  fallback?: {
    section: { paragraphs: readonly { id: string; text: string }[] };
    paragraphId: string;
  },
): { start: number; end: number } | null {
  const { plain, map } = projectMarkdown(source);
  const inPlain = findPassage(plain, selectedText);
  if (inPlain !== null) {
    let start = map[inPlain.start]!;
    let end = map[inPlain.end - 1]! + 1;
    // Grow over the syntax the projection dropped right at the edges: a selection of the
    // rendered `notifyTicket` names the whole `` `notifyTicket` `` in the source.
    const kept = new Set(map);
    while (start > 0 && isInlineSyntax(source[start - 1]) && !kept.has(start - 1)) start--;
    while (end < source.length && isInlineSyntax(source[end]) && !kept.has(end)) end++;
    return { start, end };
  }
  const raw = findPassage(source, selectedText);
  if (raw !== null) return raw;
  if (fallback !== undefined) return paragraphSpan(fallback.section, fallback.paragraphId);
  return null;
}

/** Whether a comment's passage is in the current revision (else it is listed as one on its own revision). */
export function isStaleComment(comment: { revision: number }, currentRevision: number): boolean {
  return comment.revision !== currentRevision;
}

/** The comments on one section in the current revision, by position; pending ones keep their place. */
export function commentsInSection<
  T extends { sectionId: string; revision: number; range: { start: number } },
>(comments: readonly T[], sectionId: string, currentRevision: number): T[] {
  return comments
    .filter((c) => c.sectionId === sectionId && c.revision === currentRevision)
    .sort((a, b) => a.range.start - b.range.start);
}

/** The comments whose passage the current revision no longer has: listed after the sections with their revision. */
export function orphanComments<T extends { revision: number }>(
  comments: readonly T[],
  currentRevision: number,
): T[] {
  return comments.filter((c) => isStaleComment(c, currentRevision));
}

/** What the `proposals/:number?` page shows: the queue, or one proposal. */
export function proposalsRoute(param: string | undefined): { queue: true } | { number: number } {
  if (param === undefined) return { queue: true };
  const n = Number(param);
  return Number.isSafeInteger(n) && n > 0 ? { number: n } : { queue: true };
}

// ---------------------------------------------------------------------------
// The queue's search: GitHub's grammar over the fields a proposal row carries
// ---------------------------------------------------------------------------

/** The query the queue opens on: what is still moving. Merged and rejected proposals are a chip away. */
export const DEFAULT_PROPOSAL_QUERY = "is:open";

/** The keys a token may carry; `status` is spelled the GitHub way too. */
export type ProposalQueryKey = "is" | "author" | "implementer" | "by" | "unread" | "no";

const QUERY_KEYS: ReadonlySet<string> = new Set([
  "is",
  "status",
  "author",
  "implementer",
  "by",
  "unread",
  "no",
]);

export interface ProposalQueryToken {
  key: ProposalQueryKey;
  value: string;
  negated: boolean;
}

export interface ProposalQuery {
  tokens: ProposalQueryToken[];
  /** Free text, lower-cased; every word (or quoted phrase) must match. */
  text: string[];
}

/** The states `is:` accepts; `open` and `closed` are the two halves of the lifecycle. */
const STATE_GROUPS: Record<string, readonly ProposalStatus[]> = {
  open: ["drafting", "ready", "approved"],
  closed: ["merged", "rejected"],
  drafting: ["drafting"],
  ready: ["ready"],
  approved: ["approved"],
  merged: ["merged"],
  rejected: ["rejected"],
};

/** Splits on whitespace, keeping `"a phrase"` (and `key:"a phrase"`) as one word. */
function splitQuery(q: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(q)) !== null) {
    const word = m[1] !== undefined ? m[1] : m[2]!;
    // A key glued to an opening quote: `author:"a b` — the regex took the key as a bare word;
    // glue the next phrase back on. Rare, and the plain split is what GitHub does too.
    out.push(word);
  }
  return out;
}

/** `is:open -author:x "two words" text` → tokens and free text. Unknown keys are free text. */
export function parseProposalQuery(q: string): ProposalQuery {
  const tokens: ProposalQueryToken[] = [];
  const text: string[] = [];
  for (const raw of splitQuery(q)) {
    const negated = raw.startsWith("-") && raw.length > 1;
    const word = negated ? raw.slice(1) : raw;
    const at = word.indexOf(":");
    const key = at > 0 ? word.slice(0, at).toLowerCase() : "";
    const value = at > 0 ? word.slice(at + 1).replace(/^"|"$/g, "") : "";
    if (QUERY_KEYS.has(key) && value !== "") {
      tokens.push({
        key: (key === "status" ? "is" : key) as ProposalQueryKey,
        value: value.toLowerCase(),
        negated,
      });
    } else if (raw.trim() !== "") {
      text.push(raw.toLowerCase());
    }
  }
  return { tokens, text };
}

/** One token against one row. */
function tokenMatches(item: ProposalItem, token: ProposalQueryToken): boolean {
  const v = token.value;
  switch (token.key) {
    case "is": {
      const states = STATE_GROUPS[v];
      return states !== undefined && states.includes(item.status);
    }
    case "author":
      return item.author.toLowerCase() === v;
    case "implementer":
      return item.implementer !== null && item.implementer.toLowerCase() === v;
    case "by": {
      const by = item.delegatedBy.toLowerCase();
      return by === v || by === `user:${v}` || by === `agent:${v}`;
    }
    case "unread":
      return v === "yes" || v === "true" ? item.unread > 0 : item.unread === 0;
    case "no":
      return v === "implementer" ? item.implementer === null : false;
  }
}

/**
 * Same key = OR (`is:ready is:approved` is either), different keys = AND; a negated token
 * excludes; free text must all appear in `#<number>` or the title, case-insensitively.
 */
export function matchesProposalQuery(item: ProposalItem, query: ProposalQuery): boolean {
  const byKey = new Map<ProposalQueryKey, ProposalQueryToken[]>();
  for (const t of query.tokens) {
    const list = byKey.get(t.key) ?? [];
    list.push(t);
    byKey.set(t.key, list);
  }
  for (const list of byKey.values()) {
    const positive = list.filter((t) => !t.negated);
    if (positive.length > 0 && !positive.some((t) => tokenMatches(item, t))) return false;
    if (list.some((t) => t.negated && tokenMatches(item, t))) return false;
  }
  const hay = `#${item.number} ${item.title.toLowerCase()}`;
  return query.text.every((word) => hay.includes(word));
}

/** The rows a query keeps, in the queue's order. */
export function filterProposals(items: readonly ProposalItem[], q: string): ProposalItem[] {
  const query = parseProposalQuery(q);
  return items.filter((p) => matchesProposalQuery(p, query));
}

const tokenText = (key: ProposalQueryKey, value: string): string => `${key}:${value}`;

/** Whether the query carries `key:value` (un-negated); with no value, whether it carries any `key:`. */
export function hasToken(q: string, key: ProposalQueryKey, value?: string): boolean {
  return parseProposalQuery(q).tokens.some(
    (t) => !t.negated && t.key === key && (value === undefined || t.value === value.toLowerCase()),
  );
}

/** The query with every `key:` token (or just `key:value`) removed; free text and other keys stay in place. */
export function withoutToken(q: string, key: ProposalQueryKey, value?: string): string {
  const keep = splitQuery(q).filter((raw) => {
    const parsed = parseProposalQuery(raw).tokens[0];
    if (parsed === undefined) return true;
    return !(parsed.key === key && (value === undefined || parsed.value === value.toLowerCase()));
  });
  return keep.map((w) => (/\s/.test(w) ? `"${w}"` : w)).join(" ");
}

/** The query with `key:value` added once (a chip going on); with `replace`, every other `key:` token goes first. */
export function withToken(
  q: string,
  key: ProposalQueryKey,
  value: string,
  opts: { replace?: boolean } = {},
): string {
  const base = opts.replace === true ? withoutToken(q, key) : q;
  if (hasToken(base, key, value)) return base;
  const stripped = base.trim();
  return stripped === "" ? tokenText(key, value) : `${stripped} ${tokenText(key, value)}`;
}

/**
 * Where a scope file may be inside one session's Workspace: the file as written (a path
 * relative to the Workspace itself), and the file under the organization's shared workspace
 * (what the scope is written against) when that lands inside the session's Workspace. Both
 * as Workspace-relative paths, deduplicated, in that order; empty when neither can be there.
 */
export function scopeFileCandidates(
  file: string,
  sessionWorkspace: string,
  orgWorkspace: string | null,
): string[] {
  const out: string[] = [];
  const push = (rel: string | null) => {
    if (rel !== null && rel !== "" && !out.includes(rel)) out.push(rel);
  };
  push(toWorkspaceRelative(file, sessionWorkspace));
  if (orgWorkspace !== null && orgWorkspace !== "") {
    const root = orgWorkspace.replace(/[\\/]+$/, "");
    push(toWorkspaceRelative(`${root}/${file}`, sessionWorkspace));
  }
  return out;
}

// ---------------------------------------------------------------------------
// What changed since the approved revision
// ---------------------------------------------------------------------------

export interface DiffLine {
  kind: "same" | "add" | "del";
  text: string;
}

/**
 * A line diff of two texts: the longest common subsequence of lines, so an inserted or
 * removed line shows as itself and the rest as `same`. Small on purpose — a proposal's
 * section is a few paragraphs, so the O(n·m) table is nothing.
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before === "" ? [] : before.split("\n");
  const b = after === "" ? [] : after.split("\n");
  const n = a.length;
  const m = b.length;
  // lcs[i][j] = length of the LCS of a[i..] and b[j..]
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] =
        a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: "same", text: a[i]! });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      out.push({ kind: "del", text: a[i]! });
      i++;
    } else {
      out.push({ kind: "add", text: b[j]! });
      j++;
    }
  }
  while (i < n) out.push({ kind: "del", text: a[i++]! });
  while (j < m) out.push({ kind: "add", text: b[j++]! });
  return out;
}

export interface SectionDiff {
  heading: string;
  /** `same`: nothing changed; `changed`: lines differ; `added` / `removed`: the whole section is new or gone. */
  kind: "same" | "changed" | "added" | "removed";
  lines: DiffLine[];
}

/**
 * The sections of the approved revision against the head's, matched by heading (a section
 * keeps its heading across revisions; a renamed one reads as removed + added), in the
 * head's order with the removed ones after. Each compares the section's Markdown source.
 */
export function sectionDiffs(
  before: readonly ProposalSection[],
  after: readonly ProposalSection[],
): SectionDiff[] {
  const out: SectionDiff[] = [];
  const seen = new Set<string>();
  for (const section of after) {
    const old = before.find((s) => s.heading === section.heading && !seen.has(s.heading));
    const source = sectionSource(section);
    if (old === undefined) {
      out.push({
        heading: section.heading,
        kind: "added",
        lines: diffLines("", source),
      });
      continue;
    }
    seen.add(old.heading);
    const lines = diffLines(sectionSource(old), source);
    out.push({
      heading: section.heading,
      kind: lines.every((l) => l.kind === "same") ? "same" : "changed",
      lines,
    });
  }
  for (const old of before) {
    if (seen.has(old.heading)) continue;
    seen.add(old.heading);
    out.push({ heading: old.heading, kind: "removed", lines: diffLines(sectionSource(old), "") });
  }
  return out;
}

/** Whether the page has a diff to show: an approval stands for an older revision than the head, and the proposal is open again. */
export function revisedAfterApproval(detail: {
  status: ProposalStatus;
  revision: number;
  approvedRevision: number | null;
}): boolean {
  return (
    detail.approvedRevision !== null &&
    detail.approvedRevision < detail.revision &&
    (detail.status === "ready" || detail.status === "drafting")
  );
}
