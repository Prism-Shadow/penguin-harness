/**
 * The command registry: every user-rebindable shortcut, with its scope, its settings-page group
 * and its default chord per platform. This is the one place a default is authored; every surface
 * that shows a chord formats it from here, and the surface that owns an action asks the matcher
 * whether an event is that command rather than reading modifier keys itself.
 *
 * Defaults are written with `Mod`, which resolves to ⌘ on macOS and Ctrl elsewhere. A literal
 * `Ctrl+` token is reserved for the case where the macOS binding must NOT follow ⌘, and the
 * registry test holds that line.
 */
import { normalizeChord, parseChord } from "./chord";
import type { Chord, CommandId, Platform, ShortcutCommand, ShortcutGroup } from "./types";

export const SHORTCUT_COMMANDS: readonly ShortcutCommand[] = [
  {
    id: "palette.toggle",
    scope: "global",
    group: "general",
    defaults: { default: "Mod+KeyP" },
  },
  {
    id: "sessions.search",
    scope: "global",
    group: "general",
    defaults: { default: "Mod+KeyK" },
  },
  {
    id: "chat.new",
    scope: "global",
    group: "general",
    // ChatGPT's new-chat chord; plain Mod+N is the browser's new window everywhere.
    defaults: { default: "Mod+Shift+KeyO" },
  },
  {
    id: "sidebar.toggle",
    scope: "global",
    group: "panels",
    defaults: { default: "Mod+KeyB" },
  },
  {
    id: "dock.toggleRight",
    scope: "global",
    group: "panels",
    defaults: { default: "Mod+Alt+KeyB" },
  },
  {
    id: "dock.toggleBottom",
    scope: "global",
    group: "panels",
    defaults: { default: "Mod+KeyJ" },
  },
  {
    id: "terminal.toggle",
    scope: "global",
    group: "terminal",
    // ⌃` on macOS too: ⌘` is macOS's own window cycling, and VS Code and Codex use ⌃` there.
    defaults: { default: "Ctrl+Backquote" },
  },
  {
    id: "terminal.new",
    scope: "global",
    group: "terminal",
    // VS Code's new-terminal chord, literal Control for the same reason as the toggle.
    defaults: { default: "Ctrl+Shift+Backquote" },
  },
  {
    id: "terminal.close",
    scope: "terminal",
    group: "terminal",
    defaults: { default: "Mod+KeyW" },
  },
  {
    id: "editor.save",
    scope: "editor",
    group: "editor",
    defaults: { default: "Mod+KeyS" },
  },
];

/** The settings page draws groups in this order. */
export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  "general",
  "panels",
  "terminal",
  "editor",
];

const BY_ID = new Map(SHORTCUT_COMMANDS.map((cmd) => [cmd.id, cmd]));

export function commandById(id: CommandId): ShortcutCommand {
  const cmd = BY_ID.get(id);
  if (cmd === undefined) throw new Error(`unknown shortcut command: ${id}`);
  return cmd;
}

/** The platform's own default when the command has one, else the shared default; normalized for the platform. */
export function defaultChord(cmd: ShortcutCommand, platform: Platform): Chord | null {
  const text = cmd.defaults[platform] !== undefined ? cmd.defaults[platform] : cmd.defaults.default;
  if (text === null || text === undefined) return null;
  const chord = parseChord(text);
  return chord === null ? null : normalizeChord(chord, platform);
}
