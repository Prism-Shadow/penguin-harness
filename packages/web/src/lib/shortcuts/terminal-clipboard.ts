/**
 * The terminal's clipboard keys — a fixed platform convention, not a rebindable chord.
 *
 * Windows / Linux (the Windows Terminal and VS Code conventions): copy on Ctrl+Shift+C,
 * Ctrl+Insert, or plain Ctrl+C while a selection exists (SIGINT still goes through when nothing
 * is selected); paste on Ctrl+V and Shift+Insert, which ride the browser's NATIVE paste event
 * into xterm's textarea — the caller only has to keep the browser default.
 *
 * macOS: ⌘C and ⌘V are the browser's native copy and paste, which xterm already serves, so
 * nothing is intercepted for them; Ctrl+C is always SIGINT and Ctrl+V is the shell's verbatim
 * insert, so neither is a clipboard key. Ctrl+Shift+C stays as a copy for terminal habit.
 *
 * Letters are matched by `key`, as xterm itself decides what Ctrl+<letter> sends.
 */
import type { KeyLike, Platform } from "./types";

export type TerminalClipboardAction = "copy" | "paste";

export function terminalClipboardAction(
  e: KeyLike,
  platform: Platform,
  hasSelection: boolean,
): TerminalClipboardAction | null {
  const key = e.key.toLowerCase();
  if (platform === "mac") {
    if (e.ctrlKey && e.shiftKey && !e.metaKey && !e.altKey && key === "c") return "copy";
    return null;
  }
  if (e.metaKey) return null;
  if (e.ctrlKey && e.shiftKey && key === "c") return "copy";
  if (e.ctrlKey && !e.shiftKey && e.key === "Insert") return "copy";
  if (e.ctrlKey && !e.shiftKey && !e.altKey && key === "c" && hasSelection) return "copy";
  if (e.ctrlKey && !e.altKey && key === "v") return "paste";
  if (!e.ctrlKey && e.shiftKey && e.key === "Insert") return "paste";
  return null;
}
