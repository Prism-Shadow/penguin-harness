/**
 * The Files panel's in-place text editor: the same highlighted code surface the source view
 * shows, with a textarea laid over it that holds the caret and the selection and nothing else.
 * The text you see is the surface's; the text you type into has `color: transparent`. So
 * editing a file looks exactly like reading it — same line numbers, same colours, same
 * wrapping — and pressing Edit reflows nothing.
 *
 * The two layers are stacked in a single grid cell (prose.css's `.code-editor`), so the taller
 * one sizes the box and the one scroll container carries both. Nothing is synchronised in JS,
 * which is what makes it impossible for them to drift apart: there is only one scroll position.
 * What they do have to agree on is every metric that decides where a glyph lands — family,
 * size, line height, letter spacing, tab size, padding, wrap mode — and those are stated once,
 * for both layers, in `.code-surface`.
 *
 * The editor keeps its place the way a code editor does. It opens where the source view was
 * scrolled to (`initialScroll` — the scroll box reserves the same scrollbar gutter as the
 * preview's, so one offset means one line in both), with the caret at the start of the first
 * line wholly in view and focus taken without scrolling: pressing Edit moves nothing. A save
 * leaves it mounted, so the caret, the selection and the scroll stay as they were. And when the
 * text is replaced from outside — the caller swapping in the file an Agent rewrote under a clean
 * editor — the caret keeps its line and column (clamped to the new text) and the scroll stays
 * put, where a browser setting a textarea's value would throw the caret to the end.
 *
 * No spell-check or autocorrect, and the save shortcut saves (the caller's binding, ⌘S / Ctrl+S
 * when it names none) — the browser's own "save page" default is suppressed while the focus is
 * here. Long lines scroll sideways, as code should, unless the Wrap toggle soft-wraps them; the
 * toggle, Save and Cancel all live in the panel's preview header, and this component owns only
 * the text.
 */
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from "react";
import { CodeSurface } from "../code-block/code-block";
import { languageForFileName } from "../code-block/code-languages";
import { caretAfterReplace, lineStartOffset } from "./caret";

/** Quiet period before re-highlighting, so a keystroke costs a re-render and not a tokenize. */
const EDIT_HIGHLIGHT_SETTLE_MS = 200;

/** A scroll box's position. */
export interface EditorScroll {
  top: number;
  left: number;
}

/** Ctrl+S or ⌘S without Alt: the save key when the caller names no binding. */
function isDefaultSaveKey(event: KeyboardEvent): boolean {
  return (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "s";
}

/**
 * The index of the first rendered line wholly inside the scroll box. Wholly, not partly: a caret
 * on a line cut by the top edge is one the browser scrolls into view at the first keystroke, or
 * when focus comes back from a dialog — the very jump the opening position is there to avoid.
 */
function firstVisibleLine(box: HTMLElement): number {
  const top = box.getBoundingClientRect().top;
  const lines = box.querySelectorAll(".code-surface .line");
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i]!.getBoundingClientRect().top >= top - 1) return i;
  }
  return 0;
}

export function WorkspaceFileEditor({
  path,
  value,
  label,
  wrap,
  highlight = true,
  initialScroll,
  hostRef,
  onChange,
  onSave,
  isSaveKey = isDefaultSaveKey,
}: {
  /** The file being edited: its name picks the highlighting language. */
  path: string;
  value: string;
  /** The textarea's accessible name ("Editing notes.md"). */
  label: string;
  /** Soft-wrap long lines instead of scrolling sideways (the preview header's toggle). */
  wrap: boolean;
  /**
   * Colour the text. Tokenizing runs on a worker, so a large file costs latency on the colours
   * rather than a stalled editor; the caller bounds it only by what a load can put here.
   */
  highlight?: boolean;
  /** Where the source view was scrolled when Edit was pressed; the editor opens there. */
  initialScroll?: EditorScroll;
  /** The scroll box, for a caller that hands the position back to the source view on the way out. */
  hostRef?: RefObject<HTMLDivElement | null>;
  onChange: (next: string) => void;
  onSave: () => void;
  /** Whether a keydown is the save shortcut; the app passes the user's binding. */
  isSaveKey?: (event: KeyboardEvent) => boolean;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const host = useRef<HTMLDivElement | null>(null);
  const setHost = useCallback(
    (el: HTMLDivElement | null) => {
      host.current = el;
      if (hostRef) hostRef.current = el;
    },
    [hostRef],
  );
  /** The text the textarea itself last produced: a `value` that differs came from outside. */
  const own = useRef(value);
  /** The caret and the scroll as the reader last left them, for an outside replacement to keep. */
  const place = useRef({ start: 0, end: 0, top: 0, left: 0 });
  // An IME writes its candidate text into the textarea before it reaches `value`, and the
  // textarea's text is transparent — so the layers swap for the length of the composition.
  const [composing, setComposing] = useState(false);

  // Opening: the source view's scroll, the caret at the start of the first line wholly in view,
  // and focus taken without scrolling to wherever the caret would otherwise have been.
  useLayoutEffect(() => {
    const box = host.current;
    const textarea = ref.current;
    if (box === null || textarea === null) return;
    if (initialScroll !== undefined) {
      box.scrollTop = initialScroll.top;
      box.scrollLeft = initialScroll.left;
    }
    const caret = lineStartOffset(textarea.value, firstVisibleLine(box));
    textarea.setSelectionRange(caret, caret);
    textarea.focus({ preventScroll: true });
    place.current = { start: caret, end: caret, top: box.scrollTop, left: box.scrollLeft };
    // The opening position is read once: a later scroll is the reader's own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Text replaced from outside: same line and column, same scroll.
  useLayoutEffect(() => {
    const box = host.current;
    const textarea = ref.current;
    if (box === null || textarea === null || value === own.current) return;
    const before = own.current;
    own.current = value;
    const { start, end, top, left } = place.current;
    textarea.setSelectionRange(
      caretAfterReplace(before, value, start),
      caretAfterReplace(before, value, end),
    );
    box.scrollTop = top;
    box.scrollLeft = left;
  }, [value]);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    if (isSaveKey(e.nativeEvent)) {
      // A held chord repeats: every repeat is kept from the browser (Save Page), one save runs.
      e.preventDefault();
      if (!e.repeat) onSave();
    }
  };

  const remember = (textarea: HTMLTextAreaElement): void => {
    place.current.start = textarea.selectionStart;
    place.current.end = textarea.selectionEnd;
  };

  return (
    <div
      ref={setHost}
      // The composing flag rides on the scroll box so the CSS can swap the layers without the
      // surface needing to know an IME exists.
      data-composing={composing}
      onScroll={(e) => {
        place.current.top = e.currentTarget.scrollTop;
        place.current.left = e.currentTarget.scrollLeft;
      }}
      className="code-editor-host h-full min-h-0 overflow-auto text-xs leading-relaxed [scrollbar-gutter:stable]"
    >
      <CodeSurface
        language={languageForFileName(path)}
        code={value}
        highlight={highlight}
        // The settle delay keeps a burst of typing from queueing a pass per keystroke.
        settleMs={EDIT_HIGHLIGHT_SETTLE_MS}
        lineNumbers
        wrap={wrap}
        className="code-editor"
      >
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => {
            own.current = e.target.value;
            remember(e.target);
            onChange(e.target.value);
          }}
          onSelect={(e) => remember(e.currentTarget)}
          onKeyDown={onKeyDown}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={() => setComposing(false)}
          aria-label={label}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          wrap={wrap ? "soft" : "off"}
        />
      </CodeSurface>
    </div>
  );
}
