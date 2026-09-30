/**
 * The pacing of a streaming reply's reveal, as pure functions of the text and the clock, so it
 * is testable without a DOM or a frame loop (use-stream-reveal.ts drives it once per animation
 * frame).
 *
 * The state holds a cursor, in characters, that moves through the text received so far at the
 * theme's rate. What the reader sees is the text up to the cursor, cut where Markdown renders
 * cleanly:
 *
 * - `typewriter` cuts at the cursor, character by character;
 * - `fade` cuts at the last word boundary before it (every CJK character is a word of its own),
 *   so whole words come in at the same characters-per-second pace;
 * - both hold back a line that so far carries only block syntax (`-`, `1.`, `#`, a fence's
 *   backticks, a table's rule), and never split a run of `*`, `_`, `~` or backticks. A lone `-`
 *   under a paragraph would render the paragraph as a heading for a frame, an empty `#` an empty
 *   heading, two backticks an inline code span; each of those turns into something else one
 *   character later, which reads as flicker. The held characters come in with the first
 *   character that settles the line.
 *
 * The reveal never trails the stream by more than {@link REVEAL_MAX_LAG_MS}: every arrival
 * carries a deadline, and when the rate would miss one the cursor speeds up just enough to meet
 * it — smoothly, never by a jump. When the stream ends, the rest comes in at the same rate
 * under the same deadlines. At the live edge, while the stream is open and its last arrival is
 * younger than the deadline, a partial word or a syntax-only line waits for the next delta.
 */
import type { StreamRevealMode } from "../../lib/stream-style";

/** The most the reveal may trail the stream: text that arrived this long ago is on screen. */
export const REVEAL_MAX_LAG_MS = 1500;

/** One arrival not yet fully revealed: where it ends in the text and when it must be showing. */
export interface RevealDue {
  readonly end: number;
  readonly by: number;
}

export interface RevealState {
  /** The text received so far. */
  readonly text: string;
  /** The reveal cursor, in characters; fractional between frames. */
  readonly cursor: number;
  /** Arrivals the cursor has not passed yet, oldest first. */
  readonly due: readonly RevealDue[];
  /** When the latest arrival's deadline falls: until then the live edge may hold a partial word. */
  readonly settleBy: number;
  /** The clock at the last step, ms. */
  readonly at: number;
}

/** A reveal with nothing left to show: the whole text is on screen. */
export function settledReveal(text: string, now: number): RevealState {
  return { text, cursor: text.length, due: [], settleBy: now, at: now };
}

/**
 * A reply's reveal when it first renders. A settled reply, or one with nothing to pace with,
 * shows whole. A streaming one normally starts empty (the fragment opens before its first
 * delta); if it mounts with text already in it — a reload or a switch back into a running
 * Session — only the last {@link REVEAL_MAX_LAG_MS} of it at the rate is revealed again, so
 * the text the reader has already seen does not type itself out a second time.
 */
export function startReveal(
  text: string,
  now: number,
  pace: { streaming: boolean; rate: number },
): RevealState {
  if (!pace.streaming || pace.rate <= 0) return settledReveal(text, now);
  const cursor = Math.max(0, text.length - (pace.rate * REVEAL_MAX_LAG_MS) / 1000);
  return {
    text,
    cursor,
    due: cursor < text.length ? [{ end: text.length, by: now + REVEAL_MAX_LAG_MS }] : [],
    settleBy: now + REVEAL_MAX_LAG_MS,
    at: now,
  };
}

/** The length of the prefix two strings share. */
function sharedPrefix(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  return i;
}

/**
 * New text arrived. An extension of the old text queues its new tail under a fresh deadline.
 * Text that replaced the old (the complete message settling a fragment with different
 * content) keeps what the two share: the cursor falls back to the shared prefix if it was past
 * it, and the rest reveals as new.
 */
export function receiveText(state: RevealState, text: string, now: number): RevealState {
  if (text === state.text) return state;
  const kept = text.startsWith(state.text) ? state.text.length : sharedPrefix(state.text, text);
  const cursor = Math.min(state.cursor, kept);
  const due = state.due
    .map((d) => (d.end > kept ? { end: kept, by: d.by } : d))
    .filter((d) => d.end > cursor);
  const grew = text.length > kept;
  if (grew) due.push({ end: text.length, by: now + REVEAL_MAX_LAG_MS });
  return {
    text,
    cursor,
    due,
    settleBy: grew ? now + REVEAL_MAX_LAG_MS : state.settleBy,
    // A reveal that had caught up was not stepping: its clock restarts now, or the time it sat
    // idle would count as reveal time and the new text would show at once.
    at: state.cursor >= state.text.length ? now : state.at,
  };
}

