import { describe, expect, it } from "vitest";
import { AnsiStripper } from "../src/environment/tools/command/ansi.js";

describe("AnsiStripper", () => {
  it("removes CSI colors even when every fragment arrives in a separate chunk", () => {
    const s = new AnsiStripper();
    expect(s.strip("before\u001b[")).toBe("before");
    expect(s.strip("36")).toBe("");
    expect(s.strip("mcyan\u001b")).toBe("cyan");
    expect(s.strip("[0m after")).toBe(" after");
  });

  it("removes OSC hyperlinks and titles terminated by BEL or ST", () => {
    const s = new AnsiStripper();
    expect(s.strip("a\u001b]8;;https://example.com\u001b\\link\u001b]8;;\u0007b")).toBe("alinkb");
  });

  it("preserves ordinary Unicode, newlines, tabs, and carriage-return progress output", () => {
    const s = new AnsiStripper();
    expect(s.strip("企鹅\t10%\r20%\n")).toBe("企鹅\t10%\r20%\n");
  });
});
