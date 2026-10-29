/**
 * What a folded value shows until its whole arrives: the head and the tail the server kept, with
 * an ellipsis between them, so the cut reads as a cut rather than as the value. The server keeps
 * the two as one string and says how much of it is the head (`ElidedBody.head`).
 */
import type { ElidedRecord } from "../amsp/stream-model";

/**
 * `value` as shown: the value itself when nothing at `path` was folded, else its head, `gap`, its
 * tail. `gap` suits where it is read: a line of its own in plain text, a paragraph in Markdown.
 */
export function elidedPreview(
  value: string,
  elided: ElidedRecord | undefined,
  path: string,
  gap: string,
): string {
  const entry = elided?.entries.find((e) => e.path === path);
  if (entry === undefined || entry.head <= 0 || entry.head >= value.length) return value;
  return `${value.slice(0, entry.head)}${gap}${value.slice(entry.head)}`;
}
