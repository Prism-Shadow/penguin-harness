/**
 * What copying selected text out of the Web App puts on the clipboard: the selection's text as
 * plain text, and nothing else, whichever way the copy is asked for (user decision, 2026-10-22).
 *
 * Two paths reach it. ⌘C / Ctrl+C / Ctrl+Insert, the desktop app's Edit › Copy (Electron's
 * `webContents.copy()` runs the same editing command) and a touch OS selection menu's Copy all
 * raise the document's `copy` event, which `installSelectionCopy` answers for every surface at
 * once: the conversation and the subagent panel's, the Files panel preview, channel messages,
 * Traces, memory, a plugin's README. The conversation's selection menu writes its Copy row
 * through `writeSelectionCopy`. Left alone, the browser's copy adds a `text/html` flavour with
 * the page's computed style inlined on every element, so the dark theme's light ink and grey
 * surfaces rode into Word, Notes or Feishu while the Copy row pasted clean. Both paths now write
 * exactly the text `Selection.toString()` reads — which is what the browser's own `text/plain`
 * already held — and the paste takes the target's own style.
 *
 * The flavours are decided here and only here: pasting structure again (lists, bold, tables,
 * without the theme) would change the two writers below together.
 *
 * Left to the browser: a copy inside a field (the composer, the Files editor, a form input —
 * the field's own selection, not the document's), a copy another handler already took (the
 * terminal's, a channel draft's mentions), and a selection that is blank or made of several
 * ranges. The clipboard entry's own hidden element stops its event before it reaches the
 * document, and another document — the built-in browser's `<webview>`, the Files panel's HTML
 * and PDF frames — never reaches this one's listener at all.
 */
import { writeClipboard } from "./clipboard";

/** What the copy rule needs to know about a selection. */
export interface SelectionCopyRequest {
  /** The document's selected text (`Selection.toString()`); "" when nothing is selected. */
  selectedText: string;
  /** How many ranges the selection holds (`Selection.rangeCount`). */
  rangeCount: number;
  /** The copy came from an editable field, or the selection lies inside one. */
  onEditable: boolean;
}

/**
 * Whether the app writes this copy itself: one range of non-blank text outside any field.
 * Everything it declines keeps the browser's own copy — a field's selection is the field's to
 * copy, a blank one has nothing to give, and the text of several ranges (Firefox's Ctrl+drag)
 * is the browser's to join.
 */
export function takesSelectionCopy(request: SelectionCopyRequest): boolean {
  if (request.onEditable) return false;
  if (request.rangeCount !== 1) return false;
  return request.selectedText.trim() !== "";
}

/** Fields whose own copy and context menu (paste, spelling) are the ones that belong to them. */
const EDITABLE_SELECTOR =
  "input, textarea, select, [contenteditable]:not([contenteditable='false'])";

/** Is the node inside such a field? */
export function inEditable(node: Node): boolean {
  const element = node instanceof Element ? node : node.parentElement;
  return element !== null && element.closest(EDITABLE_SELECTOR) !== null;
}

/**
 * Answers one `copy` event: when the rule takes the document's selection, its text goes on the
 * event's clipboard as `text/plain` alone and the browser's own serialisation is cancelled.
 * Returns whether it took the copy; a declined event is left exactly as it came.
 */
export function copySelectionAsText(event: ClipboardEvent, doc: Document): boolean {
  // A copy event a script dispatched carries no clipboard to write to.
  if (event.defaultPrevented || !event.clipboardData) return false;
  const selection = doc.getSelection();
  if (selection === null || selection.rangeCount === 0) return false;
  const text = selection.toString();
  const target = event.target;
  const onEditable =
    (target instanceof Node && inEditable(target)) ||
    inEditable(selection.getRangeAt(0).commonAncestorContainer);
  if (!takesSelectionCopy({ selectedText: text, rangeCount: selection.rangeCount, onEditable })) {
    return false;
  }
  event.clipboardData.setData("text/plain", text);
  event.preventDefault();
  return true;
}

/**
 * Answers every `copy` the document raises with copySelectionAsText. The listener bubbles on
 * the document, so it runs after every handler on the way — the terminal's, a field's, React's
 * root — and sees what they cancelled. Returns the uninstall.
 */
export function installSelectionCopy(doc: Document): () => void {
  const onCopy = (event: ClipboardEvent): void => {
    copySelectionAsText(event, doc);
  };
  doc.addEventListener("copy", onCopy);
  return () => doc.removeEventListener("copy", onCopy);
}

/**
 * The conversation's Copy row: the text the menu captured at its gesture, through the clipboard
 * entry, which writes it as plain text alone on either of its paths — what the copy event
 * writes for ⌘C.
 */
export function writeSelectionCopy(text: string): Promise<boolean> {
  return writeClipboard(text);
}
