/**
 * The Files panel's in-place text editor: the same highlighted code surface the source view
 * shows, with a textarea laid over it that holds the caret and the selection and nothing else.
 * The text you see is the surface's; the text you type into has `color: transparent`. So
 * editing a file looks exactly like reading it — same line numbers, same colours, same
 * wrapping — and pressing Edit reflows nothing.
 *
 * The two layers are stacked in a single grid cell (styles.css's `.code-editor`), so the taller
 * one sizes the box and the one scroll container carries both. Nothing is synchronised in JS,
 * which is what makes it impossible for them to drift apart: there is only one scroll position.
 * What they do have to agree on is every metric that decides where a glyph lands — family,
 * size, line height, letter spacing, tab size, padding, wrap mode — and those are stated once,
 * for both layers, in `.code-surface`.
 *
 * No spell-check or autocorrect, and Ctrl+S / Cmd+S saves — the browser's own "save page"
 * default is suppressed while the focus is here. Long lines scroll sideways, as code should,
 * unless the Wrap toggle soft-wraps them; the toggle, Save and Cancel all live in the panel's
 * preview header, and this component owns only the text.
 */
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { S } from "../../lib/strings";
import { baseName, extOf } from "../../lib/workspace-tree";
import { CodeSurface } from "./code-block";
import { languageForExtension } from "./code-languages";

/**
 * Highlighting ceiling for the editor, below the source view's: the source view pays for one
 * highlight, the editor pays for one every time the text settles. Measured on this bundle's JS
 * regex engine over TypeScript — 4KB ~11ms, 16KB ~148ms, 32KB ~367ms, 64KB ~936ms — so the
 * ceiling is where the catch-up after a burst of typing still reads as the colours arriving
 * rather than as the editor stalling. Past it a file is edited unhighlighted, which is what it
 * was before; the line numbers stay either way, being drawn by CSS at no cost.
 */
const EDIT_HIGHLIGHT_LIMIT = 32 * 1024;

/** Quiet period before re-highlighting, so a keystroke costs a re-render and not a tokenize. */
const EDIT_HIGHLIGHT_SETTLE_MS = 200;

export function WorkspaceFileEditor({
  path,
  value,
  wrap,
  onChange,
  onSave,
}: {
  path: string;
  value: string;
  /** Soft-wrap long lines instead of scrolling sideways (the preview header's toggle). */
  wrap: boolean;
  onChange: (next: string) => void;
  onSave: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  // An IME writes its candidate text into the textarea before it reaches `value`, and the
  // textarea's text is transparent — so the layers swap for the length of the composition.
  const [composing, setComposing] = useState(false);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "s") {
      e.preventDefault();
      onSave();
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
        language={languageForExtension(extOf(baseName(path)))}
        code={value}
        highlight={value.length <= EDIT_HIGHLIGHT_LIMIT}
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
          aria-label={S.files.editorLabel(baseName(path))}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          wrap={wrap ? "soft" : "off"}
        />
      </CodeSurface>
    </div>
  );
}
