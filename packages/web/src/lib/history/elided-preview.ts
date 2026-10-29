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

/** A folded value inside a call's arguments: `payload.arguments#<JSON Pointer>` (RFC 6901). */
const ARGUMENTS = "payload.arguments#";

/** The reference tokens of a JSON Pointer (`/a/b~1c` → `a`, `b/c`); `""` names the whole document. */
function pointerTokens(pointer: string): string[] {
  if (pointer === "") return [];
  return pointer
    .slice(1)
    .split("/")
    .map((t) => t.replace(/~1/g, "/").replace(/~0/g, "~"));
}

/**
 * A call's arguments as shown, with every folded string inside them cut visibly: each value the
 * history window folded (a file's content, an edit's text) reads head, `gap`, tail where it sits
 * in the JSON — so a folded argument is never mistaken for the whole of it. Arguments that are not
 * JSON were folded whole (`payload.arguments#`) and are cut as plain text. Unchanged when nothing
 * was folded.
 */
export function elidedArgumentsPreview(
  text: string,
  elided: ElidedRecord | undefined,
  gap: string,
): string {
  const entries = elided?.entries.filter((e) => e.path.startsWith(ARGUMENTS) && e.head > 0) ?? [];
  if (entries.length === 0) return text;
  const whole = entries.find((e) => e.path === ARGUMENTS);
  if (whole !== undefined) {
    return whole.head < text.length ? `${text.slice(0, whole.head)}${gap}${text.slice(whole.head)}` : text;
  }
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return text;
  }
  for (const entry of entries) {
    const tokens = pointerTokens(entry.path.slice(ARGUMENTS.length));
    const key = tokens.pop();
    let parent: unknown = doc;
    for (const t of tokens) parent = (parent as Record<string, unknown> | null)?.[t];
    if (key === undefined || parent === null || typeof parent !== "object") continue;
    const holder = parent as Record<string, unknown>;
    const value = holder[key];
    if (typeof value === "string" && entry.head < value.length) {
      holder[key] = `${value.slice(0, entry.head)}${gap}${value.slice(entry.head)}`;
    }
  }
  return JSON.stringify(doc);
}
