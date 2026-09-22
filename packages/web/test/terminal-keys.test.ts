/**
 * The focused terminal's key decision (src/lib/shortcuts/terminal-keys.ts) as a table: the Mac
 * behaviour change (⌘W closes, Ctrl+W reaches readline), the toggle skipping the shell, the
 * unanswered chord reaching the shell, the missing-close fallback, and the repeat.
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
  hasHandler: (id) => id === "terminal.toggle",
  ...overrides,
});

describe("terminalKeyAction", () => {
  const table: Array<[string, Platform, KeyLike, TerminalKeyHost, string]> = [
    ["⌘W closes on a Mac", "mac", key({ code: "KeyW", metaKey: true }), host(), "close"],
    ["Ctrl+W is readline's on a Mac", "mac", key({ code: "KeyW", ctrlKey: true }), host(), "shell"],
    ["Ctrl+W closes off a Mac", "linux", key({ code: "KeyW", ctrlKey: true }), host(), "close"],
    ["Ctrl+W closes on Windows", "windows", key({ code: "KeyW", ctrlKey: true }), host(), "close"],
    [
      "the toggle skips the shell everywhere",
      "mac",
      key({ code: "Backquote", ctrlKey: true }),
      host(),
      "skip-shell",
    ],
    [
      "the toggle skips the shell on Linux",
      "linux",
      key({ code: "Backquote", ctrlKey: true }),
      host(),
      "skip-shell",
    ],
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
      "a plain Ctrl+C is the shell's",
      "linux",
      key({ code: "KeyC", ctrlKey: true }),
      host(),
      "shell",
    ],
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
    [
      "a held toggle still skips the shell (the dispatcher swallows the repeat)",
      "linux",
      key({ code: "Backquote", ctrlKey: true, repeat: true }),
      host(),
      "skip-shell",
    ],
  ];

  for (const [name, platform, e, h, expected] of table) {
    it(name, () => {
      expect(terminalKeyAction(e, defaults(platform), platform, h)).toBe(expected);
    });
  }
});
