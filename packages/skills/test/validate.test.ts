import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { validateSkillDir } from "../src/index.js";

const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "prismshadow-skills-"));
afterAll(() => fs.rm(scratch, { recursive: true, force: true }));

/** A skill directory named `name` whose SKILL.md is `content` (none when null). */
async function skill(name: string, content: string | null): Promise<string> {
  const dir = path.join(scratch, name);
  await fs.mkdir(dir, { recursive: true });
  if (content !== null) await fs.writeFile(path.join(dir, "SKILL.md"), content);
  return dir;
}

describe("validateSkillDir", () => {
  it("passes a skill whose SKILL.md parses", async () => {
    const dir = await skill(
      "valid",
      '---\nname: valid\ndescription: "Use when: checking a skill."\nmetadata:\n  version: "1"\n---\n\n# Body\n',
    );
    expect(await validateSkillDir(dir)).toEqual([]);
  });

  it("reports invalid YAML", async () => {
    const dir = await skill(
      "bad-yaml",
      "---\nname: bad-yaml\ndescription: Use when: it breaks\n---\n",
    );
    const violations = await validateSkillDir(dir);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatch(/^bad-yaml\/SKILL\.md: YAML parse error: /);
  });

  it("reports a missing name or description", async () => {
    expect(await validateSkillDir(await skill("no-name", "---\ndescription: d\n---\n"))).toEqual([
      "no-name/SKILL.md: missing required frontmatter field(s): name",
    ]);
    expect(await validateSkillDir(await skill("no-desc", "---\nname: no-desc\n---\n"))).toEqual([
      "no-desc/SKILL.md: missing required frontmatter field(s): description",
    ]);
  });

  it("reports a name that is not a string", async () => {
    expect(
      await validateSkillDir(await skill("numeric", "---\nname: 42\ndescription: d\n---\n")),
    ).toEqual([
      'numeric/SKILL.md: frontmatter "name" and "description" must be strings (got number and string)',
    ]);
  });

  it("reports a missing SKILL.md", async () => {
    const violations = await validateSkillDir(await skill("empty", null));
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatch(/^empty\/SKILL\.md: failed to read file: ENOENT/);
  });
});
