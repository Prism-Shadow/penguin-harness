/**
 * What a focused terminal does with a keydown after the clipboard keys have had their turn.
 * Pure: the surface passes what it knows (whether it offers a close, which global commands have a
 * handler) and acts on the answer. This is the decision behind the platform split — ⌘W closes on
 * a Mac while Ctrl+W reaches readline; the terminal toggle pressed inside xterm runs without
 * reaching the pty; a chord nothing answers (Ctrl+P before the palette exists) is the shell's.
 */
import { matchShortcut } from "./match";
import type { CommandId, KeyLike, Keymap, Platform } from "./types";

export type TerminalKeyAction =
  /** Run the host's close: prevent, stop propagation, do not send to the shell. */
  | "close"
  /** A repeat of the close chord: prevent and stop as for "close", but run nothing. */
  | "consume"
  /** A global command some surface answers: not the shell's, and left un-prevented so it bubbles to the window dispatcher. */
  | "skip-shell"
  /** Everything else, including a chord nothing answers: xterm sends it to the shell. */
  | "shell";

export interface TerminalKeyHost {
  /** Whether this terminal offers a close at all (the dock tab and the standalone page do). */
  canClose: boolean;
  hasHandler: (id: CommandId) => boolean;
}

export function terminalKeyAction(
  e: KeyLike,
  keymap: Keymap,
  platform: Platform,
  host: TerminalKeyHost,
): TerminalKeyAction {
  const command = matchShortcut(e, keymap, ["terminal", "global"], platform);
  if (command === null) return "shell";
  if (command === "terminal.close") {
    if (!host.canClose) return "shell";
    return e.repeat === true ? "consume" : "close";
  }
  return host.hasHandler(command) ? "skip-shell" : "shell";
}
