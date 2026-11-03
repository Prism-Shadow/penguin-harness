/**
 * The channel composer's draft (pure, unit tested): the text the box shows, with a picked
 * mention written as `@<display name>`, and the mentions tracked as ranges over that text so
 * the message that is sent still carries the token the server resolves (`@ceo`,
 * `@user:alice`, `@all` — see channel-mentions.ts).
 *
 * Why ranges rather than matching names on send: names are not unique and may hold spaces or
 * CJK, so `@Alice Chen` cannot be read back to an id from the text alone. A range remembers
 * which candidate was picked.
 *
 * A picked mention is one block, so every tracked mention reads `@<name>` by construction:
 *
 * - An edit that reaches into a mention takes all of it. The box reports only its new value, so
 *   the edit is recovered from that and widened to the whole mention (draftApplyEdit): Backspace
 *   at its end, Delete at its start, a word or line delete, a cut, a drop or a keyboard app's
 *   own edit — whatever made the edit, the mention goes in one piece.
 * - The caret never rests inside a mention, and a selection holds a mention whole or not at all
 *   (draftSnapSelection), so typing lands before or after one.
 * - Text typed or pasted anywhere else only moves the mentions after it. A pasted `@Name` is
 *   plain text; a typed or pasted `@id` is left as it is and the server resolves it as always.
 * - A copy, a cut or a drag of text that holds mentions carries them beside its plain text, in a
 *   clipboard type of this app's own (draftSlice, serializeClip), so pasting or dropping that
 *   text into a composer brings them back (parseClip, draftApplyClip). The plain text is the
 *   names, which is what every other app gets and what would otherwise notify nobody.
 * - On send, a mention that touches text the server would read into its token gets a space on
 *   that side (draftWireText), so both `x@Ada` and a typed `@id` right after a mention
 *   (`@张三@ceo`) are delivered.
 */
import { mentionRuns } from "./channel-mentions";

export interface DraftMention {
  /** Offset of the `@` in the draft text. */
  start: number;
  /** The display name shown after the `@`, as it was when the mention was picked. */
  label: string;
  /** What the sent message carries after the `@`: a bare id, `user:<id>` or `all`. */
  wire: string;
}

export interface MentionDraft {
  text: string;
  /** Sorted by `start`, never overlapping, each reading `@<label>` in `text`. */
  mentions: readonly DraftMention[];
}

export const EMPTY_DRAFT: MentionDraft = { text: "", mentions: [] };

/** The offset just past a mention's last character. */
export const mentionEnd = (m: DraftMention): number => m.start + 1 + m.label.length;

/** An edit: the draft text's `from`…`to` replaced by `insert`. */
interface Edit {
  from: number;
  to: number;
  insert: string;
}

/**
 * The edit that turned `prev` into `next`, with the caret at the end of what was inserted. A
 * textarea reports only the new value, so the edit is the span between the longest common
 * prefix and suffix. Where that is ambiguous — an `a` typed after `@Ann` reads the same as one
 * typed after `@Anna` — the caret decides: an insertion ends where the caret stands, so the
 * common suffix cannot reach past it.
 */
function recoverEdit(prev: string, next: string, caret: number): Edit {
  const max = Math.min(prev.length, next.length);
  let suffix = 0;
  while (suffix < max && prev[prev.length - 1 - suffix] === next[next.length - 1 - suffix]) {
    suffix += 1;
  }
  suffix = Math.min(suffix, next.length - caret);
  let prefix = 0;
  const prefixMax = max - suffix;
  while (prefix < prefixMax && prev[prefix] === next[prefix]) prefix += 1;
  return {
    from: prefix,
    to: prev.length - suffix,
    insert: next.slice(prefix, next.length - suffix),
  };
}

/**
 * The edit grown to the whole of every mention it reaches into: one it overlaps, or one an
 * insertion lands strictly inside. An edit that only touches a mention's edge leaves it alone.
 * One pass is enough: growing to a mention's own edges cannot reach a neighbour.
 */
