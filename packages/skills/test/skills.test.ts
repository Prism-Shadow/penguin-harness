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
      "agenthub-models",
      "vllm",
      "ollama",
      "llamafactory",
      "skill-porting",
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
          "agenthub-models",
          "vllm",
          "ollama",
          "llamafactory",
          "skill-porting",
        ],
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

  it("benchmark-design records the selected one-Run Pilot as the Formal Baseline", () => {
    const content = librarySkill("benchmark-design")?.content;
    expect(content).toBeDefined();

    const pilotIndex = content!.indexOf("## Refine the Benchmark");
    const baselineIndex = content!.indexOf("## Freeze and record the Formal Baseline");
    const normalizedContent = content!.replace(/\s+/g, " ");

    expect(pilotIndex).toBeGreaterThan(-1);
    expect(baselineIndex).toBeGreaterThan(pilotIndex);
    expect(normalizedContent).toContain("Keep unselected Pilot results out of the Scoreboard");
    expect(normalizedContent).toContain("requested valid-iteration limit");
    expect(normalizedContent).toContain("lowest-scoring valid Pilot revision");
    expect(normalizedContent).toContain("retain only one temporary restorable copy");
    expect(normalizedContent).toContain("Store it outside `benchmarks/`");
    expect(normalizedContent).toContain("delete the temporary lowest-revision copy");
    expect(normalizedContent).toContain("A single iteration may refine multiple Cases");
    expect(normalizedContent).toContain(
      "do not require the public Statement to uniquely determine the Gold",
    );
    expect(normalizedContent).toContain("stable reusable policy, priority, inference boundary");
    expect(normalizedContent).toContain(
      "do not disclose every decisive premise or priority merely to make the public task complete",
    );
    expect(normalizedContent).toContain(
      "Allocate most points within each Case to decisions or concise artifacts",
    );
    expect(normalizedContent).toContain(
      "Keep generic format compliance, evidence enumeration, and analysis completeness from creating a high score floor",
    );
    expect(normalizedContent).toContain(
      "Before the first dispatch of every new or changed Case revision",
    );
    expect(normalizedContent).toContain("current Statement is internally coherent");
    expect(normalizedContent).toContain("current Rubric is consistent with the current Statement");
    expect(normalizedContent).toContain("must not refer to an earlier revision or missing context");
    expect(normalizedContent).toContain(
      "every scoring item applies to the Case's actual requested output",
    );
    expect(normalizedContent).toContain(
      "does not require the public Statement to contain enough information",
    );
    expect(normalizedContent).toContain(
      "Prefer refinements that create one or more scored separating decisions",
    );
    expect(normalizedContent).toContain(
      "Adding another explicit rule, exception, source, or checklist is not a difficulty increase",
    );
    expect(normalizedContent).toContain("Separating prediction");
    expect(normalizedContent).toContain(
      "If both behaviors are expected to reach the same scored result, choose another refinement",
    );
    expect(normalizedContent).toContain("A Rubric-only refinement is allowed but not preferred");
    expect(normalizedContent).toContain(
      "Do not add points merely because the previous Test Agent omitted a phrase",
    );
    expect(normalizedContent).toContain(
      "Run a complete consistency review and final leak check across every Case",
    );
    expect(normalizedContent).toContain(
      "Do not run another difficulty refinement merely to create more score margin",
    );
    expect(normalizedContent).toContain("missing the desired score alone is not a failure");
    expect(normalizedContent).toContain("`runs = 1`");
    expect(normalizedContent).toContain(
      "Do not launch a fresh Formal matrix, rerun the selected Pilot, or backfill it",
    );
    expect(normalizedContent).toContain("Accept the selected Pilot result as the Formal Baseline");
    expect(normalizedContent).toContain(
      "Record the Formal Baseline even when its score does not meet the desired baseline score",
    );
  });

  it("evaluation is the only subagent leaf and optimization has a bounded valid-round loop", () => {
    const creation = librarySkill("agent-creation")!.content.replace(/\s+/g, " ");
    const evaluation = librarySkill("agent-evaluation")!.content.replace(/\s+/g, " ");
    const benchmarkDesignRaw = librarySkill("benchmark-design")!.content;
    const benchmarkDesign = benchmarkDesignRaw.replace(/\s+/g, " ");
    const optimizationRaw = librarySkill("agent-optimization")!.content;
    const optimization = optimizationRaw.replace(/\s+/g, " ");

    expect(creation).toContain("inherit the current Builder Session's `Provider` and `Model ID`");
    expect(creation).toContain(
      "read `model.thinking_level` from the Builder's own `agent_state/system_config.yaml`",
    );
    expect(creation).toContain("Write the resolved `thinking_level` into a brand-new target Agent");
    expect(creation).toContain("never add either field to `system_config.yaml`");
    expect(evaluation).toContain("request from a `run_subagent` caller");
    expect(evaluation).toContain("Use the Penguin CLI only to launch the specified Test Agent");
    expect(evaluation).toContain('PROJECT_ID="$(basename "$PROJECT_DIR")"');
    expect(evaluation).toContain('PENGUIN_HOME="$(dirname "$PROJECT_DIR")"');
    expect(evaluation).toContain("export PENGUIN_HOME");
    expect(evaluation).toContain('--project-id "$PROJECT_ID"');
    expect(evaluation).toContain("Perform these as separate shell statements in this order");
    expect(evaluation).toContain("Never compress the assignments onto one command line");
    expect(evaluation).toContain("Do not impose a numeric retry limit");
    expect(evaluation).toContain("Never browse, query a pricing service");
    expect(evaluation).toContain("resend only the clean protocol YAML");
    expect(evaluation).toContain('--workspace "<absolute_unique_workspace_path>"');
    expect(evaluation).toContain("resolve it to an absolute canonical path");
    expect(evaluation).toContain("`provider` and `model_id` must both be non-empty");
    expect(evaluation).toContain("Never omit either model flag");
    expect(evaluation).toContain(
      "Read and snapshot `model.thinking_level` from this Target Agent config",
    );
    expect(evaluation).toContain("not Trace metadata—for `thinking_level`");
    expect(evaluation).toContain("outside `0..100`");
    expect(evaluation).not.toContain('PENGUIN_HOME="$(dirname "$PROJECT_DIR")" penguin run');
    expect(benchmarkDesign).toContain(
      "otherwise inherit the current Builder Session's complete `Provider` and `Model ID`",
    );
    expect(benchmarkDesign).toContain(
      "Read `thinking_level` from the Test Agent's `model.thinking_level`",
    );
    expect(benchmarkDesign).toContain(
      "Pass the resolved `(provider, model_id)` explicitly in every Pilot Evaluator request",
    );
    expect(benchmarkDesign).toContain("Every Case Rubric has a fixed maximum of 100 points");
    expect(benchmarkDesign).toContain("average of the Case scores");
    expect(benchmarkDesign).toContain("ignore `null` values when averaging cost");
    expect(benchmarkDesign).toContain("stored values are authoritative");
    expect(benchmarkDesign).toContain("obtain the current UTC timestamp from the environment");
    expect(benchmarkDesignRaw).toMatch(/summary_title:\s*>-\n\s+<public title>/);
    expect(benchmarkDesignRaw).toMatch(/summary:\s*>-\n\s+<public summary>/);
    expect(benchmarkDesign).toContain(
      "parse the complete `scoreboard.yaml` and verify the appended Evaluation",
    );
    expect(benchmarkDesignRaw).not.toMatch(/\n\s+max_score:/);
    expect(benchmarkDesign).toContain(
      "Before reading `status`, `score`, or any other protocol field",
    );
    expect(benchmarkDesign).toContain("Ask the same Evaluator to resend only the clean YAML");
    expect(optimization).toContain("Delegate every evaluation to an `agent-evaluation` subagent");
    expect(optimization).toContain("a positive `runs` value");
    expect(optimization).toContain(
      "do not infer it from `benchmark_config.toml` or the Formal Baseline",
    );
    expect(optimization).toContain(
      "The initial Formal Baseline has one Run per Case; do not rerun or backfill it",
    );
    expect(optimization).toContain(
      "Compare each Candidate's stored top-level average directly with the current Reference score even when their Run counts differ",
    );
    expect(optimization).toContain("frozen Case set × requested `runs` matrix");
    expect(optimization).toContain("Before reading `status`, `score`, or any other protocol field");
    expect(optimization).toContain("Ask the same Evaluator to resend only the clean YAML");
    expect(optimizationRaw).toMatch(/summary_title:\s*>-\n\s+<public title>/);
    expect(optimizationRaw).toMatch(/summary:\s*>-\n\s+<public summary>/);
    expect(optimization).toContain(
      "parse the complete `scoreboard.yaml` and verify the appended Evaluation",
    );
    expect(optimization).toContain(
      "A round counts only after one Candidate has a complete valid Evaluation",
    );
    expect(optimization).toContain("keep the same Candidate and incomplete matrix");
    expect(optimization).toContain(
      "Do not inspect private Evaluator State or abandon the Candidate",
    );
    expect(optimization).toContain(
      "Immediately append and verify every accepted Candidate Evaluation",
    );
    expect(optimization).toContain(
      "distinguish the acceptance decision from whether its stated hypothesis was supported",
    );
    expect(optimization).toContain(
      "At the round limit, retain the highest-scoring accepted Reference",
    );
    expect(optimization).toContain("Read the evaluation `(provider, model_id, thinking_level)`");
    expect(optimization).toContain(
      "require its actual `provider`, `model_id`, and `thinking_level` to equal the Reference runtime",
    );
    expect(optimization).toContain("Do not edit `system_prompt` unless requested");
    expect(optimization).toContain("change `model.thinking_level`");
    expect(optimization).toContain(
      "ensure `<target>/snapshots/v<Reference version>.tar.gz` exists",
    );
    expect(optimization).toContain("Reuse it when present");
    expect(optimization).toContain("create it yourself before editing");
    expect(optimization).toContain("excluding `.vault.toml`");
    expect(optimization).toContain("never overwrite an existing same-version snapshot");
    expect(optimization).not.toContain("stop and ask the user to export");
    expect(optimization).toContain("fixed `0..100` scale");
    expect(optimization).toContain("average of the Case scores");
    expect(optimization).toContain("stored values are authoritative");
    expect(optimization).toContain("Obtain the current UTC timestamp from the environment");
    expect(optimizationRaw).not.toMatch(/\n\s+max_score:/);
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
