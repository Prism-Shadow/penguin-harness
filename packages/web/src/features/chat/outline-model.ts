/**
 * Conversation outline data (pure logic, unit-testable): reduces the stream items to one
 * entry per exchange — the user's question plus a truncated plain-text preview of the
 * assistant's reply — for the left quick-jump index. Also owns the outline's display
 * math: the minimum-turns gate both shapes share and the tick rail's sliding window.
 *
 * Entry boundaries: a turn opens at a user prompt (user_text / user_image) and collects
 * every assistant_text that follows until the next prompt. Consecutive user items merge
 * into one entry (a prompt's text and images arrive as separate adjacent items — they are
 * one question, not several). Machine-only texts never open an entry: handoff /
 * model-switch source blocks render as banners with no user prose, and goal rounds past 1
 * are the loop re-sending an objective whose entry (round 1) is already collecting the
 * whole run's replies. Scheduled-trigger prompts DO open one — they are real turns worth
 * jumping to, unlike in input history (which only recalls what was typed here).
 * Steering messages ride inside a running turn and neither open an entry nor end one.
 */
import type { ChatItem } from "../../lib/omni/stream-model";
import { parseUserMessageBody } from "./user-message-body";

export interface OutlineEntry {
  /** Stream item id of the turn's opening user message — the [data-outline-anchor] jump target. */
  anchorId: number;
  /** The user's question (protocol-stripped, trimmed); "" for an image/attachment-only prompt. */
  question: string;
  /** Plain accumulated assistant reply (capped — a preview source, not a transcript); "" while nothing arrived. */
  answer: string;
}

/** Answer accumulation cap: enough for any preview length while keeping rebuilds O(entries) cheap. */
const ANSWER_CAP = 500;

/**
 * Visibility gate shared by both outline shapes (tick rail and toolbar dropdown): below
 * this many turns the whole conversation is a flick of the wheel away, and an index would
 * be chrome without navigation value.
 */
export const OUTLINE_MIN_TURNS = 5;

/**
 * With windowed history loading, entries built from the loaded items are only the tail of
 * the conversation: `turnOffset` (MessagesPageInfo.earlierTurns — the server counts with
 * the same entry rule buildOutline applies; the two must stay in step) is the number of
 * turns that exist before them. These two helpers are the ONLY places that combine the
 * offset with loaded-entry indices, so numbering can never drift between the shapes.
 */

/** Global 1-based turn number of loaded entry `index` (its position in the loaded entries array). */
export function globalTurnNumber(turnOffset: number, index: number): number {
  return turnOffset + index + 1;
}

/** Whether the outline earns its place: the gate counts the WHOLE conversation — unloaded earlier turns included — never just the loaded window. */
export function outlineVisible(turnOffset: number, loadedCount: number): boolean {
  return turnOffset + loadedCount >= OUTLINE_MIN_TURNS;
}

/** Rail window half-widths: at most this many ticks render before/after the active one. */
export const OUTLINE_WINDOW_BEFORE = 20;
export const OUTLINE_WINDOW_AFTER = 20;

/**
 * The slice of entries the tick rail renders: a sliding window of at most
 * `before + 1 + after` ticks kept centered on the active entry, shifted — never shrunk —
 * at the edges (at the bottom of a long conversation the window is simply the last
 * `before + 1 + after` turns). No active entry yet (null / -1) parks the window at the
 * END, where a conversation opens and where new turns appear. Bounds are indices into the
 * full entries array (`end` exclusive): callers slice with them and must keep labeling
 * ticks by GLOBAL index — the window moves which ticks exist, never what they are.
 */
export function windowOutline(
  entryCount: number,
  activeIndex: number | null,
  before: number = OUTLINE_WINDOW_BEFORE,
  after: number = OUTLINE_WINDOW_AFTER,
): { start: number; end: number } {
  const size = before + 1 + after;
  if (entryCount <= size) return { start: 0, end: entryCount };
  if (activeIndex === null || activeIndex < 0 || activeIndex >= entryCount) {
    return { start: entryCount - size, end: entryCount };
  }
  const start = Math.min(Math.max(0, activeIndex - before), entryCount - size);
  return { start, end: start + size };
}

/** Tick pitch bounds (px): compress toward MIN as the window outgrows the rail, never past hoverability. */
export const TICK_PITCH_MAX = 12;
export const TICK_PITCH_MIN = 5;

/** Vertical allowance (px) the tick stack keeps free inside the rail: the edge dots plus breathing room. */
const RAIL_STACK_ALLOWANCE = 48;

/** Tick pitch (px) for `count` ticks in a `height`-px rail: MAX, compressed toward MIN as the stack outgrows it. */
export function railTickPitch(height: number, count: number): number {
  return Math.max(
    TICK_PITCH_MIN,
    Math.min(TICK_PITCH_MAX, Math.floor((height - RAIL_STACK_ALLOWANCE) / Math.max(1, count))),
  );
}

/**
 * Height-adaptive window half-width: at most OUTLINE_WINDOW_BEFORE/AFTER, shrunk until
 * the whole window fits the measured rail at minimum pitch. A short rail (small window,
 * split screen) thus shows fewer turns instead of letting the tick stack spill over the
 * toolbar and composer. One symmetric value, since the default half-widths are equal.
 */
export function railWindowHalf(height: number): number {
  const fits = Math.floor((height - RAIL_STACK_ALLOWANCE) / TICK_PITCH_MIN);
  return Math.min(OUTLINE_WINDOW_BEFORE, Math.max(0, Math.floor((fits - 1) / 2)));
}

export function buildOutline(items: readonly ChatItem[]): OutlineEntry[] {
  const out: OutlineEntry[] = [];
  let current: OutlineEntry | null = null;
  let lastWasUser = false;
  for (const item of items) {
    if (item.kind === "user_text" || item.kind === "user_image") {
      let body = "";
      if (item.kind === "user_text") {
        const parsed = parseUserMessageBody(item.text);
        if (!parsed || (parsed.goalRound !== undefined && parsed.goalRound > 1)) {
          // A banner-only item is not a question, but it still separates user runs: a real
          // prompt right after it must open its own entry, not merge across the banner.
          lastWasUser = false;
          continue;
        }
        body = parsed.body;
      }
      if (lastWasUser && current) {
        // Same prompt, next fragment: only adopt a question if the entry has none yet
        // (text after images), never overwrite one.
        if (current.question === "" && body !== "") current.question = body;
      } else {
        current = { anchorId: item.id, question: body, answer: "" };
        out.push(current);
      }
      lastWasUser = true;
      continue;
    }
    lastWasUser = false;
    if (item.kind === "assistant_text" && current && current.answer.length < ANSWER_CAP) {
      const text = item.text.trim();
      if (text !== "") {
        current.answer = (current.answer === "" ? text : `${current.answer} ${text}`).slice(
          0,
          ANSWER_CAP,
        );
      }
    }
  }
  return out;
}

/**
 * Renders markdown-ish text down to a single truncated plain line for the entry previews:
 * fence lines drop (their code stays), images/links keep their label, block markers
 * (headings, quotes, list bullets) and emphasis characters strip, whitespace collapses.
 * Deliberately lossy — this feeds a one-line preview, not a renderer.
 */
export function previewText(md: string, max: number): string {
  let text = md
    .replace(/```[^\n]*/g, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^[ \t]*(?:#{1,6}[ \t]+|>[ \t]?|[-*+][ \t]+|\d+[.)][ \t]+)/gm, "")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length > max) text = `${text.slice(0, max).trimEnd()}…`;
  return text;
}
