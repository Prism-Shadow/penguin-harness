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
  it("按 name 排序读出技能，metadata 齐全（含中文描述与短描述）", async () => {
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
      // Pre-release, version is always 1.
      expect(skill.version).toBe(1);
      expect(skill.updated).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/);
      // content is the full SKILL.md text including frontmatter (written as-is on install).
      expect(skill.content.startsWith("---\n")).toBe(true);
    }
  });

  it("每个技能都带定制 icon.svg（原文读入，站内线稿风，无脚本）", async () => {
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

  it("name 以目录名为准，content 与 skills/ 下 SKILL.md 原文一致", async () => {
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

  it("每个技能正文都有 `## Before you start` 一节（无具体需求时先反问）", () => {
    for (const skill of loadLibrarySkills()) {
      expect(skill.content, skill.name).toContain("## Before you start");
    }
  });
});

describe("loadSkillGroups / groupSkills", () => {
  it("按 Skill 组清单解组，成员齐全且带中文组名，无 Other 组", () => {
    const groups = loadSkillGroups();
    expect(groups.map((g) => g.id)).toEqual([
      "agent-development",
      "data-analysis",
      "penguin-development",
      "web-development",
      "software-engineering",
    ]);
    expect(groups[0]!.skills.map((s) => s.name)).toEqual([
      "agent-creation",
      "benchmark-design",
      "agent-evaluation",
      "agent-optimization",
    ]);
    expect(groups[1]!.skills.map((s) => s.name)).toEqual(["data-analysis"]);
    expect(groups[1]!.title).toBe("Data Analysis");
    expect(groups[1]!.titleZh).toBe("数据分析");
    expect(groups[2]!.skills.map((s) => s.name)).toEqual([
      "penguin-sdk",
      "penguin-cli",
      "agenthub-models",
    ]);
    expect(groups[3]!.skills.map((s) => s.name)).toEqual(["web-design"]);
    expect(groups[3]!.title).toBe("Web Development");
    expect(groups[3]!.titleZh).toBe("网页开发");
    expect(groups[4]!.skills.map((s) => s.name)).toEqual(["software-engineering"]);
    expect(groups[4]!.title).toBe("Software Engineering");
    expect(groups[4]!.titleZh).toBe("软件工程");
    for (const group of groups) {
      expect(group.title).toBeTruthy();
      expect(group.titleZh).toBeTruthy();
      // Groups no longer carry a description (group header is just title + skill count).
      expect("description" in group).toBe(false);
    }
  });

  it("groupSkills：未列入任何组的技能追加 Other 组（含中英文组名）", () => {
    const stray = fakeSkill("stray-skill");
    const groups = groupSkills([fakeSkill("agent-creation"), stray]);
    expect(groups.map((g) => g.id)).toEqual([
      "agent-development",
      "data-analysis",
      "penguin-development",
      "web-development",
      "software-engineering",
      "other",
    ]);
    const other = groups[5]!;
    expect(other.title).toBe("Other");
    expect(other.titleZh).toBe("其他");
    expect(other.skills).toEqual([stray]);
  });

  it("groupSkills：成员名缺失则跳过；全部入组时不出现 Other 组", () => {
    const groups = groupSkills([fakeSkill("penguin-cli")]);
    expect(groups.map((g) => g.id)).toEqual([
      "agent-development",
      "data-analysis",
      "penguin-development",
      "web-development",
      "software-engineering",
    ]);
    expect(groups[0]!.skills).toEqual([]);
    expect(groups[1]!.skills).toEqual([]);
    expect(groups[2]!.skills.map((s) => s.name)).toEqual(["penguin-cli"]);
    expect(groups[3]!.skills).toEqual([]);
    expect(groups[4]!.skills).toEqual([]);
  });

  it("SKILL_GROUPS 清单硬编码为成员名（库文件之外唯一的组信息真源）", () => {
    expect(SKILL_GROUPS.map((g) => ({ id: g.id, skills: g.skills }))).toEqual([
      {
        id: "agent-development",
        skills: ["agent-creation", "benchmark-design", "agent-evaluation", "agent-optimization"],
      },
      { id: "data-analysis", skills: ["data-analysis"] },
      { id: "penguin-development", skills: ["penguin-sdk", "penguin-cli", "agenthub-models"] },
      { id: "web-development", skills: ["web-design"] },
      { id: "software-engineering", skills: ["software-engineering"] },
    ]);
  });
});

describe("librarySkill", () => {
  it("按名称读单个技能，未知名称返回 undefined", () => {
    expect(librarySkill("penguin-sdk")?.name).toBe("penguin-sdk");
    expect(librarySkill("no-such-skill")).toBeUndefined();
  });

  it("非法字符名一律拒绝（防路径穿越），不触达文件系统", () => {
    for (const name of ["../penguin-sdk", "..", "penguin-sdk/SKILL.md", "a/../b", ".", ""]) {
      expect(librarySkill(name), name).toBeUndefined();
    }
  });
});

describe("parseSkillFrontmatter", () => {
  it("解析 name/description/version/updated，值允许含冒号", () => {
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

  it("short_description_zh 可选：有则解析，缺省不带该字段", () => {
    const withZh = parseSkillFrontmatter(
      "---\nname: demo\ndescription: Do x\nshort_description_zh: 做 x\n---\nBody",
    );
    expect(withZh?.shortDescriptionZh).toBe("做 x");
    const withoutZh = parseSkillFrontmatter("---\nname: demo\ndescription: Do x\n---\nBody");
    expect(withoutZh).not.toBeNull();
    expect(withoutZh && "shortDescriptionZh" in withoutZh).toBe(false);
  });

  it("short_description(_zh) 可选：有则解析为 shortDescription(Zh)，缺省不带该字段", () => {
    const withShort = parseSkillFrontmatter(
      "---\nname: demo\ndescription: Do x in detail\nshort_description: Do x\nshort_description_zh: 做 x\n---\nBody",
    );
    expect(withShort?.shortDescription).toBe("Do x");
    expect(withShort?.shortDescriptionZh).toBe("做 x");
    const without = parseSkillFrontmatter("---\nname: demo\ndescription: Do x\n---\nBody");
    expect(without && "shortDescription" in without).toBe(false);
    expect(without && "shortDescriptionZh" in without).toBe(false);
  });

  it("UTF-8 BOM 与 CRLF 换行照常解析（手改文件的编辑器可能引入）", () => {
    const bom = parseSkillFrontmatter("\uFEFF---\nname: demo\ndescription: Do x\n---\nBody");
    expect(bom?.name).toBe("demo");
    const crlf = parseSkillFrontmatter("---\r\nname: demo\r\ndescription: Do x\r\n---\r\nBody");
    expect(crlf?.description).toBe("Do x");
  });

  it("缺 --- 块或缺 name 返回 null", () => {
    expect(parseSkillFrontmatter("# No frontmatter")).toBeNull();
    expect(parseSkillFrontmatter("---\ndescription: only desc\n---\nBody")).toBeNull();
    // A block that isn't at the start doesn't count as frontmatter either.
    expect(parseSkillFrontmatter("Body\n---\nname: x\n---")).toBeNull();
  });

  it("version 非自然数回退 1，updated 缺省空串", () => {
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
