/**
 * The terminal's clipboard keys (src/lib/shortcuts/terminal-clipboard.ts), split by platform:
 * the Windows Terminal conventions off a Mac; on a Mac the native ⌘C / ⌘V only, so Ctrl+C is
 * always SIGINT and Ctrl+V reaches the shell.
 */
import { describe, expect, it } from "vitest";
import { terminalClipboardAction } from "../src/lib/shortcuts/terminal-clipboard";
import type { KeyLike } from "../src/lib/shortcuts/types";

function key(overrides: Partial<KeyLike> & { key: string }): KeyLike {
  return { code: "", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...overrides };
}

describe("Windows and Linux", () => {
  for (const platform of ["windows", "linux"] as const) {
    it(`${platform}: copies on Ctrl+Shift+C, Ctrl+Insert and Ctrl+C over a selection`, () => {
      expect(
        terminalClipboardAction(
          key({ key: "C", code: "KeyC", ctrlKey: true, shiftKey: true }),
          platform,
          false,
        ),
      ).toBe("copy");
      expect(
        terminalClipboardAction(
          key({ key: "Insert", code: "Insert", ctrlKey: true }),
          platform,
          false,
        ),
      ).toBe("copy");
      expect(
        terminalClipboardAction(key({ key: "c", code: "KeyC", ctrlKey: true }), platform, true),
      ).toBe("copy");
      // No selection: Ctrl+C is SIGINT.
      expect(
        terminalClipboardAction(key({ key: "c", code: "KeyC", ctrlKey: true }), platform, false),
      ).toBeNull();
      // Ctrl+Alt+C is neither.
      expect(
        terminalClipboardAction(
          key({ key: "c", code: "KeyC", ctrlKey: true, altKey: true }),
          platform,
          true,
        ),
      ).toBeNull();
    });

    it(`${platform}: pastes on Ctrl+V, Ctrl+Shift+V and Shift+Insert`, () => {
      expect(
        terminalClipboardAction(key({ key: "v", code: "KeyV", ctrlKey: true }), platform, false),
      ).toBe("paste");
      expect(
        terminalClipboardAction(
          key({ key: "V", code: "KeyV", ctrlKey: true, shiftKey: true }),
          platform,
          false,
        ),
      ).toBe("paste");
      expect(
        terminalClipboardAction(
          key({ key: "Insert", code: "Insert", shiftKey: true }),
          platform,
          false,
        ),
      ).toBe("paste");
      expect(
        terminalClipboardAction(
          key({ key: "v", code: "KeyV", ctrlKey: true, altKey: true }),
          platform,
          false,
        ),
      ).toBeNull();
      // The Windows / Super key belongs to the OS.
      expect(
        terminalClipboardAction(key({ key: "v", code: "KeyV", metaKey: true }), platform, false),
      ).toBeNull();
    });
  }
});

describe("macOS", () => {
  it("does not treat Ctrl+C over a selection as a copy: it is SIGINT", () => {
    expect(
      terminalClipboardAction(key({ key: "c", code: "KeyC", ctrlKey: true }), "mac", true),
    ).toBeNull();
  });

  it("does not swallow Ctrl+V: it is the shell's verbatim insert", () => {
    expect(
      terminalClipboardAction(key({ key: "v", code: "KeyV", ctrlKey: true }), "mac", false),
    ).toBeNull();
    expect(
      terminalClipboardAction(key({ key: "Insert", code: "Insert", shiftKey: true }), "mac", false),
    ).toBeNull();
  });

  it("leaves ⌘C and ⌘V to the browser's native copy and paste", () => {
    expect(
      terminalClipboardAction(key({ key: "c", code: "KeyC", metaKey: true }), "mac", true),
    ).toBeNull();
    expect(
      terminalClipboardAction(key({ key: "v", code: "KeyV", metaKey: true }), "mac", false),
    ).toBeNull();
  });

  it("keeps Ctrl+Shift+C as a copy", () => {
    expect(
      terminalClipboardAction(
        key({ key: "C", code: "KeyC", ctrlKey: true, shiftKey: true }),
        "mac",
        false,
      ),
    ).toBe("copy");
    expect(
      terminalClipboardAction(
        key({ key: "C", code: "KeyC", ctrlKey: true, shiftKey: true, metaKey: true }),
        "mac",
        false,
      ),
    ).toBeNull();
  });
});
