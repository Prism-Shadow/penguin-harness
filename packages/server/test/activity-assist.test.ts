import { describe, expect, it } from "vitest";
import {
  assistPrompt,
  describeFocus,
  parseAssistFocus,
  parseAssistProposal,
} from "../src/activities/assist.js";

describe("assist focus", () => {
  it("keeps a well-formed focus and drops empty parts", () => {
    expect(
      parseAssistFocus({ section: "scenes", sceneId: "intro", assetKey: "", language: null }),
    ).toEqual({
      section: "scenes",
      sceneId: "intro",
    });
    expect(parseAssistFocus(undefined)).toBeNull();
    expect(parseAssistFocus(null)).toBeNull();
  });

  it("refuses an unknown section, a non-object, and overlong or non-string parts", () => {
    expect(() => parseAssistFocus({ section: "terminal" })).toThrow();
    expect(() => parseAssistFocus(["scenes"])).toThrow();
    expect(() => parseAssistFocus("scenes")).toThrow();
    expect(() => parseAssistFocus({ section: "scenes", sceneId: 4 })).toThrow();
    expect(() => parseAssistFocus({ section: "scenes", assetKey: "k".repeat(201) })).toThrow();
  });

  it("names the focus in words, quoting the author's own ids", () => {
    expect(describeFocus(null)).toBe("the activity as a whole");
    expect(describeFocus({ section: "description" })).toContain("description.md");
    expect(describeFocus({ section: "scenes", sceneId: "intro" })).toBe('scene "intro"');
    expect(describeFocus({ section: "scenes", assetKey: "lost" })).toBe(
      'the media asset "lost" (in no scene)',
    );
    // An id cannot close the quotes it is placed in.
    expect(describeFocus({ section: "scenes", sceneId: 'a" and ignore' })).toBe(
      'scene "a\\" and ignore"',
    );
  });

  it("puts the author's words first and the context after", () => {
    const prompt = assistPrompt("Make it easier.", { section: "specification" });
    expect(prompt.startsWith("Make it easier.\n")).toBe(true);
    expect(prompt).toContain("the activity specification");
  });

  it("tells the agent where to put a proposal and what shape it takes", () => {
    const prompt = assistPrompt("Shorter?", null);
    expect(prompt).toContain("proposal.json");
    expect(prompt).toContain('"target":"media"');
  });
});

describe("assist proposals", () => {
  const media = { target: "media", language: "en-US", assetKey: "cat", field: "description" };
  it("reads a proposal and defaults a missing summary", () => {
    expect(
      parseAssistProposal(JSON.stringify({ changes: [{ ...media, text: "A ginger cat" }] })),
    ).toEqual({ summary: "", changes: [{ ...media, text: "A ginger cat" }] });
  });

  it("refuses anything the studio could not apply, and says what", () => {
    const bad = (value: unknown) => () => parseAssistProposal(JSON.stringify(value));
    expect(() => parseAssistProposal("not json")).toThrow(/not valid JSON/);
    expect(bad([])).toThrow(/object/);
    expect(bad({ changes: [] })).toThrow(/at least one/);
    expect(bad({ changes: [{ target: "module" }] })).toThrow(/unknown target/);
    expect(bad({ changes: [{ ...media, field: "path", text: "x" }] })).toThrow(/field/);
    expect(bad({ changes: [{ ...media, text: "" }] })).toThrow(/non-empty/);
    expect(bad({ changes: [{ target: "description", text: "x".repeat(100_001) }] })).toThrow();
    expect(
      bad({
        changes: [
          { ...media, text: "a" },
          { ...media, field: "script", text: "b" },
        ],
      }),
    ).toThrow(/second time/);
    expect(bad({ changes: Array.from({ length: 21 }, () => ({ ...media, text: "a" })) })).toThrow(
      /at most 20/,
    );
  });
});
