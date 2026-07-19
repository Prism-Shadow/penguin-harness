/**
 * On-disk behavior of an Agent's installed Skills: installSkill /
 * removeSkill / listInstalledSkills, and metadata injection via skillMetadataSection /
 * assembleSystemPrompt.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { librarySkill } from "@prismshadow/penguin-skills";
import {
  AGENTS_MD_PLACEHOLDER,
  DEFAULT_AGENT_ID,
  DEFAULT_PROJECT_ID,
  SKILL_METADATA_PLACEHOLDER,
  agentStateDir,
  assembleSystemPrompt,
  installSkill,
  listInstalledSkills,
  removeSkill,
  skillMetadataSection,
  skillsDir,
} from "../src/state/index.js";

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-skills-"));
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

const install = (name: string, content: string, icon?: string) =>
  installSkill(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID, {
    name,
    content,
    ...(icon !== undefined ? { icon } : {}),
  });
const list = () => listInstalledSkills(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID);
const skillFile = (name: string, file: string) =>
  path.join(skillsDir(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID), name, file);
const skillMd = (name: string) => skillFile(name, "SKILL.md");
const skillIcon = (name: string) => skillFile(name, "icon.svg");

describe("installSkill / removeSkill", () => {
  it("writes skills/<name>/SKILL.md verbatim with a trailing newline", async () => {
    const skill = librarySkill("penguin-cli")!;
    await install(skill.name, skill.content);
    expect(await fs.readFile(skillMd("penguin-cli"), "utf8")).toBe(skill.content);

    // Content without a trailing newline gets one appended; reinstalling overwrites.
    await install("penguin-cli", "---\nname: penguin-cli\nversion: 2\n---\n\nNew body");
    expect(await fs.readFile(skillMd("penguin-cli"), "utf8")).toBe(
      "---\nname: penguin-cli\nversion: 2\n---\n\nNew body\n",
    );
    expect((await list()).map((s) => s.version)).toEqual([2]);
  });

  it("writes icon.svg alongside SKILL.md, and reinstalling without icon removes it", async () => {
    // A library skill with an icon: installing writes it to disk alongside SKILL.md.
    const skill = librarySkill("penguin-sdk")!;
    expect(skill.icon).toBeTruthy();
    await install(skill.name, skill.content, skill.icon);
    expect(await fs.readFile(skillIcon("penguin-sdk"), "utf8")).toBe(skill.icon);

    // Overwrite semantics: this install has no icon -> the old icon.svg is removed, and the
    // directory matches this install's content exactly.
    await install("penguin-sdk", "---\nname: penguin-sdk\nversion: 2\n---\n\nNew body\n");
    await expect(fs.access(skillIcon("penguin-sdk"))).rejects.toThrow();
    expect(await fs.readFile(skillMd("penguin-sdk"), "utf8")).toContain("New body");
  });

  it("rejects invalid skill names (path traversal safety)", async () => {
    await expect(install("../evil", "x")).rejects.toThrow(/skill_name/);
    await expect(install("a/b", "x")).rejects.toThrow(/skill_name/);
    await expect(removeSkill(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID, "..")).rejects.toThrow(
      /skill_name/,
    );
  });

  it("removeSkill deletes the whole skill directory and is idempotent", async () => {
    const skill = librarySkill("penguin-sdk")!;
    await install(skill.name, skill.content);
    await removeSkill(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID, "penguin-sdk");
    await expect(fs.access(skillMd("penguin-sdk"))).rejects.toThrow();
    // Idempotent when it no longer exists: does not throw.
    await removeSkill(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID, "penguin-sdk");
    expect(await list()).toEqual([]);
  });
});

describe("listInstalledSkills", () => {
  it("returns [] when the skills directory does not exist", async () => {
    expect(await list()).toEqual([]);
  });

  it("parses frontmatter and sorts by name", async () => {
    await install(
      "zeta",
      "---\nname: zeta\ndescription: Z skill.\nversion: 3\nupdated: 2026-07-16\n---\n\nBody\n",
    );
    await install(
      "alpha",
      "---\nname: alpha\ndescription: A skill.\nversion: 1\nupdated: 2026-07-16\n---\n\nBody\n",
    );
    expect(await list()).toEqual([
      { name: "alpha", description: "A skill.", version: 1, updated: "2026-07-16" },
      { name: "zeta", description: "Z skill.", version: 3, updated: "2026-07-16" },
    ]);
  });

  it("returns icon.svg content and passes short description fields through", async () => {
    const icon = '<svg viewBox="0 0 24 24"><path d="M4 4h16" /></svg>\n';
    await install(
      "with-extras",
      "---\nname: with-extras\ndescription: Long description here.\nshort_description: Short one.\nshort_description_zh: 短描述。\nversion: 1\nupdated: 2026-07-17\n---\n\nBody\n",
      icon,
    );
    await install(
      "plain",
      "---\nname: plain\ndescription: Plain skill.\nversion: 1\nupdated: 2026-07-17\n---\n\nBody\n",
    );
    const skills = await list();
    expect(skills).toEqual([
      { name: "plain", description: "Plain skill.", version: 1, updated: "2026-07-17" },
      {
        name: "with-extras",
        description: "Long description here.",
        shortDescription: "Short one.",
        shortDescriptionZh: "短描述。",
        version: 1,
        updated: "2026-07-17",
        icon,
      },
    ]);
    // Entries missing icon / short description omit the corresponding field (undefined does
    // not produce a key; the interface layer's conditional spread relies on this convention).
    expect("icon" in skills[0]!).toBe(false);
    expect("shortDescription" in skills[0]!).toBe(false);
  });

  it("uses the directory name as the skill identity even when frontmatter name disagrees", async () => {
    // A hand-written or network-sourced skill may have a frontmatter name that differs from
    // its directory name: the directory name is the addressing key used for install, uninstall,
    // and Prompt lookup, so the listing must follow it (frontmatter fields are display-only).
    await install(
      "local-name",
      "---\nname: upstream-name\ndescription: Fetched skill.\nversion: 2\nupdated: 2026-07-01\n---\n\nBody\n",
    );
    expect(await list()).toEqual([
      { name: "local-name", description: "Fetched skill.", version: 2, updated: "2026-07-01" },
    ]);
  });

  it("falls back to directory-name metadata for broken frontmatter and skips non-skill entries", async () => {
    // A SKILL.md without frontmatter: falls back to directory name + empty description + version 1.
    await install("broken", "# No frontmatter here\n");
    // Directories without a SKILL.md, and stray files, do not count as Skills.
    const dir = skillsDir(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID);
    await fs.mkdir(path.join(dir, "empty-dir"), { recursive: true });
    await fs.writeFile(path.join(dir, "stray.md"), "stray", "utf8");
    expect(await list()).toEqual([{ name: "broken", description: "", version: 1, updated: "" }]);
  });
});

describe("skillMetadataSection / assembleSystemPrompt 注入", () => {
  it("renders one `- \\`name\\` — description` line per skill; empty input renders empty", () => {
    expect(skillMetadataSection([])).toBe("");
    expect(
      skillMetadataSection([
        { name: "a", description: "Does A.", version: 1, updated: "2026-07-16" },
        { name: "b", description: "", version: 1, updated: "" },
      ]),
    ).toBe("- `a` — Does A.\n- `b`");
  });

  it("replaces {{SKILL_METADATA}} with metadata lines, or an empty string when absent", () => {
    const state = {
      root: tmpRoot,
      projectId: DEFAULT_PROJECT_ID,
      agentId: DEFAULT_AGENT_ID,
      stateDir: agentStateDir(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID),
      systemConfig: {
        system_prompt: ["before", AGENTS_MD_PLACEHOLDER, SKILL_METADATA_PLACEHOLDER, "after"].join(
          "\n",
        ),
      },
      agentsMd: "# Agent Rules",
    };
    const prompt = assembleSystemPrompt(state, undefined, undefined, [
      { name: "demo", description: "Demo skill.", version: 1, updated: "2026-07-16" },
    ]);
    expect(prompt).toBe(["before", "# Agent Rules", "- `demo` — Demo skill.", "after"].join("\n"));
    // Not provided / empty list: the placeholder is replaced with an empty string, no residue left.
    const empty = assembleSystemPrompt(state);
    expect(empty).toBe(["before", "# Agent Rules", "", "after"].join("\n"));
    expect(empty).not.toContain(SKILL_METADATA_PLACEHOLDER);
  });
});
