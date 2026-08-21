/**
 * frontmatter.ts unit tests: stripping the leading YAML block from a memory file's content,
 * shared by the agent-settings memory tab and the chat Memory panel. The cases that matter are
 * the ones a hand-written topic file actually produces — no block, an unterminated block, CRLF,
 * a BOM, and a `---` rule further down the body.
 */
import { describe, expect, it } from "vitest";
import { bodyWithoutFrontmatter } from "../src/lib/frontmatter";

describe("bodyWithoutFrontmatter", () => {
  it("strips a well-formed block and keeps the body verbatim", () => {
    expect(bodyWithoutFrontmatter("---\nname: Prefs\n---\nBody line\n")).toBe("Body line\n");
  });

  it("leaves content that has no frontmatter untouched", () => {
    expect(bodyWithoutFrontmatter("# Title\n\nBody\n")).toBe("# Title\n\nBody\n");
  });

  it("leaves an unterminated block untouched — a half-written file must not lose its body", () => {
    expect(bodyWithoutFrontmatter("---\nname: Prefs\nBody\n")).toBe("---\nname: Prefs\nBody\n");
  });

  it("closes on the FIRST fence, so a horizontal rule further down stays in the body", () => {
    expect(bodyWithoutFrontmatter("---\nname: P\n---\nOne\n\n---\n\nTwo\n")).toBe(
      "One\n\n---\n\nTwo\n",
    );
  });

  it("handles CRLF line endings", () => {
    expect(bodyWithoutFrontmatter("---\r\nname: P\r\n---\r\nBody\r\n")).toBe("Body\r\n");
  });

  it("tolerates a leading BOM", () => {
    expect(bodyWithoutFrontmatter("﻿---\nname: P\n---\nBody\n")).toBe("Body\n");
  });

  it("returns an empty string for empty content", () => {
    expect(bodyWithoutFrontmatter("")).toBe("");
  });

  it("keeps a body that is only the block (nothing follows the closing fence)", () => {
    expect(bodyWithoutFrontmatter("---\nname: P\n---\n")).toBe("");
  });
});
