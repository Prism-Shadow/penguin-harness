/**
 * A channel's @-mentions (pure, unit tested): the candidates the composer offers — the
 * channel's own members, plus `all` — and how they rank against what was typed, the token
 * being typed at the caret, what a pick types and how it is spliced into the draft, how a
 * stored message is split into plain runs and mention runs for highlighting, and what a
 * mention run displays and whether it addresses the reader. What can follow `@` mirrors the
 * server's findMentions (organization/names.ts) — an employee's id or its NAME, a member's
 * user id, `all`, and the explicit `@agent:id` / `@user:id` — with its rules: the longest
 * handle wins, an ASCII handle ends at the end of its word, a name in a script without spaces
 * needs no space after it, and an employee comes before a member of the same id. So what the
 * composer highlights is what the server delivers.
 *
 * Membership is the source, not the org chart: a mention delivers only inside the channel it
 * was written in, and the server rejects a message naming an outsider (`mention_not_member`).
 * The composer therefore offers the channel's members and nobody else.
 */

export type MentionKind = "employee" | "member" | "all";

export interface MentionCandidate {
  /** The principal the pick stands for (`agent:<id>`, `user:<id>`, `all`). */
  principal: string;
  /** The display name (an employee's name, a member's user id, "everyone"). */
  label: string;
  /** The bare id the user may have typed (`ceo`, `alice`, `all`). */
  id: string;
  kind: MentionKind;
  /** Secondary text beside the name: an employee's title. */
  detail?: string;
}

/** Employees first, then Project members, then `all` — the order the panel lists them in. */
export function mentionCandidates(
  employees: ReadonlyArray<{ agentId: string; name: string; title?: string }>,
  members: readonly string[],
  allLabel: string,
): MentionCandidate[] {
  const out: MentionCandidate[] = employees.map((e) => ({
    principal: `agent:${e.agentId}`,
    label: e.name,
    id: e.agentId,
    kind: "employee" as const,
    ...(e.title !== undefined && e.title.trim() !== "" ? { detail: e.title.trim() } : {}),
  }));
  for (const userId of members) {
    out.push({ principal: `user:${userId}`, label: userId, id: userId, kind: "member" });
  }
  out.push({ principal: "all", label: allLabel, id: "all", kind: "all" });
  return out;
}

/**
 * Candidates ranked for the panel: an id or name that starts with the query ranks above one
 * that merely contains it (or whose principal does), and ties keep the list's own order —
 * employees, then members, then `all`. An empty query keeps everyone in that order.
 */
export function rankMentionCandidates(
  candidates: readonly MentionCandidate[],
  query: string,
): MentionCandidate[] {
  const q = query.trim().toLowerCase();
  if (q === "") return [...candidates];
  const scored: Array<{ c: MentionCandidate; score: number; i: number }> = [];
  candidates.forEach((c, i) => {
    const id = c.id.toLowerCase();
    const label = c.label.toLowerCase();
    const score =
      id.startsWith(q) || label.startsWith(q)
        ? 0
        : id.includes(q) || label.includes(q) || c.principal.toLowerCase().includes(q)
          ? 1
          : -1;
    if (score >= 0) scored.push({ c, score, i });
  });
  return scored.sort((a, b) => a.score - b.score || a.i - b.i).map((s) => s.c);
}

/**
 * What a pick types after the `@`: an employee's NAME — what people read, and unique across
 * the organization by construction (the server notes the id on a shared one) — a member's
 * bare id, unless an employee shares it, in which case `user:` disambiguates, since a bare id
 * resolves to the employee first; and `all`.
 */
export function mentionInsertId(
  c: MentionCandidate,
  candidates: readonly MentionCandidate[],
): string {
  if (c.kind === "employee") return c.label.includes("@") || c.label.trim() === "" ? c.id : c.label;
  if (c.kind === "member" && candidates.some((o) => o.kind === "employee" && o.id === c.id)) {
    return `user:${c.id}`;
  }
  return c.id;
}

