/**
 * Tests for the Skill library file source of truth and its parser: loadLibrarySkills reading
 * files into a manifest (including auxiliary files a SKILL.md references), loadPreinstalledSkills'
 * preinstall filter, loadSkillGroups grouping, groupSkills' Other group and missing-member
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
  loadPreinstalledSkills,
  loadSkillGroups,
  parseSkillFrontmatter,
  type LibrarySkill,
  type SkillGroupInfo,
} from "../src/index.js";

const skillsRoot = path.resolve(import.meta.dirname, "../skills");

/**
 * READMEs carrying the group table, relative to this directory, each with the heading its
 * rows spell the groups by — the English files take the manifest's `title`, the Chinese one
 * its `titleZh`.
 */
const README_TABLES = [
  { label: "packages/skills/README.md", file: "../README.md", heading: groupTitle },
  { label: "README.md", file: "../../../README.md", heading: groupTitle },
  { label: "README.zh.md", file: "../../../README.zh.md", heading: groupTitleZh },
];

function groupTitle(group: SkillGroupInfo): string {
  return group.title;
}

function groupTitleZh(group: SkillGroupInfo): string {
  // titleZh is optional on the manifest; a group without one is displayed under its English title.
  return group.titleZh ?? group.title;
}

/** One row of a README's group table: the group as the row spells it, and its Skill names. */
interface ReadmeGroupRow {
  group: string;
  skills: string[];
}

/**
 * Rows of a README's group table. Located by the table's own `Group` / `分组` header row
 * rather than by a surrounding heading, so the three files parse the same way despite
 * different headings and list separators; rows end at the first line that is not a table row.
 */
