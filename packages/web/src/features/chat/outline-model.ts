/**
 * Conversation outline data (pure logic, unit-testable): reduces the stream items to one
 * entry per exchange — the user's question plus a truncated plain-text preview of the
 * assistant's reply — for the left quick-jump index.
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
