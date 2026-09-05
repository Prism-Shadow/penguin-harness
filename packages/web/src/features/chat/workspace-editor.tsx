/**
 * The Files panel's in-place text editor: one plain monospace textarea over the file's
 * text, nothing richer. No wrapping (long lines scroll sideways, as code should), no
 * spell-check or autocorrect, and Ctrl+S / Cmd+S saves — the browser's own "save page"
 * default is suppressed while the focus is here. Save and Cancel live in the panel's
 * preview header; this component owns only the text.
 */
import { useEffect, useRef } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { S } from "../../lib/strings";
import { baseName } from "../../lib/workspace-tree";

export function WorkspaceFileEditor({
  path,
  value,
  onChange,
  onSave,
}: {
  path: string;
  value: string;
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
      wrap="off"
      className="h-full w-full resize-none bg-transparent p-3 font-mono text-sm leading-relaxed text-gray-800 outline-none dark:text-gray-100"
    />
  );
}
