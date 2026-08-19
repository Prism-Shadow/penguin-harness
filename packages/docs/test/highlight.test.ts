/**
 * The highlighter falls back to plain text on any failure, so a broken grammar registration
 * costs nothing visible — every page still renders, just never highlighted. These check the
 * on-demand path end to end instead.
 */
import { describe, expect, it } from "vitest";
import { highlight, isHighlightable } from "../src/lib/highlight";

describe("code highlighting", () => {
  it("registers a grammar on demand and highlights with both themes baked in", async () => {
    const html = await highlight("sudo xattr -rd com.apple.quarantine /Applications", "bash");

    expect(html).toContain("<span");
    expect(html).toContain("--shiki-dark");
  });

  it("registers a second grammar without disturbing the first", async () => {
    expect(await highlight("const port: number = 7376;", "ts")).toContain("<span");
    expect(await highlight("penguin web", "shell")).toContain("<span");
  });

  it("leaves a language with no grammar unhighlighted", async () => {
    expect(isHighlightable("cobol")).toBe(false);
    expect(await highlight("IDENTIFICATION DIVISION.", "cobol")).toBeNull();
  });
});