function readmeTableRows(markdown: string): ReadmeGroupRow[] {
  const lines = markdown.split("\n");
  const header = lines.findIndex((line) => /^\|\s*(?:Group|分组)\s*\|/.test(line));
  if (header === -1) return [];
  const rows: ReadmeGroupRow[] = [];
  for (const line of lines.slice(header + 1)) {
    if (!line.startsWith("|")) break;
    const cells = line.split("|").slice(1, -1);
    if (cells.length < 2) continue;
    const group = cells[0]!.trim();
    // The alignment row between the header and the first group.
    if (/^:?-{3,}:?$/.test(group)) continue;
    rows.push({
      group,
      skills: [...cells[1]!.matchAll(/`([^`]+)`/g)].map((match) => match[1]!),
    });
  }
  return rows;
}

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

  it("collects auxiliary files a SKILL.md references (reference/*), excluding SKILL.md and icon.svg", async () => {
    // remote-claude-code is a multi-file skill: its SKILL.md links to a reference/ document.
    const skill = librarySkill("remote-claude-code")!;
    const aux = "reference/persistent-session.md";
    expect(skill.files, "remote-claude-code carries files").toBeDefined();
    expect(Object.keys(skill.files!)).toContain(aux);
    // Read verbatim from disk, and the SKILL.md really links to it.
    expect(skill.files![aux]).toBe(
      await fs.readFile(path.join(skillsRoot, skill.name, aux), "utf8"),
    );
    expect(skill.content).toContain(aux);
    // SKILL.md and icon.svg are carried by their own fields, never duplicated into files.
    for (const key of Object.keys(skill.files!)) {
      expect(key).not.toBe("SKILL.md");
      expect(key).not.toBe("icon.svg");
    }
    // A skill that ships only SKILL.md + icon.svg omits the field entirely.
    expect("files" in librarySkill("firecrawl")!).toBe(false);
  });
});

describe("loadPreinstalledSkills", () => {
  it("excludes skills whose frontmatter sets preinstall: false and keeps everything else", () => {
    const all = loadLibrarySkills();
    const preinstalled = loadPreinstalledSkills().map((s) => s.name);
    expect(preinstalled).toEqual(all.filter((s) => s.preinstall !== false).map((s) => s.name));
    // remote-claude-code and humanizer are the library's manual-install skills: in the library, not preinstalled.
    for (const name of ["remote-claude-code", "humanizer"]) {
      expect(
        all.map((s) => s.name),
        name,
      ).toContain(name);
      expect(librarySkill(name)?.preinstall, name).toBe(false);
      expect(preinstalled, name).not.toContain(name);
    }
    expect(preinstalled.length).toBeGreaterThan(0);
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
      "humanizer",
    ]);
    expect(groups[0]!.title).toBe("Office Productivity");
    expect(groups[0]!.titleZh).toBe("办公效率");
    expect(groups[1]!.skills.map((s) => s.name)).toEqual([
      "web-design",
      "software-engineering",
      "remote-claude-code",
    ]);
    expect(groups[1]!.title).toBe("Software Development");
    expect(groups[1]!.titleZh).toBe("软件开发");
    expect(groups[2]!.skills.map((s) => s.name)).toEqual([
      "penguin-sdk",
      "penguin-cli",
      "penguin-orchestration",
      "agenthub-models",
      "vllm",
      "ollama",
      "llamafactory",
      "skill-porting",
    ]);
    expect(groups[2]!.title).toBe("AI App Development");
    expect(groups[2]!.titleZh).toBe("AI 应用开发");
    expect(groups[3]!.skills.map((s) => s.name)).toEqual([
      "agent-initialization",
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
    const groups = groupSkills([fakeSkill("agent-initialization"), stray]);
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
      {
        id: "office-productivity",
        skills: ["data-analysis", "firecrawl", "bento-slides", "humanizer"],
      },
      {
        id: "software-development",
        skills: ["web-design", "software-engineering", "remote-claude-code"],
      },
      {
        id: "ai-app-development",
        skills: [
          "penguin-sdk",
          "penguin-cli",
          "penguin-orchestration",
          "agenthub-models",
          "vllm",
          "ollama",
          "llamafactory",
          "skill-porting",
        ],
      },
      {
        id: "agent-tuning",
        skills: [
          "agent-initialization",
          "benchmark-design",
          "agent-evaluation",
          "agent-optimization",
        ],
      },
    ]);
  });

  /**
   * This package's README and the repository's two root READMEs each repeat the manifest as a
   * table for human readers, and nothing else reads those tables. Derived from the library and
   * from SKILL_GROUPS rather than pinned, so adding a Skill — or filing it under the wrong
   * heading — fails here instead of leaving a table quietly wrong; the same guard the docs pages
   * get from docs' skills-sync test. The root READMEs are checked from here because this package
   * owns the library the tables claim to list; they belong to no package of their own.
   */
  for (const { label, file, heading } of README_TABLES) {
    it(`${label}'s group table names exactly the library's Skills, each under its own group`, async () => {
      const markdown = await fs.readFile(path.resolve(import.meta.dirname, file), "utf8");
      const rows = readmeTableRows(markdown);
      const listed = rows.flatMap((row) => row.skills);
      expect(listed.length, `no Group/分组 table found in ${label}`).toBeGreaterThan(0);
      const library = loadLibrarySkills().map((skill) => skill.name);
      expect(
        library.filter((name) => !listed.includes(name)),
        `Skills that ship but are missing from ${label}`,
      ).toEqual([]);
      expect(
        listed.filter((name) => !library.includes(name)).sort(),
        `Skills listed in ${label} that no longer ship`,
      ).toEqual([]);

      // Which group a Skill sits in is the manifest's call, and a table that lists every Skill
      // under the wrong heading is as wrong as one that omits it. Compared as a set per group,
      // so reordering inside a row stays free; row order is free too, since rows are matched by
      // their heading rather than by position.
      expect(rows.map((row) => row.group).sort(), `group headings in ${label}`).toEqual(
        SKILL_GROUPS.map(heading).sort(),
      );
      for (const group of SKILL_GROUPS) {
        const row = rows.find((entry) => entry.group === heading(group));
        expect(
          [...(row?.skills ?? [])].sort(),
          `Skills under "${heading(group)}" in ${label}`,
        ).toEqual([...group.skills].sort());
      }
    });
  }
});

describe("librarySkill", () => {
  it("reads a single skill by name, returns undefined for unknown names", () => {
    expect(librarySkill("penguin-sdk")?.name).toBe("penguin-sdk");
    expect(librarySkill("no-such-skill")).toBeUndefined();
  });

  /**
   * The agent-tuning skills tell an agent what to type: shell statements, CLI flags and
   * the YAML shape an Evaluator must emit. Those literals are a contract — a typo in one
   * breaks a run — so they are pinned here. The prose around them is not: it is edited
   * every time a skill is reworded, and pinning sentences only made the suite fail on
   * rewrites that changed nothing an agent executes.
   */
  it("agent-evaluation spells the launch environment out as separate shell statements", () => {
    const evaluation = librarySkill("agent-evaluation")!.content;

    expect(evaluation).toContain('PROJECT_ID="$(basename "$PROJECT_DIR")"');
    expect(evaluation).toContain('PENGUIN_HOME="$(dirname "$PROJECT_DIR")"');
    expect(evaluation).toContain("export PENGUIN_HOME");
    expect(evaluation).toContain('--project-id "$PROJECT_ID"');
    expect(evaluation).toContain('--workspace "<absolute_unique_workspace_path>"');
    // The assignment is its own statement: prefixed onto `penguin run` it would apply to
    // that one command and leave the rest of the sequence pointing at the wrong home.
    expect(evaluation).not.toContain('PENGUIN_HOME="$(dirname "$PROJECT_DIR")" penguin run');
  });

  it("the Evaluator protocol YAML keeps its block scalars and carries no max_score", () => {
    for (const name of ["benchmark-design", "agent-optimization"]) {
      const content = librarySkill(name)!.content;
      expect(content, name).toMatch(/summary_title:\s*>-\n\s+<public title>/);
      expect(content, name).toMatch(/summary:\s*>-\n\s+<public summary>/);
      // Every Case Rubric is fixed at 100 points, so a per-Case maximum would be a second
      // source of truth for the same number.
      expect(content, name).not.toMatch(/\n\s+max_score:/);
    }
  });

  it("benchmark-design refines before it freezes the Formal Baseline", () => {
    const content = librarySkill("benchmark-design")!.content;
    const refineIndex = content.indexOf("## Refine the Benchmark");
    const baselineIndex = content.indexOf("## Freeze and record the Formal Baseline");

    expect(refineIndex).toBeGreaterThan(-1);
    expect(baselineIndex).toBeGreaterThan(refineIndex);
  });

  it("remote-claude-code drives tmux through the commands it names", () => {
    // Issue #307: relaying verbatim survives the transport only through the paste buffer —
    // `send-keys -l` splits newlines and eats a trailing `;`.
    const content = librarySkill("remote-claude-code")!.content;

    expect(content).toContain("tmux load-buffer -");
    expect(content).toContain("tmux paste-buffer -d -p -t <sess>");
    expect(content).toContain("tmux has-session -t <sess>");
    expect(content).toContain("capture-pane -p -S -200");
    expect(content).toContain("claude --continue");
  });

  it("remote-claude-code states the keystroke rule before the relay contract that leans on it", () => {
    const content = librarySkill("remote-claude-code")!.content;
    const stepIndex = content.indexOf("### 3.3 One keystroke at a time");
    const relayIndex = content.indexOf("## 4. Relaying a conversation");

    expect(stepIndex).toBeGreaterThan(-1);
    expect(relayIndex).toBeGreaterThan(stepIndex);
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

  it("preinstall is recognized only as the literal false; other values or absence omit the field", () => {
    const off = parseSkillFrontmatter("---\nname: demo\npreinstall: false\n---\nBody");
    expect(off?.preinstall).toBe(false);
    for (const value of ["true", "no", "0", "False"]) {
      const meta = parseSkillFrontmatter(`---\nname: demo\npreinstall: ${value}\n---\nBody`);
      expect(meta && "preinstall" in meta, value).toBe(false);
    }
    const absent = parseSkillFrontmatter("---\nname: demo\n---\nBody");
    expect(absent && "preinstall" in absent).toBe(false);
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
