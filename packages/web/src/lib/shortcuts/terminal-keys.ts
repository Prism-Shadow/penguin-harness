/**
 * What a focused terminal does with a keydown after the clipboard keys have had their turn.
 * Pure: the surface passes what it knows (whether it offers a close) and acts on the answer.
 *
 * The shell keeps every key xterm would send it, so an app command bound to one yields to the
 * shell while a terminal has focus: Ctrl+W stays readline's delete-word and Ctrl+B tmux's prefix,
 * and on Linux a Ctrl+Alt chord reaches the shell as Meta (Ctrl+Alt+1 arrives as Esc 1). The app
 * commands still reachable from a focused terminal are the ones xterm sends nothing for and so
 * never cancels — Ctrl+` and Ctrl+Shift+` (the terminal toggle and new terminal), every ⌘ chord
 * on a Mac, and on Windows a Ctrl+Alt chord on a character key, which xterm leaves to AltGr — and
 * those bubble to the window dispatcher on their own. The one terminal-scoped command,
 * `terminal.close` (⌃⌥` / Ctrl+Alt+` by default), is decided here, before xterm sees it.
 */
import { matchShortcut } from "./match";
import type { KeyLike, Keymap, Platform } from "./types";

export type TerminalKeyAction =
  /** Run the host's close: prevent, stop propagation, do not send to the shell. */
  | "close"
  /** A repeat of the close chord: prevent and stop as for "close", but run nothing. */
  | "consume"
  /** Everything else: xterm handles it, sending to the shell what it sends. */
  | "shell";

export interface TerminalKeyHost {
  /** Whether this terminal offers a close at all (the dock tab and the standalone page do). */
  canClose: boolean;
}

export function terminalKeyAction(
  e: KeyLike,
  keymap: Keymap,
  platform: Platform,
  host: TerminalKeyHost,
): TerminalKeyAction {
  if (matchShortcut(e, keymap, ["terminal"], platform) !== "terminal.close") return "shell";
  if (!host.canClose) return "shell";
  return e.repeat === true ? "consume" : "close";
}