function widen(draft: MentionDraft, edit: Edit): Edit {
  let { from, to } = edit;
  for (const m of draft.mentions) {
    if (m.start < to && mentionEnd(m) > from) {
      from = Math.min(from, m.start);
      to = Math.max(to, mentionEnd(m));
    }
  }
  return { from, to, insert: edit.insert };
}

/** Applies an edit: a mention wholly before it stays, one wholly after it moves, any other is dropped. */
function splice(draft: MentionDraft, { from, to, insert }: Edit): MentionDraft {
  const delta = insert.length - (to - from);
  const mentions: DraftMention[] = [];
  for (const m of draft.mentions) {
    if (mentionEnd(m) <= from) mentions.push(m);
    else if (m.start >= to) mentions.push({ ...m, start: m.start + delta });
  }
  return { text: draft.text.slice(0, from) + insert + draft.text.slice(to), mentions };
}

/**
 * A stretch of a draft on its way through the clipboard: its text, and the mentions wholly inside
 * it with their offsets counted from its start.
 */
export interface DraftClip {
  text: string;
  mentions: readonly DraftMention[];
}

/**
 * Replaces `from`…`to` with the clip, widened like any edit, and tracks the clip's mentions; the
 * caret goes after the clip.
 */
function insertClip(
  draft: MentionDraft,
  from: number,
  to: number,
  clip: DraftClip,
): { draft: MentionDraft; caret: number } {
  const edit = widen(draft, { from, to, insert: clip.text });
  const next = splice(draft, edit);
  const mentions = [
    ...next.mentions,
    ...clip.mentions.map((m) => ({ ...m, start: m.start + edit.from })),
  ].sort((a, b) => a.start - b.start);
  return { draft: { text: next.text, mentions }, caret: edit.from + clip.text.length };
}

/**
 * Replaces the `@query` being typed (`start`…`caret`) with `@<label> ` and tracks the new
 * mention; returns the draft and the caret, which lands after the trailing space.
 */
export function draftInsertMention(
  draft: MentionDraft,
  start: number,
  caret: number,
  label: string,
  wire: string,
): { draft: MentionDraft; caret: number } {
  return insertClip(draft, start, caret, {
    text: `@${label} `,
    mentions: [{ start: 0, label, wire }],
  });
}

/**
 * The draft after the box's value became `next`, `caret` being the end of the box's selection.
 * An edit that reaches into a mention is widened to the whole of it; the text then differs
 * from `next` — the composer writes it back — and the returned caret follows the widened edit.
 * Otherwise the text is `next` and the caret is returned as given.
 */
export function draftApplyEdit(
  draft: MentionDraft,
  next: string,
  caret: number,
): { draft: MentionDraft; caret: number } {
  if (draft.text === next) return { draft, caret };
  const edit = widen(draft, recoverEdit(draft.text, next, caret));
  const edited = splice(draft, edit);
  return { draft: edited, caret: edited.text === next ? caret : edit.from + edit.insert.length };
}

/**
 * The draft for a value the composer must not write back — an input method still composing,
 * or an undo or redo the browser applied: the text is `next` exactly, and a mention the edit
 * reaches into is dropped rather than widened.
 */
export function draftFollowEdit(draft: MentionDraft, next: string, caret: number): MentionDraft {
  if (draft.text === next) return draft;
  return splice(draft, recoverEdit(draft.text, next, caret));
}

/**
 * The clipboard type a copy, a cut or a drag out of the composer carries its mentions in. It
 * rides beside the `text/plain` of the same text, which is the names; only a composer reads it.
 */
export const MENTION_CLIP_TYPE = "application/x-penguin-mentions";

/** The draft's `from`…`to`, for a copy, a cut or a drag: its text and every mention wholly inside it. */
export function draftSlice(draft: MentionDraft, from: number, to: number): DraftClip {
  return {
    text: draft.text.slice(from, to),
    mentions: draft.mentions
      .filter((m) => m.start >= from && mentionEnd(m) <= to)
      .map((m) => ({ ...m, start: m.start - from })),
  };
}

