/**
 * Chords the page never receives, or receives at a price. `browserReserved` names the chords
 * Chromium, Firefox and Safari act on before the page sees them (a binding to one of these is dead
 * in a browser tab and only works in the desktop app). `desktopReserved` names what the desktop
 * shell itself binds: "shell" for the keys it takes on `before-input-event` before the page,
 * "menu" for its menu-role accelerators, which the page CAN take (an accelerator fires only for a
 * key the page left alone) at the cost of shadowing that menu action.
 */
import { chordEquals, normalizeChord, parseChord } from "./chord";
import type { Chord, HostKind, Platform } from "./types";

/** Chord strings are written in the registry grammar; `Ctrl+` is the literal Control key (macOS only differs). */
const BROWSER_ALL = [
  "Mod+KeyW", // close tab
  "Mod+Shift+KeyW", // close window
  "Mod+KeyT", // new tab
  "Mod+Shift+KeyT", // reopen closed tab
  "Mod+KeyN", // new window
  "Mod+Shift+KeyN", // new private / incognito window
  "Mod+Digit1", // switch to tab 1…
  "Mod+Digit2",
  "Mod+Digit3",
  "Mod+Digit4",
  "Mod+Digit5",
  "Mod+Digit6",
  "Mod+Digit7",
  "Mod+Digit8",
  "Mod+Digit9", // …last tab
  "Ctrl+Tab", // next tab
  "Ctrl+Shift+Tab", // previous tab
  "Ctrl+PageUp", // previous tab
  "Ctrl+PageDown", // next tab
];

const BROWSER_BY_PLATFORM: Record<Platform, readonly string[]> = {
  windows: [
    "F11", // full screen
    "Alt+F4", // close window (the OS)
  ],
  linux: [
    "F11", // full screen
    "Alt+F4", // close window (the desktop environment)
  ],
  mac: [
    "Mod+KeyQ", // quit
    "Mod+KeyH", // hide
    "Mod+Alt+KeyH", // hide others
    "Mod+KeyM", // minimize
    "Mod+Space", // Spotlight
    "Mod+Tab", // app switcher
    "Mod+Backquote", // next window of the app
    "Ctrl+ArrowUp", // Mission Control
    "Ctrl+ArrowDown", // application windows
    "Ctrl+ArrowLeft", // previous space
    "Ctrl+ArrowRight", // next space
    "Ctrl+Space", // input source switch
  ],
};

/**
 * Keys the shell takes on `before-input-event`, before the page sees them. None today: the
 * shell (packages/desktop/src/main.ts) binds nothing there, so F10 and F12 reach the page and
 * DevTools is the View menu's accelerator below. The table stays so a shell that does start
 * taking keys has one place to say so.
 */
const SHELL_BY_PLATFORM: Record<Platform, readonly string[]> = {
  windows: [],
  linux: [],
  mac: [],
};

/**
 * Electron's role accelerators in the shell's menu template (packages/desktop/src/menu.ts:
 * mac app menu, `editMenu`, `viewMenu`, `windowMenu`, plus `quit` in the Windows/Linux File
 * menu), read from Electron 43.2's lib/browser/api/menu-item-roles.ts. `zoomIn` is
 * `CommandOrControl+Plus`, which Electron's accelerator parser turns into Shift+= (the plus is a
 * shifted character); `quit` has no accelerator on Windows; `redo` is Control+Y on Windows only.
 */
const MENU_BY_PLATFORM: Record<Platform, readonly string[]> = {
  mac: [
    "Mod+KeyZ", // undo
    "Mod+Shift+KeyZ", // redo
    "Mod+KeyX", // cut
    "Mod+KeyC", // copy
    "Mod+KeyV", // paste
    "Mod+Alt+Shift+KeyV", // paste and match style
    "Mod+KeyA", // select all
    "Mod+KeyR", // reload
    "Mod+Shift+KeyR", // force reload
    "Mod+Alt+KeyI", // toggle DevTools
    "Mod+Digit0", // actual size
    "Mod+Shift+Equal", // zoom in
    "Mod+Minus", // zoom out
    "Mod+Ctrl+KeyF", // toggle full screen
    "Mod+KeyM", // minimize
    "Mod+KeyH", // hide
    "Mod+Alt+KeyH", // hide others
    "Mod+KeyQ", // quit
  ],
  windows: [
    "Ctrl+KeyZ", // undo
    "Ctrl+KeyY", // redo
    "Ctrl+KeyX", // cut
    "Ctrl+KeyC", // copy
    "Ctrl+KeyV", // paste
    "Ctrl+KeyA", // select all
    "Ctrl+KeyR", // reload
    "Ctrl+Shift+KeyR", // force reload
    "Ctrl+Shift+KeyI", // toggle DevTools
    "Ctrl+Digit0", // actual size
    "Ctrl+Shift+Equal", // zoom in
    "Ctrl+Minus", // zoom out
    "F11", // toggle full screen
    "Ctrl+KeyM", // minimize
    "Ctrl+KeyW", // close (hides the window to the tray)
  ],
  linux: [
    "Ctrl+KeyZ", // undo
    "Ctrl+Shift+KeyZ", // redo
    "Ctrl+KeyX", // cut
    "Ctrl+KeyC", // copy
    "Ctrl+KeyV", // paste
    "Ctrl+KeyA", // select all
    "Ctrl+KeyR", // reload
    "Ctrl+Shift+KeyR", // force reload
    "Ctrl+Shift+KeyI", // toggle DevTools
    "Ctrl+Digit0", // actual size
    "Ctrl+Shift+Equal", // zoom in
    "Ctrl+Minus", // zoom out
    "F11", // toggle full screen
    "Ctrl+KeyM", // minimize
    "Ctrl+KeyW", // close (hides the window to the tray)
    "Ctrl+KeyQ", // quit
  ],
};

const cache = new Map<string, Chord[]>();

function table(name: string, texts: readonly string[], platform: Platform): Chord[] {
  const key = `${name}:${platform}`;
  let parsed = cache.get(key);
  if (parsed === undefined) {
    parsed = [];
    for (const text of texts) {
      const chord = parseChord(text);
      if (chord === null) throw new Error(`malformed reserved chord: ${text}`);
      parsed.push(normalizeChord(chord, platform));
    }
    cache.set(key, parsed);
  }
  return parsed;
}

function inTable(chord: Chord, parsed: readonly Chord[]): boolean {
  return parsed.some((entry) => chordEquals(entry, chord));
}

export function browserReserved(chord: Chord, platform: Platform): boolean {
  return (
    inTable(chord, table("browser", BROWSER_ALL, platform)) ||
    inTable(chord, table("browser-platform", BROWSER_BY_PLATFORM[platform], platform))
  );
}

export function desktopReserved(chord: Chord, platform: Platform): "shell" | "menu" | null {
  if (inTable(chord, table("shell", SHELL_BY_PLATFORM[platform], platform))) return "shell";
  if (inTable(chord, table("menu", MENU_BY_PLATFORM[platform], platform))) return "menu";
  return null;
}

/**
 * Whether a chord is worth showing as the way to run a command on this host. A browser tab
 * never receives a chord the browser reserves (⌘W closes the tab itself), so a tooltip naming it
 * there would promise a key that does the opposite; the desktop app receives every chord.
 */
export function shownOnHost(chord: Chord, platform: Platform, host: HostKind): boolean {
  return host !== "browser" || !browserReserved(chord, platform);
}
