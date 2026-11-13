/**
 * The keys this shell binds itself, as pure predicates (no Electron import, so they
 * unit-test directly). main.ts wires them on `before-input-event`.
 *
 * Why not the application menu's accelerators: Chromium offers a key to the page before it
 * fires one, so anything the page consumes never reaches the menu — and on Windows and Linux
 * the menu bar is hidden, so there is nothing on screen to reveal the binding either. A
 * shortcut the shell means to guarantee has to be taken before the page sees it.
 */

/** The fields of Electron's `Input` these predicates read. */
export interface KeyChord {
  type: string;
  key: string;
  alt: boolean;
  control: boolean;
  meta: boolean;
  shift: boolean;
}

/** A bare key press: this key, no modifier held. */
function bare(input: KeyChord, key: string): boolean {
  return (
    input.key.toLowerCase() === key.toLowerCase() &&
    !input.alt &&
    !input.control &&
    !input.meta &&
    !input.shift
  );
}

/** F10 reveals the hidden menu bar (and hides it again). */
export function isMenuBarKey(input: KeyChord): boolean {
  return input.type === "keyDown" && bare(input, "F10");
}

/**
 * DevTools: F12, or Ctrl+Shift+I — the combo already in most fingers, which the page would
 * otherwise be free to swallow (the terminal claims its Ctrl+Shift neighbours for copy and
 * paste). macOS keeps its own ⌥⌘I through the visible menu bar.
 */
export function isDevToolsKey(input: KeyChord): boolean {
  if (input.type !== "keyDown") return false;
  if (bare(input, "F12")) return true;
  return (
    input.control && input.shift && !input.alt && !input.meta && input.key.toLowerCase() === "i"
  );
}
