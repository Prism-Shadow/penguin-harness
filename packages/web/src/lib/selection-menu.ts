/**
 * Pure rules of the conversation's selection menu (features/chat/stream-selection-menu.tsx):
 * when a secondary click in the message stream opens the app's own menu instead of the
 * browser's, which rows that menu offers, where it hangs when the keyboard asked for it, and
 * what an excerpt becomes once it is added to the conversation. Kept free of the DOM so they
 * can be tested in this package's node-only vitest environment.
 */
import { isLongPressPointer } from "./context-menu";
import type { AnchorRect } from "./context-menu";
import type { ExcerptReference } from "./workspace-tree";

/** What the rules need to know about a gesture and the selection it found. */
export interface SelectionMenuRequest {
  /** The document's selected text at the gesture (`Selection.toString()`); "" when nothing is selected. */
  selectedText: string;
  /** How many ranges the selection holds (`Selection.rangeCount`). */
  rangeCount: number;
  /** Both ends of the selection's first range lie inside the message stream. */
  firstRangeInStream: boolean;
  /** The pointer behind the gesture ("mouse", "pen", "touch"), or "" when the keyboard asked. */
  pointerType: string;
  /** The gesture landed on an editable field (an input, a textarea, contenteditable). */
  onEditable: boolean;
}

/**
 * Whether the app's menu takes this gesture. Everything it declines keeps the browser's own
 * menu, so the rule declines whenever there is doubt:
 * - a touch or pen press-and-hold, because the mobile OS raises a selection menu of its own
 *   for that gesture, and a second menu would fight it;
 * - a gesture on a field, whose own menu (paste, spelling) is the one that belongs there;
 * - no selection, a blank one, or one that runs past the stream — into the composer, say —
 *   because then there is no conversation text to act on, or not only conversation text;
 * - a selection built from several ranges (Firefox's Ctrl+drag), even when the first of them
 *   lies inside the stream: the text such a selection reads is every range's text, so one
 *   range in the composer would ride into the clipboard and into the excerpt, and putting the
 *   highlight back afterwards can only restore the one range that was captured.
 */
export function opensSelectionMenu(request: SelectionMenuRequest): boolean {
  if (isLongPressPointer(request.pointerType)) return false;
  if (request.onEditable) return false;
  if (request.rangeCount !== 1 || !request.firstRangeInStream) return false;
  return request.selectedText.trim() !== "";
}

/** One row of the selection menu. */
export type SelectionMenuItem = "copy" | "addToConversation";

/** The rows, in order. */
export const SELECTION_MENU_ITEMS: readonly SelectionMenuItem[] = ["copy", "addToConversation"];

/**
 * Where a keyboard-opened menu hangs: a zero-width point at the right edge of the selection's
 * last line box, which is where a caret at the selection's end would sit — a keyboard user has
 * no pointer to hang it from. `lineBoxes` are the range's client rects in document order, and
 * `bounds` its bounding rect, for a range that reports no line boxes.
 */
export function selectionEndAnchor(
  lineBoxes: readonly AnchorRect[],
  bounds: AnchorRect,
): AnchorRect {
  const last = lineBoxes.at(-1) ?? bounds;
  return { top: last.top, bottom: last.bottom, left: last.right, right: last.right };
}

/** How many characters of an excerpt the chip's label keeps before its ellipsis. */
export const EXCERPT_LABEL_CHARS = 32;

/**
 * The selection as the conversation carries it: line endings made `\n`, and what a drag picks
 * up at either end — blank lines before the text, whitespace after it — dropped. Everything in
 * between stays as it was selected, indentation included.
 */
export function normalizeExcerpt(selectedText: string): string {
  return selectedText
    .replace(/\r\n?/g, "\n")
    .replace(/^(?:[ \t]*\n)+/, "")
    .replace(/\s+$/, "");
}

/**
 * The chip's label: the excerpt's start on one line — every run of whitespace, line breaks
 * included, folded to one space — cut after EXCERPT_LABEL_CHARS characters with an ellipsis.
 * The chip ellipsizes again to fit its own width; this bounds what its label and its accessible
 * name have to carry. Counted in code points, so a cut never splits a character in two.
 */
export function excerptLabel(excerpt: string): string {
  const chars = [...excerpt.replace(/\s+/g, " ").trim()];
  if (chars.length <= EXCERPT_LABEL_CHARS) return chars.join("");
  return `${chars.slice(0, EXCERPT_LABEL_CHARS).join("").trimEnd()}…`;
}

/**
 * The excerpt as a Markdown blockquote: every line behind `> `, and a blank line as a bare `>`,
 * so the quote runs on through it instead of ending there.
 */
export function excerptBlockquote(excerpt: string): string {
  return excerpt
    .split("\n")
    .map((line) => (line.trim() === "" ? ">" : `> ${line}`))
    .join("\n");
}

/** What "Add to conversation" stages: the normalized excerpt, carried into the message as a blockquote. */
export function excerptReference(selectedText: string): ExcerptReference {
  const excerpt = normalizeExcerpt(selectedText);
  return { kind: "excerpt", excerpt, text: excerptBlockquote(excerpt) };
}
