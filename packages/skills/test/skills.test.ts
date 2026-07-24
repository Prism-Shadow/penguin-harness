/**
 * Tests for the Skill library file source of truth and its parser: loadLibrarySkills reading
 * files into a manifest, loadSkillGroups grouping, groupSkills' Other group and missing-member
 * tolerance, librarySkill's traversal-name rejection, doc conventions (`## Before you start` is
 * mandatory), and parseSkillFrontmatter's error tolerance.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  SKILL_GROUPS,
  groupSkills,
  librarySkill,
  loadLibrarySkills,
  loadSkillGroups,
  parseSkillFrontmatter,
  type LibrarySkill,
} from "../src/index.js";

const skillsRoot = path.resolve(import.meta.dirname, "../skills");

/** Minimal LibrarySkill for groupSkills unit tests. */
const fakeSkill = (name: string): LibrarySkill => ({
  name,
  description: `Do ${name}.`,
  version: 1,
  updated: "2026-07-17T00:00:00Z",
  content: `---\nname: ${name}\n---\nBody`,
});

describe("loadLibrarySkills", () => {
  it("loads skills sorted by name with complete metadata (zh and short descriptions)", async () => {
    const skills = loadLibrarySkills();
    const names = skills.map((skill) => skill.name);
    expect(names).toEqual([...names].sort());
    for (const skill of skills) {
      expect(skill.description, skill.name).toBeTruthy();
      // Short description (UI display): both languages present, and clearly shorter than the full description.
      expect(skill.shortDescription, skill.name).toBeTruthy();
      expect(skill.shortDescriptionZh, skill.name).toBeTruthy();
      expect(skill.shortDescription!.length, skill.name).toBeLessThan(skill.description.length);
      expect(skill.shortDescriptionZh!.length, skill.name).toBeLessThan(skill.description.length);
      // version is a natural number, bumped on every content change (updated moves with it).
      expect(Number.isInteger(skill.version), skill.name).toBe(true);
      expect(skill.version, skill.name).toBeGreaterThanOrEqual(1);
      expect(skill.updated).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/);
      // content is the full SKILL.md text including frontmatter (written as-is on install).
      expect(skill.content.startsWith("---\n")).toBe(true);
    }
  });

  it("every skill has a custom icon.svg (read verbatim, line-art style, no scripts)", async () => {
    for (const skill of loadLibrarySkills()) {
      const raw = await fs.readFile(path.join(skillsRoot, skill.name, "icon.svg"), "utf8");
      // The icon field is the raw icon.svg content in the directory (the file is the sole source).
      expect(skill.icon, skill.name).toBe(raw);
      expect(skill.icon, skill.name).toContain('viewBox="0 0 24 24"');
      expect(skill.icon, skill.name).toContain('stroke="currentColor"');
      expect(skill.icon, skill.name).toContain('fill="none"');
      // Security baseline: no scripts or event attributes (frontend also sanitizes before inline rendering).
      expect(skill.icon, skill.name).not.toContain("<script");
      expect(skill.icon, skill.name).not.toMatch(/\son[a-z]+=/i);
    }
  });

  it("name is the directory name, content matches the raw SKILL.md under skills/", async () => {
    const dirs = (await fs.readdir(skillsRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    const skills = loadLibrarySkills();
    expect(skills.map((s) => s.name)).toEqual(dirs);
    for (const skill of skills) {
      const raw = await fs.readFile(path.join(skillsRoot, skill.name, "SKILL.md"), "utf8");
      expect(skill.content).toBe(raw);
      // The library file's own frontmatter name should match its directory name (content quality constraint).
      expect(skill.content).toContain(`name: ${skill.name}`);
    }
  });

  it("every skill body has a `## Before you start` section (ask first if no concrete need)", () => {
    for (const skill of loadLibrarySkills()) {
      expect(skill.content, skill.name).toContain("## Before you start");
    }
  });
});

describe("agent tuning workflow contracts", () => {
  const content = (name: string): string => {
    const skill = librarySkill(name);
    expect(skill, name).toBeDefined();
    return skill!.content;
  };

  it("keeps creation generic and free of downstream evaluation knowledge", () => {
    const creation = content("agent-creation");
    expect(creation).toContain("ordinary tasks");
    expect(creation).toMatch(/Do not\s+install evaluation or optimization Skills/);
    expect(creation).toContain("version: 1");
    expect(creation).toContain("Stop after the requested Agent");
  });

  it("keeps benchmark design capability-focused and freezes comparable results", () => {
    const benchmark = content("benchmark-design");
    expect(benchmark).toContain("individual evaluation and score");
    expect(benchmark).toContain("Fix every Rubric before the first evaluation");
    expect(benchmark).toContain("every Case and Run is valid and complete");
    expect(benchmark).toContain("representative Test Traces");
    expect(benchmark).toContain("per-item scores");
    expect(benchmark).toContain("could reveal private scoring conditions");
    expect(benchmark).toContain("Stop after writing and reporting the baseline");
  });

  it("binds evaluation to the new trace delta and bounded accounting work", () => {
    const evaluation = content("agent-evaluation");
    expect(evaluation).toContain("record the existing files and sizes");
    expect(evaluation).toContain("inspect only new files or files that grew");
    expect(evaluation).toContain("Do not perform open-ended Session archaeology");
    expect(evaluation).toContain("return `cost: null`");
    expect(evaluation).toContain("must not trigger repeated pricing calculations");
  });

  it("keeps score-only optimization versioned, hypothesis-led, and generalizable", () => {
    const optimization = content("agent-optimization");
    expect(optimization).toContain("snapshots/v<version>.tar.gz");
    expect(optimization).toContain("without `.vault.toml`");
    expect(optimization).toContain("complete Case × Run matrix");
    expect(optimization).toContain("one falsifiable behavioral hypothesis");
    expect(optimization).toContain("strictly higher than the Reference");
    expect(optimization).toContain("rules that apply to only one Case");
  });
});

describe("loadSkillGroups / groupSkills", () => {
  it("loads groups per SKILL_GROUPS, members complete with Chinese titles, no Other group", () => {
    const groups = loadSkillGroups();
    expect(groups.map((g) => g.id)).toEqual([
      "office-productivity",
      "software-development",
      "ai-app-development",
      "agent-tuning",
    ]);
    expect(groups[0]!.skills.map((s) => s.name)).toEqual([
      "data-analysis",
      "firecrawl",
      "bento-slides",
    ]);
    expect(groups[0]!.title).toBe("Office Productivity");
    expect(groups[0]!.titleZh).toBe("办公效率");
    expect(groups[1]!.skills.map((s) => s.name)).toEqual(["web-design", "software-engineering"]);
    expect(groups[1]!.title).toBe("Software Development");
    expect(groups[1]!.titleZh).toBe("软件开发");
    expect(groups[2]!.skills.map((s) => s.name)).toEqual([
      "penguin-sdk",
      "penguin-cli",
      "agenthub-models",
      "vllm",
      "ollama",
      "llamafactory",
    ]);
    expect(groups[2]!.title).toBe("AI App Development");
    expect(groups[2]!.titleZh).toBe("AI 应用开发");
    expect(groups[3]!.skills.map((s) => s.name)).toEqual([
      "agent-creation",
      "benchmark-design",
      "agent-evaluation",
      "agent-optimization",
    ]);
    expect(groups[3]!.title).toBe("Agent Tuning");
    expect(groups[3]!.titleZh).toBe("Agent 调优");
    for (const group of groups) {
      expect(group.title).toBeTruthy();
      expect(group.titleZh).toBeTruthy();
      // Groups no longer carry a description (group header is just title + skill count).
      expect("description" in group).toBe(false);
    }
  });

  it("groupSkills: appends an Other group for unlisted skills (Chinese and English titles)", () => {
    const stray = fakeSkill("stray-skill");
    const groups = groupSkills([fakeSkill("agent-creation"), stray]);
    expect(groups.map((g) => g.id)).toEqual([
      "office-productivity",
      "software-development",
      "ai-app-development",
      "agent-tuning",
      "other",
    ]);
    const other = groups[4]!;
    expect(other.title).toBe("Other");
    expect(other.titleZh).toBe("其他");
    expect(other.skills).toEqual([stray]);
  });

  it("groupSkills: missing members are skipped; no Other group when all are grouped", () => {
    const groups = groupSkills([fakeSkill("penguin-cli")]);
    expect(groups.map((g) => g.id)).toEqual([
      "office-productivity",
      "software-development",
      "ai-app-development",
      "agent-tuning",
    ]);
    expect(groups[0]!.skills).toEqual([]);
    expect(groups[1]!.skills).toEqual([]);
    expect(groups[2]!.skills.map((s) => s.name)).toEqual(["penguin-cli"]);
    expect(groups[3]!.skills).toEqual([]);
  });

  it("SKILL_GROUPS hardcodes member names (sole group info source outside library files)", () => {
    expect(SKILL_GROUPS.map((g) => ({ id: g.id, skills: g.skills }))).toEqual([
      { id: "office-productivity", skills: ["data-analysis", "firecrawl", "bento-slides"] },
      { id: "software-development", skills: ["web-design", "software-engineering"] },
      {
        id: "ai-app-development",
        skills: ["penguin-sdk", "penguin-cli", "agenthub-models", "vllm", "ollama", "llamafactory"],
      },
      {
        id: "agent-tuning",
        skills: ["agent-creation", "benchmark-design", "agent-evaluation", "agent-optimization"],
      },
    ]);
  });
});

describe("librarySkill", () => {
  it("reads a single skill by name, returns undefined for unknown names", () => {
    expect(librarySkill("penguin-sdk")?.name).toBe("penguin-sdk");
    expect(librarySkill("no-such-skill")).toBeUndefined();
  });

  it("rejects illegal-character names (path traversal guard) and never hits the filesystem", () => {
    for (const name of ["../penguin-sdk", "..", "penguin-sdk/SKILL.md", "a/../b", ".", ""]) {
      expect(librarySkill(name), name).toBeUndefined();
    }
  });
});

describe("parseSkillFrontmatter", () => {
  it("parses name/description/version/updated, values may contain colons", () => {
    const meta = parseSkillFrontmatter(
      "---\nname: demo\ndescription: How to use x: y and z\nversion: 3\nupdated: 2026-07-16\n---\n\nBody",
    );
    expect(meta).toEqual({
      name: "demo",
      description: "How to use x: y and z",
      version: 3,
      updated: "2026-07-16",
    });
  });

  it("short_description_zh is optional: parsed when present, omitted when absent", () => {
    const withZh = parseSkillFrontmatter(
      "---\nname: demo\ndescription: Do x\nshort_description_zh: 做 x\n---\nBody",
    );
    expect(withZh?.shortDescriptionZh).toBe("做 x");
    const withoutZh = parseSkillFrontmatter("---\nname: demo\ndescription: Do x\n---\nBody");
    expect(withoutZh).not.toBeNull();
    expect(withoutZh && "shortDescriptionZh" in withoutZh).toBe(false);
  });

  it("short_description(_zh) is optional: parsed as shortDescription(Zh), else omitted", () => {
    const withShort = parseSkillFrontmatter(
      "---\nname: demo\ndescription: Do x in detail\nshort_description: Do x\nshort_description_zh: 做 x\n---\nBody",
    );
    expect(withShort?.shortDescription).toBe("Do x");
    expect(withShort?.shortDescriptionZh).toBe("做 x");
    const without = parseSkillFrontmatter("---\nname: demo\ndescription: Do x\n---\nBody");
    expect(without && "shortDescription" in without).toBe(false);
    expect(without && "shortDescriptionZh" in without).toBe(false);
  });

  it("parses UTF-8 BOM and CRLF newlines normally (hand-edited files may introduce them)", () => {
    const bom = parseSkillFrontmatter("\uFEFF---\nname: demo\ndescription: Do x\n---\nBody");
    expect(bom?.name).toBe("demo");
    const crlf = parseSkillFrontmatter("---\r\nname: demo\r\ndescription: Do x\r\n---\r\nBody");
    expect(crlf?.description).toBe("Do x");
  });

  it("returns null when the --- block or name is missing", () => {
    expect(parseSkillFrontmatter("# No frontmatter")).toBeNull();
    expect(parseSkillFrontmatter("---\ndescription: only desc\n---\nBody")).toBeNull();
    // A block that isn't at the start doesn't count as frontmatter either.
    expect(parseSkillFrontmatter("Body\n---\nname: x\n---")).toBeNull();
  });

  it("version falls back to 1 when not a natural number, updated defaults to empty string", () => {
    expect(parseSkillFrontmatter("---\nname: a\nversion: zero\n---")?.version).toBe(1);
    expect(parseSkillFrontmatter("---\nname: a\nversion: 0\n---")?.version).toBe(1);
    expect(parseSkillFrontmatter("---\nname: a\n---")).toEqual({
      name: "a",
      description: "",
      version: 1,
      updated: "",
    });
  });
});
