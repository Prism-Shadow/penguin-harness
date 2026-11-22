import path from "node:path";
import { validateSkillDir } from "@prismshadow/skills";
import { describe, expect, it } from "vitest";

describe("the shipped Skill", () => {
  it("parses as a Skill an Agent can install", async () => {
    expect(
      await validateSkillDir(path.join(import.meta.dirname, "../skills/multimodal-tools")),
    ).toEqual([]);
  });
});