/** The clip as MENTION_CLIP_TYPE carries it: JSON of its text and mentions (`start`, `label`, `wire`). */
export function serializeClip(clip: DraftClip): string {
  return JSON.stringify({ text: clip.text, mentions: clip.mentions });
}

/**
 * The clip a MENTION_CLIP_TYPE payload carries, or null when there is nothing to bring back.
 *
 * - `plain` is the `text/plain` beside it, which is what the box inserts; the payload must be
 *   that text (line endings aside, which the box normalizes), since its mentions are offsets
 *   into it. A payload that does not parse, or whose mentions do not each read `@<label>` in
 *   order, is null too.
 * - A mention comes back only when `labelOf` — the name a pick of its token writes — still gives
 *   its label. The clipboard is shared with every other page and app, and a mention shows one
 *   thing and sends another: this keeps it showing what it sends, and leaves one copied in
 *   another organization, whose ids this one does not know, as the plain name.
 */
export function parseClip(
  payload: string,
  plain: string,
  labelOf: (wire: string) => string,
): DraftClip | null {
  let data: unknown;
  try {
    data = JSON.parse(payload);
  } catch {
    return null;
  }
  const { text, mentions } = (data ?? {}) as { text?: unknown; mentions?: unknown };
  if (typeof text !== "string" || !Array.isArray(mentions)) return null;
  if (text !== plain.replace(/\r\n?/g, "\n")) return null;
  const kept: DraftMention[] = [];
  let end = 0;
  for (const item of mentions as unknown[]) {
    const { start, label, wire } = (item ?? {}) as Record<string, unknown>;
    if (typeof start !== "number" || !Number.isInteger(start) || start < end) return null;
    if (typeof label !== "string" || typeof wire !== "string") return null;
    const m = { start, label, wire };
    end = mentionEnd(m);
    if (text.slice(start, end) !== `@${label}`) return null;
    if (labelOf(wire) === label) kept.push(m);
  }
  return kept.length === 0 ? null : { text, mentions: kept };
}

/**
 * The draft after a paste or a drop put `clip` into the box and its value became `next`, `caret`
 * being the end of the box's selection — the end of what was inserted, as after any insertion.
 * The clip's mentions come back with it, and a mention of the draft that the clip lands inside or
 * replaces part of goes whole, as in draftApplyEdit. Null when `next` is not the draft with the
 * clip put in front of the caret — the box inserted something else — and the caller takes the
 * edit as plain text.
 */
export function draftApplyClip(
  draft: MentionDraft,
  next: string,
  caret: number,
  clip: DraftClip,
): { draft: MentionDraft; caret: number } | null {
  const from = caret - clip.text.length;
  const to = caret + draft.text.length - next.length;
  if (from < 0 || to < from) return null;
  if (next !== draft.text.slice(0, from) + clip.text + draft.text.slice(to)) return null;
  return insertClip(draft, from, to, clip);
}

/**
 * The mention a Backspace right after it, or a Delete right before it, would reach into: the
 * span the composer deletes in the key's place as one native edit, so the browser's own undo
 * brings the whole name back. Null for every other edit, which draftApplyEdit widens instead.
 */
export function mentionDeletedByKey(
  draft: MentionDraft,
  inputType: string,
  selectionStart: number,
  selectionEnd: number,
): { start: number; end: number } | null {
  if (selectionStart !== selectionEnd) return null;
  const m = draft.mentions.find((x) =>
    inputType === "deleteContentBackward"
      ? mentionEnd(x) === selectionStart
      : inputType === "deleteContentForward" && x.start === selectionStart,
  );
  return m === undefined ? null : { start: m.start, end: mentionEnd(m) };
}

export interface DraftSelection {
  start: number;
  end: number;
  /** The focus — the end that moves — is `start`. */
  backward: boolean;
}

/**
 * The selection with neither end inside a mention.
 *
 * - When the keyboard (or an input method) moved the selection, `focusFrom` is where its focus
 *   stood before: a focus that stepped into a mention goes on to the far edge, so the arrow keys
 *   step over a mention and Shift+arrow grows or shrinks a selection by the whole of it.
 * - When a pointer placed it, `focusFrom` is null: a caret goes to the nearer edge, and a range
 *   grows outward to hold every mention it cuts into (a drag, a double-click on part of a name).
 * - An end that did not move but that an edit left inside a mention grows outward too.
 */
