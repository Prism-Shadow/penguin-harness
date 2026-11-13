import { readdirSync } from "node:fs";
import path from "node:path";
import { validateSkillDir } from "@prismshadow/skills";
import { describe, expect, it } from "vitest";

const skills = path.join(import.meta.dirname, "../skills");

describe("every shipped SKILL.md parses", () => {
  for (const name of readdirSync(skills)) {
    it(name, async () => {
      expect(await validateSkillDir(path.join(skills, name))).toEqual([]);
    });
  }
});
