/**
 * The organization chat's @-mentions (pure, unit tested): the candidates the composer offers
 * (employees, Project members, `all`), the token being typed at the caret, how a pick is
 * spliced into the draft, and how a stored message is split into plain runs and mention runs
 * for highlighting. The token grammar mirrors the server's extractMentionTokens — `@id`,
 * `@agent:id`, `@user:id`, `@all` — so what the composer highlights is what the server
 * delivers.
 */

export type MentionKind = "employee" | "member" | "all";

export interface MentionCandidate {
  /** The principal the pick inserts (`agent:<id>`, `user:<id>`, `all`). */
  principal: string;
  /** The display name (an employee's name, a member's user id, "everyone"). */
  label: string;
  /** The bare id the user may have typed (`ceo`, `alice`, `all`). */
  id: string;
  kind: MentionKind;
}

/** Employees first, then members, then `all` — the order the panel lists them in. */
export function mentionCandidates(
  employees: ReadonlyArray<{ agentId: string; name: string }>,
  members: readonly string[],
  allLabel: string,
): MentionCandidate[] {
  const out: MentionCandidate[] = employees.map((e) => ({
    principal: `agent:${e.agentId}`,
    label: e.name,
    id: e.agentId,
    kind: "employee" as const,
  }));
  for (const userId of members) {
    out.push({ principal: `user:${userId}`, label: userId, id: userId, kind: "member" });
  }
  out.push({ principal: "all", label: allLabel, id: "all", kind: "all" });
  return out;
}

/** Case-insensitive substring match on the id, the label or the full principal; an empty query keeps everyone. */
export function filterMentionCandidates(
  candidates: readonly MentionCandidate[],
  query: string,
): MentionCandidate[] {
  const q = query.trim().toLowerCase();
  if (q === "") return [...candidates];
  return candidates.filter(
    (c) =>
      c.id.toLowerCase().includes(q) ||
      c.label.toLowerCase().includes(q) ||
      c.principal.toLowerCase().includes(q),
  );
}

/**
 * The `@token` the caret sits at the end of, if any: the `@` must start the text or follow a
 * character that cannot be part of an id, and the token runs unbroken to the caret. Null when
 * the caret is not inside such a token (the panel then stays closed).
 */
export function mentionQueryAt(
  text: string,
  caret: number,
): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at === -1) return null;
  if (at > 0 && /[A-Za-z0-9_@]/.test(before[at - 1]!)) return null;
  const query = before.slice(at + 1);
  if (!/^[A-Za-z0-9_:.-]*$/.test(query)) return null;
  return { start: at, query };
}

/** Replaces the token at `start`…`caret` with the principal and a trailing space; returns the new text and caret. */
export function insertMention(
  text: string,
  start: number,
  caret: number,
  principal: string,
): { text: string; caret: number } {
  const inserted = `@${principal} `;
  const next = text.slice(0, start) + inserted + text.slice(caret);
  return { text: next, caret: start + inserted.length };
}

export interface TextRun {
  text: string;
  /** The mention token without its `@` (`agent:ceo`, `ceo`, `all`), or null for a plain run. */
  mention: string | null;
}

const MENTION_RE = /(^|[^A-Za-z0-9_@])@((?:(?:agent|user):)?[A-Za-z0-9][A-Za-z0-9_.-]*)/g;

/** Splits a message into plain runs and mention runs, in order; trailing `.`/`-` stay outside the mention as the server reads them. */
export function mentionRuns(text: string): TextRun[] {
  const runs: TextRun[] = [];
  let last = 0;
  for (const m of text.matchAll(MENTION_RE)) {
    const lead = m[1]!;
    let token = m[2]!;
    const trailing = /[.-]+$/.exec(token)?.[0] ?? "";
    token = token.slice(0, token.length - trailing.length);
    if (token === "" || /^(agent|user):$/.test(token)) continue;
    const mentionStart = m.index + lead.length;
    if (mentionStart > last) runs.push({ text: text.slice(last, mentionStart), mention: null });
    runs.push({ text: `@${token}`, mention: token });
    last = mentionStart + 1 + token.length;
  }
  if (last < text.length) runs.push({ text: text.slice(last), mention: null });
  return runs;
}

/** Whether a message addresses the given user (their `user:` principal) or everyone. */
export function mentionsUser(mentions: readonly string[], userId: string): boolean {
  return mentions.includes(`user:${userId}`) || mentions.includes("all");
}
