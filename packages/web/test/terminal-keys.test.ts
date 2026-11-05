/**
 * The focused terminal's key decision (src/lib/shortcuts/terminal-keys.ts) as a table: the close
 * chord (⌃⌥` on a Mac, Ctrl+Alt+` elsewhere) closing while Ctrl+W reaches readline everywhere, the
 * shell keeping every key xterm sends even when it is bound (the Ctrl+Alt defaults on Linux), the
 * missing-close fallback, and the repeat.
 */
import { describe, expect, it } from "vitest";
import { SHORTCUT_COMMANDS, defaultChord } from "../src/lib/shortcuts/registry";
import { terminalKeyAction, type TerminalKeyHost } from "../src/lib/shortcuts/terminal-keys";
import type { Chord, CommandId, KeyLike, Platform } from "../src/lib/shortcuts/types";

function defaults(platform: Platform): Map<CommandId, Chord | null> {
  return new Map(SHORTCUT_COMMANDS.map((cmd) => [cmd.id, defaultChord(cmd, platform)]));
}

function key(overrides: Partial<KeyLike> & { code: string }): KeyLike {
  return { key: "", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...overrides };
}

const host = (overrides: Partial<TerminalKeyHost> = {}): TerminalKeyHost => ({
  canClose: true,
  ...overrides,
});

describe("terminalKeyAction", () => {
  const table: Array<[string, Platform, KeyLike, TerminalKeyHost, string]> = [
    [
      "⌃⌥` closes on a Mac",
      "mac",
      key({ code: "Backquote", ctrlKey: true, altKey: true }),
      host(),
      "close",
    ],
    [
      "Ctrl+Alt+` closes off a Mac",
      "linux",
      key({ code: "Backquote", ctrlKey: true, altKey: true }),
      host(),
      "close",
    ],
    [
      "Ctrl+Alt+` closes on Windows",
      "windows",
      key({ code: "Backquote", ctrlKey: true, altKey: true }),
      host(),
      "close",
    ],
    [
      "⌥⌘` is not the close: the chord is literal Control on a Mac too",
      "mac",
      key({ code: "Backquote", metaKey: true, altKey: true }),
      host(),
      "shell",
    ],
    ["Ctrl+W is readline's on a Mac", "mac", key({ code: "KeyW", ctrlKey: true }), host(), "shell"],
    [
      "Ctrl+W is readline's off a Mac",
      "linux",
      key({ code: "KeyW", ctrlKey: true }),
      host(),
      "shell",
    ],
    [
      "Ctrl+W is readline's on Windows",
      "windows",
      key({ code: "KeyW", ctrlKey: true }),
      host(),
      "shell",
    ],
    ["⌘W is not the close on a Mac", "mac", key({ code: "KeyW", metaKey: true }), host(), "shell"],
    // A bound app command's chord goes back to xterm, which sends the shell what it sends:
    // on Linux the Ctrl+Alt defaults reach the shell as Meta.
    [
      "Ctrl+Alt+1 (sidebar.toggle) is the shell's on Linux",
      "linux",
      key({ code: "Digit1", ctrlKey: true, altKey: true }),
      host(),
      "shell",
    ],
    [
      "Ctrl+Alt+S (sessions.search) likewise",
      "linux",
      key({ code: "KeyS", ctrlKey: true, altKey: true }),
      host(),
      "shell",
    ],
    // Chords xterm sends nothing for are handed back to xterm too; it leaves them
    // un-prevented and the window dispatcher runs them.
    [
      "Ctrl+` goes back to xterm, which sends nothing and lets it bubble",
      "linux",
      key({ code: "Backquote", ctrlKey: true }),
      host(),
      "shell",
    ],
    [
      "Ctrl+Shift+` likewise",
      "mac",
      key({ code: "Backquote", ctrlKey: true, shiftKey: true }),
      host(),
      "shell",
    ],
    [
      "⌥⌘1 likewise on a Mac",
      "mac",
      key({ code: "Digit1", metaKey: true, altKey: true }),
      host(),
      "shell",
    ],
    [
      "Ctrl+Alt+3 likewise on Windows, where xterm leaves Ctrl+Alt to AltGr",
      "windows",
      key({ code: "Digit3", ctrlKey: true, altKey: true }),
      host(),
      "shell",
    ],
    [
      "an unanswered chord is the shell's (Ctrl+Alt+P before the palette)",
      "linux",
      key({ code: "KeyP", ctrlKey: true, altKey: true }),
      host(),
      "shell",
    ],
    [
      "an editor-scoped chord is the shell's",
      "linux",
      key({ code: "KeyS", ctrlKey: true }),
      host(),
      "shell",
    ],
    ["plain typing is the shell's", "mac", key({ code: "KeyW", key: "w" }), host(), "shell"],
    [
      "with no close on offer the chord goes to the shell",
      "linux",
      key({ code: "Backquote", ctrlKey: true, altKey: true }),
      host({ canClose: false }),
      "shell",
    ],
    [
      "a held close chord is consumed, not re-run",
      "mac",
      key({ code: "Backquote", ctrlKey: true, altKey: true, repeat: true }),
      host(),
      "consume",
    ],
  ];

  for (const [name, platform, e, h, expected] of table) {
    it(name, () => {
      expect(terminalKeyAction(e, defaults(platform), platform, h)).toBe(expected);
    });
  }
});
