/**
 * skill-use.ts unit test: the feature module re-exports the `[use_skills]` marker producer
 * and parser from core's marker module — the block's own semantics (both forms, anchoring,
 * legacy compat) are covered by packages/core/test/markers.test.ts. What matters here is
 * that the wiring is intact for the components importing them from this module.
 */
import { describe, expect, it } from "vitest";
import { buildSkillsMessage, parseSkillsMessage } from "../src/features/chat/skill-use";

describe("skill-use re-exports the core [use_skills] marker helpers", () => {
  it("builds the square-bracket block and parses it back (round-trip through the feature module)", () => {
    const text = buildSkillsMessage(["agent-initialization", "penguin-cli"], "use them\nline2");
    expect(text.startsWith("[use_skills]\n")).toBe(true);
    expect(parseSkillsMessage(text)).toEqual({
      skills: ["agent-initialization", "penguin-cli"],
      rest: "use them\nline2",
    });
  });

  it("an empty selection leaves the body untouched; a non-block message does not parse", () => {
    expect(buildSkillsMessage([], "hello")).toBe("hello");
    expect(parseSkillsMessage("plain text mentioning [use_skills] only")).toBeNull();
  });
});
