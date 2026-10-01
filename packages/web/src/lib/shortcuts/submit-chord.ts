/**
 * The submit chord of a multi-line box: Enter with Cmd (macOS) or Ctrl — a newline stays a plain
 * Enter. Read here, under lib/shortcuts/, because a modifier read anywhere else is a shortcut the
 * keymap cannot see (test/shortcut-guard.test.ts); this one is a box's own key, not a command.
 */
export function isSubmitChord(e: { key: string; metaKey: boolean; ctrlKey: boolean }): boolean {
  return e.key === "Enter" && (e.metaKey || e.ctrlKey);
}