/**
 * Moves the cursor to `now`: `rate` characters per second, or faster where an arrival's
 * deadline needs it — the cursor then heads for that arrival's end so as to reach it exactly at
 * the deadline. A step past a deadline lands on the arrival's end.
 */
export function stepReveal(state: RevealState, now: number, rate: number): RevealState {
  const length = state.text.length;
  if (now <= state.at) return state;
  if (state.cursor >= length) return { ...state, due: [], at: now };
  const dt = now - state.at;
  let cursor = state.cursor + (rate * dt) / 1000;
  for (const d of state.due) {
    const left = d.by - state.at;
    const needed = left <= dt ? d.end : state.cursor + ((d.end - state.cursor) * dt) / left;
    if (needed > cursor) cursor = needed;
  }
  cursor = Math.min(cursor, length);
  return { ...state, cursor, due: state.due.filter((d) => d.end > cursor), at: now };
}

/** Rounding slack for the fractional cursor, far below one character. */
const CURSOR_EPSILON = 1e-6;
/** Whitespace, where a word ends. */
const SPACE = /\s/;
/** CJK ideographs, kana, Hangul, CJK and fullwidth punctuation: each one is a word for `fade`. */
const WIDE = /[\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uff00-\uffef]/;
/** How far back `fade` looks for a word boundary before giving up and cutting mid-token. */
const WORD_LOOKBACK = 48;
/** Characters whose runs mean something different by length (`*` / `**`, `` ` `` / ` ``` `). */
const RUN_MARKS = "*_~`";
/**
 * A line of block syntax and nothing else yet: list and heading marks, a quote, a fence's
 * backticks, a table's pipes and rule, a setext underline, an ordered list's number. A single
 * character class, so it runs in linear time on any line.
 */
const SYNTAX_ONLY_LINE = /^[\s>*+\-#`~=_|:.)[\]\d]*$/;

/** Whether `fade` may cut the text at `p`: after whitespace, or beside a CJK character. */
function isWordBoundary(text: string, p: number): boolean {
  if (p <= 0) return true;
  const before = text[p - 1]!;
  if (SPACE.test(before) || WIDE.test(before)) return true;
  return p < text.length && WIDE.test(text[p]!);
}

/**
 * Where to cut the text for a cursor at `n`: the mode's granularity, then the Markdown guards
 * (see the header). Never past the text; may pass `n` only to finish a run of marks.
 */
export function revealCut(text: string, n: number, mode: StreamRevealMode): number {
  const length = text.length;
  let p = Math.max(0, Math.min(length, Math.floor(n)));
  if (mode === "fade") {
    const floor = Math.max(0, p - WORD_LOOKBACK);
    let q = p;
    while (q > floor && !isWordBoundary(text, q)) q--;
    if (isWordBoundary(text, q)) p = q;
  }
  // Never between the two halves of a surrogate pair (an emoji would show as a broken glyph).
  if (p > 0 && p < length) {
    const code = text.charCodeAt(p - 1);
    if (code >= 0xd800 && code <= 0xdbff) p++;
  }
  // Never inside a run of marks: finish the run.
  if (p > 0 && p < length && text[p - 1] === text[p] && RUN_MARKS.includes(text[p]!)) {
    const mark = text[p];
    while (p < length && text[p] === mark) p++;
  }
  // Hold back a line that is block syntax only so far.
  const lineStart = p === 0 ? 0 : text.lastIndexOf("\n", p - 1) + 1;
  const line = text.slice(lineStart, p);
  if (line.trim() !== "" && SYNTAX_ONLY_LINE.test(line)) p = lineStart;
  return p;
}

/**
 * How many characters of the text to show at `now`. Instant shows everything. A paced reveal
 * shows the text cut at the cursor; once the cursor has caught up, the whole text shows when the
 * stream has ended or its last arrival is past its deadline, and otherwise the live edge is cut
 * like any other point (a partial word or a syntax-only line waits for the next delta).
 */
export function visibleLength(
  state: RevealState,
  mode: StreamRevealMode,
  streaming: boolean,
  now: number,
): number {
  const length = state.text.length;
  if (mode === "instant") return length;
  // The cursor sums fractions frame by frame; the epsilon keeps 4.9999999999999996 from reading
  // as 4.
  const cursor = Math.min(length, state.cursor + CURSOR_EPSILON);
  if (cursor >= length && (!streaming || now >= state.settleBy)) return length;
  return revealCut(state.text, cursor, mode);
}

/**
 * How often a paced reveal hands React a new prefix, ms, by the length on screen. Every prefix
 * re-parses the whole reply's Markdown, so the cadence falls as the reply grows: about 30 frames
 * a second up to ~3,300 characters, down to the stream's own ~8 a second (its 120 ms commit
 * interval) from ~12,000 on — never more parse work than today's stream for a long reply.
 */
export function revealFrameMs(length: number): number {
  return Math.min(120, Math.max(33, length / 100));
}
