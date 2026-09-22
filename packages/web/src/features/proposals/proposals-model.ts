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

/** Sentence punctuation a bare reference at the end of a sentence would otherwise swallow. */
export function trimPatternPunctuation(pattern: string): string {
  return pattern.replace(/[.,;:!?)\]}]$/, "");
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

/** The comments on one paragraph, pending first, then by time; a resolved one keeps its place. */
export function commentsOn<T extends { paragraphId: string; at: string; batchId: string | null }>(
  comments: readonly T[],
  paragraphId: string,
): T[] {
  return comments
    .filter((c) => c.paragraphId === paragraphId)
    .sort((a, b) => {
      const aPending = a.batchId === null ? 0 : 1;
      const bPending = b.batchId === null ? 0 : 1;
      if (aPending !== bPending) return aPending - bPending;
      return a.at < b.at ? -1 : a.at > b.at ? 1 : 0;
    });
}

/** The comments whose paragraph no longer exists in the current revision, by the section they are listed under (the last one). */
export function orphanComments<T extends { paragraphId: string }>(
  comments: readonly T[],
  sections: ProposalDetail["sections"],
): T[] {
  const live = new Set(sections.flatMap((s) => s.paragraphs.map((p) => p.id)));
  return comments.filter((c) => !live.has(c.paragraphId));
}

/** The queue's search: number or title, case-insensitively. */
export function filterProposals(items: readonly ProposalItem[], query: string): ProposalItem[] {
  const q = query.trim().toLowerCase();
  if (q === "") return [...items];
  return items.filter(
    (p) =>
      `#${p.number}`.includes(q) || String(p.number) === q || p.title.toLowerCase().includes(q),
  );
}
