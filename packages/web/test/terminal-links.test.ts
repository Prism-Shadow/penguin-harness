/**
 * Opening a link a terminal printed (features/terminal/terminal-links.ts).
 *
 * Terminal output is a program's, not the reader's, so the scheme check is the load-bearing
 * part: a `javascript:` or `data:` link is as easy to print as an `https:` one, and this is
 * the sink xterm's own documentation warns to validate. The other half is that a real URL is
 * opened DIRECTLY — the addon's built-in handler opens a blank window first and navigates
 * it, which inside the desktop shell became a link to `about:blank`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { isOpenableLink, openTerminalLink } from "../src/features/terminal/terminal-links";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Records what window.open was asked to do. */
function stubWindowOpen(): { calls: [string, string, string][] } {
  const calls: [string, string, string][] = [];
  vi.stubGlobal("window", {
    open: (url: string, target: string, features: string) => {
      calls.push([url, target, features]);
      return null;
    },
  });
  return { calls };
}

describe("isOpenableLink", () => {
  it("accepts the two schemes a page may be at", () => {
    expect(isOpenableLink("https://github.com/o/r/pull/555")).toBe(true);
    expect(isOpenableLink("http://localhost:7364/")).toBe(true);
  });

  it("refuses everything a program could print to make the terminal act", () => {
    for (const uri of [
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "file:///etc/passwd",
      "vscode://file/etc/passwd",
      "about:blank",
      "",
      "github.com/o/r",
    ]) {
      expect(isOpenableLink(uri)).toBe(false);
    }
  });
});

describe("openTerminalLink", () => {
  it("opens the URL itself, in one step, with no opener", () => {
    // The regression: the addon's own handler opens `window.open()` with NO url — a blank
    // window — and then assigns location.href. The shell routes by the url it is handed, so
    // that one arrived as about:blank and the real link never opened.
    const { calls } = stubWindowOpen();
    openTerminalLink("https://github.com/o/r/pull/555");
    expect(calls).toEqual([["https://github.com/o/r/pull/555", "_blank", "noopener,noreferrer"]]);
  });

  it("opens nothing at all for a scheme it refuses", () => {
    const { calls } = stubWindowOpen();
    openTerminalLink("javascript:alert(1)");
    openTerminalLink("about:blank");
    expect(calls).toEqual([]);
  });
});
