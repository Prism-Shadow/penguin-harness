/**
 * desktop-renderer.ts unit tests: telling the desktop shell's Electron window from a browser
 * by the user agent, which is the fact that decides whether a blank tab can be opened inside
 * a click (a browser needs one against its popup blocker; the shell refuses one). vitest runs
 * node-only here, so this asserts the pure helper, not the dialog that reads navigator.
 */
import { describe, expect, it } from "vitest";
import { isElectronRenderer } from "../src/lib/desktop-renderer";

const ELECTRON_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) PenguinHarness/0.2.13 Chrome/146.0.7680.0 Electron/43.2.0 Safari/537.36";
const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";
const FIREFOX_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:132.0) Gecko/20100101 Firefox/132.0";
const SAFARI_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15";

describe("isElectronRenderer", () => {
  it("recognises the shell's window by Electron's own token, in any session", () => {
    // Attach mode signs the shell's window in through the login page; it is still Electron.
    expect(isElectronRenderer(ELECTRON_UA)).toBe(true);
  });

  it("answers false for every browser, including one signed into a desktop-mode server", () => {
    for (const ua of [CHROME_UA, FIREFOX_UA, SAFARI_UA, "", "Node.js/24"]) {
      expect(isElectronRenderer(ua), ua).toBe(false);
    }
  });

  it("wants the token, not the word", () => {
    // A product name or a path that merely mentions Electron is not the renderer's own mark.
    expect(isElectronRenderer("Mozilla/5.0 ElectronNotes/1.0 Chrome/146.0.0.0")).toBe(false);
    expect(isElectronRenderer("Mozilla/5.0 Chrome/146.0.0.0 electron/43.2.0")).toBe(false);
  });
});
