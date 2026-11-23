/**
 * New Window is offered in a window of the desktop app and nowhere else (lib/desktop-window.ts):
 * the pair of the server's desktop mode and how the session signed in, never either alone.
 */
import { describe, expect, it } from "vitest";
import { offersNewWindow } from "../src/lib/desktop-window";

describe("offersNewWindow", () => {
  it("is offered by the shell's own session against the shell's own server only", () => {
    expect(offersNewWindow({ desktopMode: true, sessionVia: "desktop" })).toBe(true);
    // A browser signed into the same desktop-mode server may be on another machine.
    expect(offersNewWindow({ desktopMode: true, sessionVia: "password" })).toBe(false);
    // A stale desktop cookie against a plain server: no shell is listening.
    expect(offersNewWindow({ desktopMode: false, sessionVia: "desktop" })).toBe(false);
    expect(offersNewWindow({ desktopMode: false, sessionVia: "password" })).toBe(false);
  });
});
