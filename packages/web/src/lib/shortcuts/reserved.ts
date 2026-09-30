/**
 * Chords the page never receives, or receives at a price. `browserReserved` names the chords
 * Chromium, Firefox and Safari act on before the page sees them (a binding to one of these is dead
 * in a browser tab and only works in the desktop app). `browserCommon` names the chords a browser
 * binds but acts on only when the page leaves the key alone (a binding to one of these works in a
 * browser tab and takes over that browser function there, as ⌘P would take over Print).
 * `desktopReserved` names what the desktop shell itself binds: "shell" for the keys it takes on
 * `before-input-event` before the page, "menu" for its menu-role accelerators, which the page CAN
 * take (an accelerator fires only for a key the page left alone) at the cost of shadowing that
 * menu action.
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
 * The browsers' own functions on chords the page can take, read from Chrome's and Safari's
 * published shortcut tables and from Firefox's key definitions (browser-sets.inc.xhtml) and
 * DevTools table; a browser in parentheses is the one that binds the chord for that function.
 * Chords the reserved tables above hold are not repeated.
 */
const COMMON_ALL = [
  "Mod+KeyP", // print
  "Mod+KeyS", // save page
  "Mod+KeyO", // open a file
  "Mod+KeyF", // find
  "Mod+KeyG", // find next
  "Mod+Shift+KeyG", // find previous
  "Mod+KeyE", // search (on macOS: find the selection)
  "Mod+KeyK", // search the web
  "Mod+KeyL", // address bar
  "Mod+KeyR", // reload
  "Mod+Shift+KeyR", // reload, ignoring the cache (Safari: Reader)
  "Mod+KeyD", // bookmark this page
  "Mod+Shift+KeyD", // bookmark all tabs (Safari: add to Reading List)
  "Mod+KeyB", // bookmarks sidebar (Firefox)
  "Mod+Shift+KeyB", // bookmarks bar
  "Mod+Shift+KeyO", // bookmark manager
  "Mod+KeyJ", // downloads
  "Mod+Shift+KeyH", // history (on macOS also the home page, Chrome and Safari)
  "Mod+KeyU", // view source
  "Mod+KeyI", // page info (Firefox)
  "Mod+Shift+KeyI", // developer tools (on macOS: Chrome's email a link)
  "Mod+Shift+KeyJ", // console (on macOS: Chrome's downloads)
  "Mod+Alt+Shift+KeyI", // browser toolbox
  "Mod+Alt+KeyZ", // sidebar (Firefox; on macOS its debugger)
  "Mod+Shift+KeyM", // switch profile (Chrome)
  "Mod+Shift+KeyA", // add-ons (Firefox)
  "Mod+Shift+KeyS", // screenshot (Firefox)
  "Mod+Shift+KeyX", // text direction (Firefox)
  "Mod+Shift+Delete", // clear browsing data
  "Mod+Equal", // zoom in
  "Mod+Shift+Equal", // zoom in (+)
  "Mod+Minus", // zoom out
  "Mod+Shift+Minus", // zoom out (_, Firefox)
  "Mod+Digit0", // actual size
  "Mod+KeyZ", // undo
  "Mod+Shift+KeyZ", // redo (on Windows: Firefox's debugger)
  "Mod+KeyX", // cut
  "Mod+KeyC", // copy
  "Mod+KeyV", // paste
  "Mod+KeyA", // select all
  "Ctrl+KeyM", // mute the tab (Firefox)
  "Ctrl+Shift+PageUp", // move the tab left (Chrome)
  "Ctrl+Shift+PageDown", // move the tab right (Chrome)
  "F3", // find next
  "Shift+F3", // find previous (Firefox)
  "F5", // reload
  "Shift+F5", // reload, ignoring the cache (Firefox: profiler)
  "F7", // caret browsing
  "Shift+F7", // style editor (Firefox)
  "Shift+F9", // storage inspector (Firefox)
  "F12", // developer tools
];

