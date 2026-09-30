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
 * No spell-check or autocorrect, and the save shortcut saves (the caller's binding, ⌘S / Ctrl+S
 * when it names none) — the browser's own "save page" default is suppressed while the focus is
 * here. Long lines scroll sideways, as code should, unless the Wrap toggle soft-wraps them; the
 * toggle, Save and Cancel all live in the panel's preview header, and this component owns only
 * the text.
 */
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { CodeSurface } from "../code-block/code-block";
import { languageForFileName } from "../code-block/code-languages";

/** Quiet period before re-highlighting, so a keystroke costs a re-render and not a tokenize. */
const EDIT_HIGHLIGHT_SETTLE_MS = 200;

/** Ctrl+S or ⌘S without Alt: the save key when the caller names no binding. */
function isDefaultSaveKey(event: KeyboardEvent): boolean {
  return (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "s";
}

export function WorkspaceFileEditor({
  path,
  value,
  label,
  wrap,
  highlight = true,
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
  onChange: (next: string) => void;
  onSave: () => void;
  /** Whether a keydown is the save shortcut; the app passes the user's binding. */
  isSaveKey?: (event: KeyboardEvent) => boolean;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  // An IME writes its candidate text into the textarea before it reaches `value`, and the
  // textarea's text is transparent — so the layers swap for the length of the composition.
  const [composing, setComposing] = useState(false);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    if (isSaveKey(e.nativeEvent)) {
      // A held chord repeats: every repeat is kept from the browser (Save Page), one save runs.
      e.preventDefault();
      if (!e.repeat) onSave();
    }
  };

  return (
    <div
      // The composing flag rides on the scroll box so the CSS can swap the layers without the
      // surface needing to know an IME exists.
      data-composing={composing}
      className="code-editor-host h-full min-h-0 overflow-auto text-xs leading-relaxed"
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
          onChange={(e) => onChange(e.target.value)}
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
