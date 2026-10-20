/**
 * A channel's @-mentions (pure, unit tested): the candidates the composer offers — the
 * channel's own members, the org's live squads, plus `all` — and how they rank against
 * what was typed, the token being typed at the caret, what a pick sends (the draft that
 * shows it by name is mention-draft.ts), how a stored message is split into plain runs
 * and mention runs for highlighting, and what a mention run displays and whether it
 * addresses the reader.
 *
 * TRIGGERING is exact (organization/names.ts): only `[@Label](mention://agent|user|squad/<id>)`
 * and `[@Label](mention://all)` page someone; a bare `@name`, `@id`, `@all` or `@agent:<id>`
 * in prose is inert. Picks therefore always insert the markdown form. RENDERING is generous:
 * mentionRuns also chips legacy bare handles, so messages written before the exact grammar
 * keep their chips — a chip is display, never proof of delivery.
 *
 * Membership is the source, not the org chart: a mention delivers only inside the channel it
 * was written in, and the server rejects a message naming an outsider (`mention_not_member`).
 * The composer therefore offers the channel's members and nobody else — a squad through its
 * leader, exactly as the server's outsider check covers squads by their leader's membership.
 */

export type MentionKind = "employee" | "member" | "squad" | "all";

export interface MentionCandidate {
  /** The principal the pick stands for (`agent:<id>`, `user:<id>`, `squad:<id>`, `all`). */
  principal: string;
  /** The display name (an employee's name, a member's user id, a squad's name, "everyone"). */
  label: string;
  /** The bare id the user may have typed (`ceo`, `alice`, `<squad id>`, `all`). */
  id: string;
  kind: MentionKind;
  /** Secondary text beside the name: an employee's title. */
  detail?: string;
  /** A squad's leader principal (`agent:<id>`): the channel filter's membership test. */
  leader?: string;
}

/** Employees first, then Project members, then live squads, then `all` — the order the panel lists them in. */
export function mentionCandidates(
  employees: ReadonlyArray<{ agentId: string; name: string; title?: string }>,
  members: readonly string[],
  allLabel: string,
  squads: readonly { id: string; name: string; leader: string }[] = [],
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
  for (const squad of squads) {
    out.push({
      principal: `squad:${squad.id}`,
      label: squad.name,
      id: squad.id,
      kind: "squad",
      leader: squad.leader,
    });
  }
  out.push({ principal: "all", label: allLabel, id: "all", kind: "all" });
  return out;
}

/**
 * Candidates ranked for the panel: an id or name that starts with the query ranks above one
 * that merely contains it (or whose principal does), and ties keep the list's own order —
 * employees, then members, then squads, then `all`. An empty query keeps everyone in that order.
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
 * What a pick sends: always the exact markdown — `[@Label](mention://agent|user|squad/<id>)`,
 * `[@Everyone](mention://all)` — since bare handles no longer trigger on the server. The
 * label is the candidate's display name with brackets stripped (a name may hold any script
 * and spaces, but link brackets would break the span); the URL carries kind and id.
 */
export function mentionInsertWire(
  c: MentionCandidate,
  _candidates: readonly MentionCandidate[],
): string {
  void _candidates;
  const label = c.label.replace(/[\[\]]/g, "");
  if (c.kind === "all") return `[@${label}](mention://all)`;
  const kind = c.kind === "squad" ? "squad" : c.kind === "member" ? "user" : "agent";
  return `[@${label}](mention://${kind}/${c.id})`;
}

/** The mention token a draft wire carries: the `kind:id` (or `all`) inside its markdown, or the wire itself when it predates the exact grammar (old clipboard payloads). */
export function wireToken(wire: string): string {
  const m = /^\[@[^\]\n]*\]\(mention:\/\/(?:(agent|user|squad)\/([^)\s]+)|(all))\)$/.exec(wire.trim());
  if (!m) return wire;
  return m[3] === "all" ? "all" : `${m[1]}:${m[2]}`;
}

/** What a mention token displays: the employee's name for an agent id (prefixed or bare), the user id for a member, the squad's name for `squad:<id>` (the names map carries `squad:<id>` → name entries for this), the "everyone" label for `all`. */
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

/**
 * What a mention chip adds after the name: the employee's title, so a reader sees what the
 * person addressed does without opening the chart. Empty for a member, for `all`, and for an
 * employee without a title — and when the title is all the name already says.
 */
export function mentionNote(token: string, titles: ReadonlyMap<string, string>): string {
  if (token === "all") return "";
  const m = /^(agent|user):(.+)$/.exec(token);
  if (m?.[1] === "user") return "";
  return titles.get(m?.[2] ?? token)?.trim() ?? "";
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
 * character that cannot be part of an id, and the token runs unbroken to the caret — letters
 * of any script, digits and `_:.-`, so a name typed in CJK searches too. Null when the caret
 * is not inside such a token (the panel then stays closed).
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
  if (!/^[\p{L}\p{N}_:.-]*$/u.test(query)) return null;
  return { start: at, query };
}

export interface TextRun {
  text: string;
  /** The mention token without its `@` (`agent:ceo`, `ceo`, `all`), or null for a plain run. */
  mention: string | null;
}

const ASCII_TOKEN = /^((?:(?:agent|user|squad):)?[A-Za-z0-9][A-Za-z0-9_.-]*)/;
const WORD = /[A-Za-z0-9_]/;

/**
 * Whether a handle `rest` starts with may end there — the server's rule (endsHandle in
 * organization/names.ts), copied because the two packages share no code: a handle ending in
 * an ASCII word character must not be followed by a word character, nor by a `-` or `.` that
 * goes on into one (`@Ada Lovelace-x` is not Ada; `@Ada Lovelace.` is).
 */
