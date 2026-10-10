/**
 * Pure rules of the conversation's own context menu (features/chat/stream-selection-menu.tsx):
 * when a secondary click in the message stream opens the app's menu instead of the browser's,
 * which rows it offers — a web link's, the selection's, or both — where it hangs when the
 * keyboard asked for it, and what an excerpt becomes once it is added to the conversation.
 * Kept free of the DOM so they can be tested in this package's node-only vitest environment.
 */
import { isLongPressPointer } from "@prismshadow/penguin-ui";
import type { AnchorRect } from "@prismshadow/penguin-ui";
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

// ------------------------------------------------------------------------------------- links

/**
 * The web address a link in the stream offers the link rows for: an absolute http(s) URL,
 * normalized by the URL parser, else null. Every other link keeps its own behaviour and gets
 * no link rows: a Workspace file (a relative href, which opens the Files panel), an in-page
 * `#anchor`, a `mailto:` link, an href the renderer emptied.
 *
 * It takes the `href` attribute as written, not the element's resolved `href` property: a
 * relative href resolves against the App's own origin into an http address, and that is a
 * route of the App, never a page to open elsewhere.
 */
export function menuLinkHref(rawHref: string | null): string | null {
  if (rawHref === null) return null;
  let url: URL;
  try {
    // Without a base a relative href does not parse, which is what keeps it out.
    url = new URL(rawHref.trim());
  } catch {
    return null;
  }
  return (url.protocol === "http:" || url.protocol === "https:") && url.hostname !== ""
    ? url.href
    : null;
}

/** One row of the menu for a web link. */
export type LinkMenuItem = "openInBuiltinBrowser" | "openExternal" | "copyLink";

/**
 * A web link's rows, in order: open it in the agent browser, open it outside the app, copy its
 * address. The first only where the agent browser can open the page — the desktop app's window
 * with the built-in browser available, or any window while the user's Chrome is connected.
 */
export function linkMenuItems(agentBrowser: boolean): readonly LinkMenuItem[] {
  return agentBrowser
    ? ["openInBuiltinBrowser", "openExternal", "copyLink"]
    : ["openExternal", "copyLink"];
}

/** A gesture as the whole menu takes it: the selection rules' request, and the link it landed on. */
export interface StreamMenuRequest extends SelectionMenuRequest {
  /**
   * The web address of the link the gesture landed on — under the pointer, or holding focus
   * when the keyboard asked — as menuLinkHref reads it; null when there is none.
   */
  linkHref: string | null;
}

/** What one gesture's menu holds: a web link's rows, the selection's, or both, the link's first. */
export interface StreamMenuContent {
  linkHref: string | null;
  selection: boolean;
}

/**
 * Whether the app's menu takes this gesture, and with which rows. A web link brings its rows,
 * unless the gesture is a touch or pen press-and-hold (the OS link menu owns that one) or lands
 * in a field; a selection the rules above take brings Copy and Add to conversation, after the
 * link's rows when both apply. With neither, null: the browser keeps the gesture and its own
 * menu, exactly as for a secondary click with nothing selected.
 */
export function streamMenuContent(request: StreamMenuRequest): StreamMenuContent | null {
  const linkHref =
    request.linkHref !== null && !isLongPressPointer(request.pointerType) && !request.onEditable
      ? request.linkHref
      : null;
  const selection = opensSelectionMenu(request);
  return linkHref === null && !selection ? null : { linkHref, selection };
}

/**
 * Where a keyboard-opened menu for a link hangs: from the link's first line box, as a menu
 * dropped from the link itself. `lineBoxes` are the link's client rects in document order, and
 * `bounds` its bounding rect, for a link that reports no line boxes.
 */
export function linkAnchor(lineBoxes: readonly AnchorRect[], bounds: AnchorRect): AnchorRect {
  return lineBoxes[0] ?? bounds;
}
