/**
 * The command registry: every user-rebindable shortcut, with its scope, its settings-page group
 * and its default chord per platform. This is the one place a default is authored; every surface
 * that shows a chord formats it from here, and the surface that owns an action asks the matcher
 * whether an event is that command rather than reading modifier keys itself.
 *
 * Defaults are written with `Mod`, which resolves to ⌘ on macOS and Ctrl elsewhere. A literal
 * `Ctrl+` token is reserved for the case where the macOS binding must NOT follow ⌘, and the
 * registry test holds that line. Where the usual desktop shortcut is a browser navigation
 * command, the browser and desktop hosts each supply their own default.
 * `overDialogs` lets a command through while a dialog or menu is open (see dispatcher.ts).
 */
import { normalizeChord, parseChord } from "./chord";
import type { Chord, CommandId, HostKind, Platform, ShortcutCommand, ShortcutGroup } from "./types";

export const SHORTCUT_COMMANDS: readonly ShortcutCommand[] = [
  {
    id: "palette.toggle",
    scope: "global",
    group: "general",
    // Mod+P is the browser's Print. Mod+Shift+P is the editors' command palette chord, and
    // Firefox's new private window: Firefox acts on it before the page, so in a Firefox tab the
    // palette needs a rebinding (the registry test names this default on purpose).
    defaults: { default: "Mod+Shift+KeyP" },
    overDialogs: true,
  },
  {
    id: "sessions.search",
    scope: "global",
    group: "general",
    // Mod+K is the browser's web search.
    defaults: { default: "Mod+Alt+KeyS" },
    desktopDefault: "Mod+KeyK",
  },
  {
    id: "chat.new",
    scope: "global",
    group: "general",
    // Mod+N opens a browser window. On macOS this takes over Chrome's ⌥⌘N (split view).
    defaults: { default: "Mod+Alt+KeyN" },
    desktopDefault: "Mod+KeyN",
  },
  {
    id: "find.open",
    scope: "global",
    group: "general",
    // The browser's own find: the find bar takes it on purpose, as the editors take Save Page. The
    // bar declines while no searchable region is on screen, so the browser keeps it there.
    defaults: { default: "Mod+KeyF" },
  },
  {
    id: "find.all",
    scope: "global",
    group: "general",
    // On macOS ⇧⌘F is Firefox's full screen.
    defaults: { default: "Mod+Shift+KeyF" },
  },
  {
    id: "sidebar.toggle",
    scope: "global",
    group: "panels",
    // Editors and IDEs use Mod+B for the left sidebar. Rich text keeps its bold command.
    defaults: { default: "Mod+KeyB" },
  },
  {
    id: "dock.toggleRight",
    scope: "global",
    group: "panels",
    // Mod+Alt+B is Chrome's bookmark manager on macOS.
    defaults: { default: "Mod+Alt+Digit2" },
    desktopDefault: "Mod+Alt+KeyB",
  },
  {
    id: "dock.toggleBottom",
    scope: "global",
    group: "panels",
    // Mod+J opens the browser's downloads.
    defaults: { default: "Mod+Alt+Digit3" },
    desktopDefault: "Mod+KeyJ",
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
export function defaultChord(
  cmd: ShortcutCommand,
  platform: Platform,
  host: HostKind = "browser",
): Chord | null {
  const platformDefault =
    cmd.defaults[platform] === undefined ? cmd.defaults.default : cmd.defaults[platform];
  const text = host === "desktop" ? (cmd.desktopDefault ?? platformDefault) : platformDefault;
  if (text === null || text === undefined) return null;
  const chord = parseChord(text);
  return chord === null ? null : normalizeChord(chord, platform);
}