function endsHandle(handle: string, rest: string): boolean {
  if (!WORD.test(handle[handle.length - 1]!)) return true;
  const next = rest[handle.length] ?? "";
  if (WORD.test(next)) return false;
  return !((next === "-" || next === ".") && WORD.test(rest[handle.length + 1] ?? ""));
}

/**
 * Splits a message into plain runs and mention runs, in order: the exact markdown spans
 * first (the server's grammar, character for character — the run's token is the URL's
 * `kind:id`, or `all`, so labels and chips read exactly like the stored mention), then
 * the legacy bare handles in the gaps between them (`@id`, `@name`, `@all`,
 * `@agent|user|squad:<id>`), so messages written before the exact grammar keep their
 * chips. A chip is display: only the markdown spans page someone.
 *
 * `names` are the employees' names (name → agent id) for the legacy pass: a mention by
 * name becomes a run whose token is `agent:<id>`. Without them only the ASCII legacy
 * forms are found; trailing `.`/`-` stay outside a legacy mention as they always did.
 */
export function mentionRuns(
  text: string,
  names: ReadonlyMap<string, string> = new Map(),
): TextRun[] {
  const spans: Array<{ start: number; end: number; token: string }> = [];
  MENTION_MD_RUN.lastIndex = 0;
  for (let m = MENTION_MD_RUN.exec(text); m !== null; m = MENTION_MD_RUN.exec(text)) {
    spans.push({
      start: m.index,
      end: m.index + m[0].length,
      token: m[4] === "all" ? "all" : `${m[2]}:${m[3]}`,
    });
  }
  const runs: TextRun[] = [];
  let last = 0;
  for (const span of spans) {
    if (span.start > last) runs.push(...legacyRuns(text.slice(last, span.start), names));
    runs.push({ text: text.slice(span.start, span.end), mention: span.token });
    last = span.end;
  }
  if (last < text.length) runs.push(...legacyRuns(text.slice(last), names));
  return runs;
}

// The exact span, mirrored from the server (organization/names.ts): an `@`-labelled link
// to mention://agent|user|squad/<id> or mention://all. The label must start with `@`.
const MENTION_MD_RUN =
  /\[(@[^\]\n]*)\]\(mention:\/\/(?:(agent|user|squad)\/([^)\s]+)|(all))\)/g;

// The same grammar read from a URL alone: the mention's principal lives in the destination,
// and a Markdown link's destination is what the renderer gets to see.
const MENTION_URL = /^mention:\/\/(?:(agent|user|squad)\/([^)\s]+)|(all))$/;

/**
 * The mention token a URL carries (`agent:<id>`, `user:<id>`, `squad:<id>` or `all`), or null
 * for any other URL.
 *
 * A mention written in the exact grammar is a Markdown LINK by the time the renderer sees it:
 * `[@Label](mention://user/admin)` is parsed as a link whose text is the label and whose
 * destination is the principal. So the text pass never sees the span — the principal has to be
 * read from the link's destination, or the mention renders as a dead link instead of a chip.
 */
export function mentionUrlToken(url: string | null | undefined): string | null {
  if (typeof url !== "string") return null;
  const m = MENTION_URL.exec(url);
  if (m === null) return null;
  return m[3] === "all" ? "all" : `${m[1]}:${m[2]}`;
}

/** The pre-exact-grammar pass over one gap between markdown spans: bare handles chip, but page nobody. */
function legacyRuns(text: string, names: ReadonlyMap<string, string>): TextRun[] {
  const byLength = [...names.keys()].sort((a, b) => b.length - a.length);
  const runs: TextRun[] = [];
  let last = 0;
  for (let at = text.indexOf("@"); at !== -1; at = text.indexOf("@", at + 1)) {
    const before = at === 0 ? "" : text[at - 1]!;
    if (before === "@" || WORD.test(before)) continue;
    const rest = text.slice(at + 1);
    let ascii = ASCII_TOKEN.exec(rest)?.[1] ?? "";
    ascii = ascii.replace(/[.-]+$/, "");
    if (/^(agent|user|squad):$/.test(ascii)) ascii = "";
    const name = byLength.find(
      (handle) => handle !== "" && rest.startsWith(handle) && endsHandle(handle, rest),
    );
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

/** Employees' names as `mentionRuns` wants them (name → agent id), from the usual id → name map. Keys that are principals rather than bare ids (`squad:<id>` entries the channel view adds so chips label squads) are skipped: a squad's name must not become a name-handle, since the server resolves no bare name to a squad. */
export function mentionNameHandles(names: ReadonlyMap<string, string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [agentId, name] of names) {
    if (agentId.includes(":")) continue;
    if (name !== agentId && !name.includes("@")) out.set(name, agentId);
  }
  return out;
}

/**
 * The candidates a channel's composer offers: everyone above who is a member of it, `all`
 * always kept (it means that channel's membership). A squad is kept when its leader is a
 * member — the server's outsider rule, which covers squads by their leader's membership —
 * and dropped when its leader is unknown. A null membership — the channel detail
 * has not arrived, or its request failed — offers the whole list rather than an empty panel:
 * the server still refuses a mention that leaves the channel, so this degrades to a slower
 * error rather than to a composer that can name nobody.
 */
export function channelMentionCandidates(
  candidates: readonly MentionCandidate[],
  memberPrincipals: ReadonlySet<string> | null,
): MentionCandidate[] {
  if (memberPrincipals === null) return [...candidates];
  return candidates.filter((c) => {
    if (c.kind === "all") return true;
    if (c.kind === "squad") return c.leader !== undefined && memberPrincipals.has(c.leader);
    return memberPrincipals.has(c.principal);
  });
}