/** What a mention token displays: the employee's name for an agent id (prefixed or bare), the user id for a member, the "everyone" label for `all`. */
export function mentionLabel(
  token: string,
  names: ReadonlyMap<string, string>,
  allLabel: string,
): string {
  if (token === "all") return allLabel;
  const m = /^(agent|user):(.+)$/.exec(token);
  if (m) return m[1] === "agent" ? (names.get(m[2]!) ?? m[2]!) : m[2]!;
  return names.get(token) ?? token;
}

/** Whether a mention token addresses this user: their `user:` principal, `all`, or their bare id when no employee claims it. */
export function mentionIsMe(
  token: string,
  userId: string,
  employeeIds: ReadonlySet<string>,
): boolean {
  if (userId === "") return false;
  if (token === "all" || token === `user:${userId}`) return true;
  return token === userId && !employeeIds.has(userId);
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
  // Any script: a name may be 小明. A space ends the token — a name with one in it is picked
  // from the panel before the space is typed.
  if (!/^[^\s@]*$/.test(query)) return null;
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

const ASCII_TOKEN = /^((?:(?:agent|user):)?[A-Za-z0-9][A-Za-z0-9_.-]*)/;
const WORD = /[A-Za-z0-9_]/;

/**
 * Splits a message into plain runs and mention runs, in order. `names` are the employees'
 * names (name → agent id): a mention by name becomes a run whose token is `agent:<id>`, so
 * it is labelled and recognised exactly like one written by id. Without them only the ASCII
 * forms are found, as before; trailing `.`/`-` stay outside the mention as the server reads
 * them.
 */
export function mentionRuns(
  text: string,
  names: ReadonlyMap<string, string> = new Map(),
): TextRun[] {
  const byLength = [...names.keys()].sort((a, b) => b.length - a.length);
  const runs: TextRun[] = [];
  let last = 0;
  for (let at = text.indexOf("@"); at !== -1; at = text.indexOf("@", at + 1)) {
    const before = at === 0 ? "" : text[at - 1]!;
    if (before === "@" || WORD.test(before)) continue;
    const rest = text.slice(at + 1);
    let ascii = ASCII_TOKEN.exec(rest)?.[1] ?? "";
    ascii = ascii.replace(/[.-]+$/, "");
    if (/^(agent|user):$/.test(ascii)) ascii = "";
    const name = byLength.find((handle) => {
      if (handle === "" || !rest.startsWith(handle)) return false;
      const next = rest[handle.length] ?? "";
      return !(WORD.test(handle[handle.length - 1]!) && WORD.test(next));
    });
    // The longest reading wins, as on the server: a name that goes further than the id-shaped
    // token is the mention; otherwise the token is.
    const byName = name !== undefined && name.length >= ascii.length;
    const shown = byName ? name : ascii;
    if (shown === "") continue;
    if (at > last) runs.push({ text: text.slice(last, at), mention: null });
    runs.push({ text: `@${shown}`, mention: byName ? `agent:${names.get(name)!}` : ascii });
    last = at + 1 + shown.length;
    at = last - 1;
  }
  if (last < text.length) runs.push({ text: text.slice(last), mention: null });
  return runs;
}

/** Employees' names as `mentionRuns` wants them (name → agent id), from the usual id → name map. */
export function mentionNameHandles(names: ReadonlyMap<string, string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [agentId, name] of names)
    if (name !== agentId && !name.includes("@")) out.set(name, agentId);
  return out;
}

/**
 * The candidates a channel's composer offers: everyone above who is a member of it, `all`
 * always kept (it means that channel's membership). A null membership — the channel detail
 * has not arrived, or its request failed — offers the whole list rather than an empty panel:
 * the server still refuses a mention that leaves the channel, so this degrades to a slower
 * error rather than to a composer that can name nobody.
 */
export function channelMentionCandidates(
  candidates: readonly MentionCandidate[],
  memberPrincipals: ReadonlySet<string> | null,
): MentionCandidate[] {
  if (memberPrincipals === null) return [...candidates];
  return candidates.filter((c) => c.kind === "all" || memberPrincipals.has(c.principal));
}
