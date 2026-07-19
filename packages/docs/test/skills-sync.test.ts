/**
 * Docs ↔ skill-library sync: the Skills doc pages must mention every Skill that
 * actually ships in packages/skills (the library directory is the source of truth —
 * the same files loadLibrarySkills() reads). Derived, not hardcoded, so adding a
 * Skill without documenting it fails here instead of silently drifting.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const skillsRoot = join(__dirname, "..", "..", "skills", "skills");
const contentDir = join(__dirname, "..", "content");

const librarySkills = readdirSync(skillsRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(skillsRoot, entry.name, "SKILL.md")))
  .map((entry) => entry.name)
  .sort();

describe("docs ↔ skill library sync", () => {
  it("found the skill library", () => {
    expect(librarySkills.length).toBeGreaterThan(0);
  });

  for (const lang of ["zh", "en"] as const) {
    it(`skills.${lang}.md mentions every library Skill`, () => {
      const page = readFileSync(join(contentDir, `skills.${lang}.md`), "utf8");
      const missing = librarySkills.filter((name) => !page.includes(`\`${name}\``));
      expect(missing, `undocumented skills in skills.${lang}.md`).toEqual([]);
    });
  }
});
