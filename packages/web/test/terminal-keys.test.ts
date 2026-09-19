/**
 * The focused terminal's key decision (src/lib/shortcuts/terminal-keys.ts) as a table: the Mac
 * behaviour change (⌘W closes, Ctrl+W reaches readline), the shell keeping every key xterm
 * sends (Ctrl+B, Ctrl+K, Ctrl+J stay the shell's even when bound), the missing-close fallback,
 * and the repeat.
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
    ["⌘W closes on a Mac", "mac", key({ code: "KeyW", metaKey: true }), host(), "close"],
    ["Ctrl+W is readline's on a Mac", "mac", key({ code: "KeyW", ctrlKey: true }), host(), "shell"],
    ["Ctrl+W closes off a Mac", "linux", key({ code: "KeyW", ctrlKey: true }), host(), "close"],
    ["Ctrl+W closes on Windows", "windows", key({ code: "KeyW", ctrlKey: true }), host(), "close"],
    // The shell keeps the control characters an app command is bound to; the page never
    // takes them from a focused terminal.
    [
      "Ctrl+B (sidebar.toggle) is the shell's",
      "linux",
      key({ code: "KeyB", ctrlKey: true }),
      host(),
      "shell",
    ],
    [
      "Ctrl+K (sessions.search) is the shell's",
      "windows",
      key({ code: "KeyK", ctrlKey: true }),
      host(),
      "shell",
    ],
    [
      "Ctrl+J (dock.toggleBottom) is the shell's",
      "linux",
      key({ code: "KeyJ", ctrlKey: true }),
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
    ["⌘B likewise on a Mac", "mac", key({ code: "KeyB", metaKey: true }), host(), "shell"],
    [
      "an unanswered chord is the shell's (Ctrl+P before the palette)",
      "linux",
      key({ code: "KeyP", ctrlKey: true }),
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
      key({ code: "KeyW", ctrlKey: true }),
      host({ canClose: false }),
      "shell",
    ],
    [
      "a held close chord is consumed, not re-run",
      "mac",
      key({ code: "KeyW", metaKey: true, repeat: true }),
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
