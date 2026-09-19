/**
 * The vocabulary of the keyboard shortcut system. Everything under lib/shortcuts/ is written
 * against these types and, except for the store's storage edge and the dispatcher's window
 * listener, touches no DOM: the matcher, formatter, conflict finder and reserved-chord tables
 * are pure functions over a `Chord`, so they run unchanged in Node for the tests.
 */

export type Platform = "mac" | "windows" | "linux";

/** Which host runs the page: the reserved-chord notice differs, nothing else does. */
export type HostKind = "browser" | "desktop";

/**
 * The focus scope a command is matched in. `global` matches anywhere; `terminal` only while an
 * xterm has focus; `editor` only inside a text editor's own key handler. Two focus scopes never
 * hold focus at once, which is what makes the resolution order deterministic.
 */
export type ShortcutScope = "global" | "terminal" | "editor";

/**
 * Settings-page grouping, display only. `panels` holds the dock and sidebar toggles, which are
 * global-scope commands grouped by what they act on rather than by where they fire.
 */
export type ShortcutGroup = "general" | "panels" | "terminal" | "editor";

/**
 * The rebindable commands. `palette.toggle` is owned by the command palette; its id and default
 * are reserved here so the settings page lists it before the palette lands.
 */
export type CommandId =
  | "palette.toggle"
  | "sessions.search"
  | "chat.new"
  | "sidebar.toggle"
  | "dock.toggleRight"
  | "dock.toggleBottom"
  | "terminal.toggle"
  | "terminal.new"
  | "terminal.close"
  | "editor.save";

/**
 * One key combination. `code` is the `KeyboardEvent.code` of the non-modifier key ("KeyW",
 * "Backquote", "F12"): a physical position, so a chord survives a CJK IME, Shift, Caps Lock and a
 * macOS Option chord, none of which change `code`.
 */
export interface Chord {
  code: string;
  /** Mod = ⌘ on macOS, Ctrl elsewhere. */
  mod: boolean;
  /**
   * Literal Control. Only ever true on macOS; on the other platforms Control IS Mod and is
   * recorded as such, so a chord read back from an event never has both set there.
   */
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
}

export interface ShortcutCommand {
  id: CommandId;
  scope: ShortcutScope;
  group: ShortcutGroup;
  /**
   * Serialized chords ("Mod+Shift+KeyW"); null = unbound by default. `default` covers every
   * platform without an entry of its own.
   */
  defaults: {
    default: string | null;
    mac?: string | null;
    windows?: string | null;
    linux?: string | null;
  };
}

/** id → chord (null = unbound), fully resolved for the current platform. */
export type Keymap = ReadonlyMap<CommandId, Chord | null>;

/**
 * The persisted form, shared by the server's `ui_prefs.keybindings` and the browser mirror, is
 * declared once, with the other prefs types the server validates. Only overrides are stored; a
 * row equal to its default is absent. Unknown ids are carried through on write and never
 * applied, so a build that predates a command keeps its binding.
 */
export type { StoredKeybindings } from "@prismshadow/penguin-server/api";

/** The fields of a `KeyboardEvent` the matcher reads; React's synthetic event and a test literal both fit. */
export interface KeyLike {
  code: string;
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  repeat?: boolean;
  isComposing?: boolean;
  /** A DOM or React event's modifier query; the matcher asks it for AltGraph. */
  getModifierState?: (key: string) => boolean;
  /** Test literals set this directly; on a real event it is read through getModifierState. */
  altGraph?: boolean;
}