/** Shared by Windows and Linux; macOS spells these functions with ⌘ and ⌥ instead. */
const COMMON_OFF_MAC = [
  "Mod+KeyH", // history
  "Alt+ArrowLeft", // back
  "Alt+ArrowRight", // forward
  "Alt+Home", // home page
  "Alt+KeyD", // address bar
  "Alt+KeyE", // browser menu (Chrome)
  "Alt+KeyF", // browser menu (Chrome)
  "Alt+Shift+KeyA", // focus inactive dialogs (Chrome)
  "Alt+Shift+KeyI", // feedback (Chrome)
  "Alt+Shift+KeyN", // split view (Chrome)
  "Alt+Shift+KeyT", // toolbar focus (Chrome)
  "Mod+Shift+KeyC", // pick an element (Firefox)
  "Mod+Shift+KeyE", // network monitor (Firefox)
  "Mod+Shift+KeyK", // web console (Firefox)
  "Mod+Shift+BracketRight", // picture-in-picture (Firefox)
  "Mod+Alt+KeyU", // open tabs sidebar (Firefox)
  "Mod+Alt+KeyX", // AI chatbot sidebar (Firefox)
  "Mod+F5", // reload, ignoring the cache (Firefox)
  "Mod+F6", // skip to the page (Chrome)
  "F1", // help (Chrome)
  "F6", // address bar (Chrome)
  "F10", // toolbar focus (Chrome)
];

const COMMON_BY_PLATFORM: Record<Platform, readonly string[]> = {
  windows: [
    "Mod+KeyY", // redo (Firefox)
    "F9", // reader view (Firefox)
  ],
  linux: [
    "Mod+Shift+KeyY", // downloads (Firefox)
    "Mod+Alt+KeyR", // reader view (Firefox)
    "Mod+BracketLeft", // back (Firefox)
    "Mod+BracketRight", // forward (Firefox)
    "Alt+Digit1", // switch to tab 1… (Firefox)
    "Alt+Digit2",
    "Alt+Digit3",
    "Alt+Digit4",
    "Alt+Digit5",
    "Alt+Digit6",
    "Alt+Digit7",
    "Alt+Digit8",
    "Alt+Digit9", // …last tab
  ],
  mac: [
    "Mod+KeyY", // history
    "Mod+Comma", // settings
    "Mod+Period", // stop loading (Firefox)
    "Mod+BracketLeft", // back
    "Mod+BracketRight", // forward
    "Mod+ArrowLeft", // back
    "Mod+ArrowRight", // forward
    "Mod+Shift+Backslash", // tab overview (Safari)
    "Mod+Shift+Backspace", // clear browsing data
    "Mod+Shift+KeyF", // full screen (Firefox)
    "Mod+Ctrl+KeyF", // full screen
    "Mod+Ctrl+Digit1", // bookmarks sidebar (Safari)
    "Mod+Ctrl+Digit2", // Reading List sidebar (Safari)
    "Mod+Alt+KeyB", // bookmark manager (Chrome)
    "Mod+Alt+KeyC", // inspect an element
    "Mod+Alt+KeyE", // network monitor (Firefox)
    "Mod+Alt+KeyF", // search the web
    "Mod+Alt+KeyI", // developer tools
    "Mod+Alt+KeyJ", // JavaScript console
    "Mod+Alt+KeyK", // web console (Firefox)
    "Mod+Alt+KeyM", // responsive design mode (Firefox)
    "Mod+Alt+KeyN", // split view (Chrome)
    "Mod+Alt+KeyP", // page setup (Chrome)
    "Mod+Alt+KeyR", // reader view (Firefox)
    "Mod+Alt+KeyU", // view source
    "Mod+Alt+Shift+KeyA", // focus inactive dialogs (Chrome)
    "Mod+Alt+Shift+BracketRight", // picture-in-picture (Firefox)
    "Mod+Alt+ArrowUp", // cycle the focus through the toolbars (Chrome)
    "Mod+Alt+ArrowDown",
    "Ctrl+KeyU", // open tabs sidebar (Firefox)
    "Ctrl+KeyX", // AI chatbot sidebar (Firefox)
    "Ctrl+KeyZ", // sidebar (Firefox)
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

export function browserCommon(chord: Chord, platform: Platform): boolean {
  return (
    inTable(chord, table("common", COMMON_ALL, platform)) ||
    (platform !== "mac" && inTable(chord, table("common-off-mac", COMMON_OFF_MAC, platform))) ||
    inTable(chord, table("common-platform", COMMON_BY_PLATFORM[platform], platform))
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
