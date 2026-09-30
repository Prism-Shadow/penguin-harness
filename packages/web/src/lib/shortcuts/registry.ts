/**
 * The command registry: every user-rebindable shortcut, with its scope, its settings-page group
 * and its default chord per platform. This is the one place a default is authored; every surface
 * that shows a chord formats it from here, and the surface that owns an action asks the matcher
 * whether an event is that command rather than reading modifier keys itself.
 *
 * Defaults are written with `Mod`, which resolves to ⌘ on macOS and Ctrl elsewhere. A literal
 * `Ctrl+` token is reserved for the case where the macOS binding must NOT follow ⌘, and the
 * registry test holds that line. Defaults also stay off the browsers' own shortcuts
 * (reserved.ts), which is why most sit on Mod+Alt — ⌥⌘ on macOS, Ctrl+Alt elsewhere; the registry
 * test holds that line too, and names the defaults that still share a chord with a browser.
 */
import { normalizeChord, parseChord } from "./chord";
import type { Chord, CommandId, Platform, ShortcutCommand, ShortcutGroup } from "./types";

export const SHORTCUT_COMMANDS: readonly ShortcutCommand[] = [
  {
    id: "palette.toggle",
    scope: "global",
    group: "general",
    // Mod+P is the browser's Print. On macOS this takes over Chrome's ⌥⌘P (Page Setup).
    defaults: { default: "Mod+Alt+KeyP" },
  },
  {
    id: "sessions.search",
    scope: "global",
    group: "general",
    // Mod+K is the browser's web search.
    defaults: { default: "Mod+Alt+KeyS" },
  },
  {
    id: "chat.new",
    scope: "global",
    group: "general",
    // Mod+N opens a browser window. On macOS this takes over Chrome's ⌥⌘N (split view).
    defaults: { default: "Mod+Alt+KeyN" },
  },
  {
    id: "sidebar.toggle",
    scope: "global",
    group: "panels",
    // Mod+B is Firefox's bookmarks sidebar; the three panel toggles count Mod+Alt+1 to 3.
    defaults: { default: "Mod+Alt+Digit1" },
  },
  {
    id: "dock.toggleRight",
    scope: "global",
    group: "panels",
    // Mod+Alt+B is Chrome's bookmark manager on macOS.
    defaults: { default: "Mod+Alt+Digit2" },
  },
  {
    id: "dock.toggleBottom",
    scope: "global",
    group: "panels",
    // Mod+J opens the browser's downloads.
    defaults: { default: "Mod+Alt+Digit3" },
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
    // Mod+W closes the browser tab. The toggle's key plus Alt, literal Control like the toggle.
    defaults: { default: "Ctrl+Alt+Backquote" },
  },
  {
    id: "editor.save",
    scope: "editor",
    group: "editor",
    // Every editor's save chord: the editors take it from the browser's Save Page on purpose.
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