export function draftSnapSelection(
  draft: MentionDraft,
  selection: DraftSelection,
  focusFrom: number | null,
): { start: number; end: number } {
  const snap = (offset: number, side: "start" | "end" | "caret", isFocus: boolean): number => {
    const m = draft.mentions.find((x) => x.start < offset && offset < mentionEnd(x));
    if (m === undefined) return offset;
    const before = m.start;
    const after = mentionEnd(m);
    if (isFocus && focusFrom !== null && focusFrom !== offset) {
      return focusFrom < offset ? after : before;
    }
    if (side === "start") return before;
    if (side === "end") return after;
    return offset - before < after - offset ? before : after;
  };
  const { start, end, backward } = selection;
  if (start === end) {
    const at = snap(start, "caret", true);
    return { start: at, end: at };
  }
  return { start: snap(start, "start", backward), end: snap(end, "end", !backward) };
}

/** Whether a tracked mention holds the character at `offset` (the composer opens no `@` panel there). */
export function mentionCovers(draft: MentionDraft, offset: number): boolean {
  return draft.mentions.some((m) => m.start <= offset && offset < mentionEnd(m));
}

/**
 * The text the send button posts: every mention as its token, everything else verbatim, with a
 * space wherever a token would otherwise not read as itself under the server's grammar
 * (mentionRuns mirrors it).
 *
 * - Before the `@`, when what precedes would glue it: a word character (`x@Ada`), or the tail
 *   of another token that swallows the character the `@` needs in front of it (`@bob.@Ada`).
 * - After the token, when the draft goes on with characters that would extend the id
 *   (`@Ada.md`), or with an `@` the converted id would glue — a typed `@id` right after a
 *   CJK name reads as a mention in the draft, and must still read as one once the name is an id.
 */
export function draftWireText(draft: MentionDraft): string {
  let out = "";
  let last = 0;
  for (const m of draft.mentions) {
    out += draft.text.slice(last, m.start);
    if (mentionRuns(`${out}@${m.wire}`).at(-1)?.mention !== m.wire) out += " ";
    out += `@${m.wire}`;
    last = mentionEnd(m);
    const rest = draft.text.slice(last);
    if (mentionRuns(`@${m.wire}${rest}`)[0]?.mention !== m.wire || /^[.-]*@/.test(rest)) {
      out += " ";
    }
  }
  return out + draft.text.slice(last);
}

export interface DraftSegment {
  text: string;
  /** True for a mention's `@<label>`. */
  mention: boolean;
}

/** The draft split for the composer's highlight layer: plain runs and mentions, in order. */
export function draftSegments(draft: MentionDraft): DraftSegment[] {
  const out: DraftSegment[] = [];
  let last = 0;
  for (const m of draft.mentions) {
    if (m.start > last) out.push({ text: draft.text.slice(last, m.start), mention: false });
    out.push({ text: `@${m.label}`, mention: true });
    last = mentionEnd(m);
  }
  if (last < draft.text.length) out.push({ text: draft.text.slice(last), mention: false });
  return out;
}

/** How many drafts with mentions the composer keeps for undo and redo. */
const HISTORY_SIZE = 50;

/**
 * Recent drafts that held mentions, oldest first, one per text. An undo or redo gives back only
 * text; when that text is one of these, its mentions come back with it.
 */
export type DraftHistory = readonly MentionDraft[];

/** The history with `draft` added (a draft without mentions is not worth keeping). */
export function draftRemember(history: DraftHistory, draft: MentionDraft): DraftHistory {
  if (draft.mentions.length === 0) return history;
  return [...history.filter((d) => d.text !== draft.text), draft].slice(-HISTORY_SIZE);
}

/** The remembered draft whose text is `text`, if any. */
export function draftRecall(history: DraftHistory, text: string): MentionDraft | null {
  return history.find((d) => d.text === text) ?? null;
}
