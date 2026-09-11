/**
 * The Files panel's in-place text editor: one plain monospace textarea over the file's
 * text, nothing richer. No spell-check or autocorrect, and Ctrl+S / Cmd+S saves — the
 * browser's own "save page" default is suppressed while the focus is here. Long lines
 * scroll sideways, as code should, unless the header's Wrap toggle soft-wraps them; the
 * toggle, Save and Cancel all live in the panel's preview header, and this component owns
 * only the text.
 */
import { useEffect, useRef } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { S } from "../../lib/strings";
import { baseName } from "../../lib/workspace-tree";

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

  const onKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "s") {
      e.preventDefault();
      onSave();
    }
  };

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      aria-label={S.files.editorLabel(baseName(path))}
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
      wrap={wrap ? "soft" : "off"}
      // font-mono text-xs, not the chat composer's text-base: this is a code surface, where
      // fitting a long line without wrapping and seeing indentation line up matters more than
      // reading comfort. The two full-height typing surfaces differ because prose and code do.
      className={`h-full w-full resize-none bg-transparent p-3 font-mono text-xs leading-relaxed text-gray-800 outline-none dark:text-gray-100 ${
        wrap ? "whitespace-pre-wrap" : ""
      }`}
    />
  );
}
