/**
 * stripAnsi unit tests: render-time removal of ANSI escape sequences from raw command/tool
 * output (#102), including sequences split across stream chunks and cut off at end-of-string.
 */
import { describe, expect, it } from "vitest";
import { stripAnsi } from "../src/lib/strip-ansi";

describe("stripAnsi", () => {
  it("returns text without escapes unchanged (fast path, same reference)", () => {
    const s = "plain text, no escapes [36m literal brackets stay";
    expect(stripAnsi(s)).toBe(s);
    expect(stripAnsi("")).toBe("");
  });

  it("strips plain SGR color codes", () => {
    expect(stripAnsi("\x1b[36mcyan\x1b[0m")).toBe("cyan");
    expect(stripAnsi("\x1b[2mdim\x1b[0m and \x1b[32mgreen\x1b[0m")).toBe("dim and green");
  });

  it("strips multi-parameter SGR codes", () => {
    expect(stripAnsi("\x1b[1;31mbold red\x1b[0m")).toBe("bold red");
    expect(stripAnsi("\x1b[38;5;208morange\x1b[0m")).toBe("orange");
  });

  it("cleans the issue's nested-CLI gutter shape", () => {
    // What #102 showed in the tool card: a nested `penguin run`'s colored call line.
    const raw = "\x1b[36m[tool-752] $ \x1b[0m\x1b[36mcat todo.md\x1b[0m\n";
    expect(stripAnsi(raw)).toBe("[tool-752] $ cat todo.md\n");
  });

  it("strips OSC sequences (BEL- and ST-terminated) and two-byte escapes", () => {
    expect(stripAnsi("\x1b]0;window title\x07rest")).toBe("rest");
    expect(stripAnsi("\x1b]8;;https://example.com\x1b\\link text\x1b]8;;\x1b\\")).toBe("link text");
    expect(stripAnsi("a\x1bMb")).toBe("ab");
  });

  it("handles a sequence split across a chunk boundary once chunks are concatenated", () => {
    const chunk1 = "before \x1b[3";
    const chunk2 = "6mblue\x1b[0m after";
    expect(stripAnsi(chunk1 + chunk2)).toBe("before blue after");
  });

  it("drops an incomplete trailing escape sequence (stream cut mid-sequence)", () => {
    expect(stripAnsi("text\x1b")).toBe("text");
    expect(stripAnsi("text\x1b[")).toBe("text");
    expect(stripAnsi("text\x1b[36")).toBe("text");
    expect(stripAnsi("text\x1b[1;3")).toBe("text");
    expect(stripAnsi("text\x1b]0;half a title")).toBe("text");
  });

  it("keeps surrounding text intact when stripping mid-string sequences", () => {
    expect(stripAnsi("ok\x1b[31mfail\x1b[0mok")).toBe("okfailok");
  });
});
