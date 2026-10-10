/**
 * The skill-normalising script the `plugin-porting` skill runs on a package it is building
 * (plugins/skill-porting/skills/plugin-porting/scripts/normalize-skills.mjs), run as the Agent
 * runs it: Node on a package directory.
 *
 * - A ported skill's frontmatter becomes exactly `name`, a one-line `description` and a
 *   `version`: a block scalar is flattened, `when_to_use` is merged in, and every other key —
 *   lists included — is dropped and named; the body is kept as it was.
 * - A dated version the skill already carries is kept; otherwise the given one is stamped.
 * - Another tool's display metadata and every file that is not text leave the skill; the text
 *   files beside SKILL.md stay.
 * - A folder without a SKILL.md is removed; a folder whose name is not a skill name is renamed —
 *   by its frontmatter name when nothing of the folder name is left, else `skill`, and never onto
 *   a name another skill has.
 * - What it leaves is a package the plugin library reads with no warning.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseSkillFrontmatter, readLibraryPackage } from "../src/plugins/index.js";

const SCRIPT = path.resolve(
  import.meta.dirname,
  "../../../plugins/skill-porting/skills/plugin-porting/scripts/normalize-skills.mjs",
);

let pkg: string | null = null;
afterEach(async () => {
  vi.restoreAllMocks();
  if (pkg !== null) await fs.rm(pkg, { recursive: true, force: true });
  pkg = null;
});

/** A package directory being built: a package.json and `files` (paths relative to it). */
async function building(files: Record<string, string | Uint8Array>): Promise<string> {
  pkg = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-porting-"));
  await fs.writeFile(
    path.join(pkg, "package.json"),
    JSON.stringify({ name: "@ported/demo", version: "0.1.2", description: "Demo." }),
  );
  for (const [rel, data] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(pkg, rel)), { recursive: true });
    await fs.writeFile(path.join(pkg, rel), data);
  }
  return pkg;
}

const normalize = (dir: string) => {
  const run = spawnSync(process.execPath, [SCRIPT, dir, "--version", "2026.10.10.1"], {
    encoding: "utf8",
  });
  expect(run.status, run.stderr).toBe(0);
  return run.stdout;
};

const read = (rel: string) => fs.readFile(path.join(pkg!, rel), "utf8");

describe("normalize-skills.mjs", () => {
  it("rewrites the frontmatter to name, a one-line description and a version, naming what it drops", async () => {
    const dir = await building({
      "skills/agents/SKILL.md": [
        "---",
        "name: agents",
        "description: |",
        "  Builds agents on the platform.",
        "",
        '  Use when: the user wants "an agent".',
        "when_to_use: The user asks for a stateful agent.",
        "references:",
        "  - workers",
        "  - d1",
        "allowed-tools: [Read, Bash]",
        "---",
        "",
        "# Agents",
        "",
        "Body: kept as it was.",
        "",
      ].join("\n"),
    });
    const out = normalize(dir);
    const text = await read("skills/agents/SKILL.md");
    expect(text.split("\n").slice(0, 5)).toEqual([
      "---",
      "name: agents",
      'description: Builds agents on the platform. Use when: the user wants "an agent". Use when: The user asks for a stateful agent.',
      "version: 2026.10.10.1",
      "---",
    ]);
    expect(text.endsWith("\n# Agents\n\nBody: kept as it was.\n")).toBe(true);
    expect(out).toContain("dropped frontmatter keys: references, allowed-tools");
  });

  it("keeps a dated version the skill already carries", async () => {
    const dir = await building({
      "skills/kept/SKILL.md":
        "---\nname: kept\ndescription: Kept.\nversion: 2026.09.01.3\n---\n\nBody.\n",
    });
    normalize(dir);
    expect(parseSkillFrontmatter(await read("skills/kept/SKILL.md"))?.version).toBe("2026.09.01.3");
  });

  it("removes another tool's display metadata and every file that is not text, and keeps the text beside SKILL.md", async () => {
    const dir = await building({
      "skills/web/SKILL.md": "---\nname: web\ndescription: Web.\n---\n\nBody.\n",
      "skills/web/agents/openai.yaml": "interface:\n  display_name: Web\n",
      "skills/web/assets/logo.png": new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe, 0x00]),
      "skills/web/assets/logo.svg": "<svg xmlns='http://www.w3.org/2000/svg'/>\n",
      "skills/web/references/api.md": "# API\n",
      "skills/web/LICENSE.txt": "MIT\n",
    });
    const out = normalize(dir);
    expect(existsSync(path.join(dir, "skills/web/agents"))).toBe(false);
    expect(existsSync(path.join(dir, "skills/web/assets/logo.png"))).toBe(false);
    for (const kept of ["assets/logo.svg", "references/api.md", "LICENSE.txt"]) {
      expect(existsSync(path.join(dir, "skills/web", kept)), kept).toBe(true);
    }
    expect(out).toContain("removed: agents/openai.yaml, assets/logo.png");
  });

  it("removes a folder without a SKILL.md and renames one whose name is not a skill name", async () => {
    const dir = await building({
      "skills/notes only/README.md": "Nothing to install.\n",
      "skills/my.skill/SKILL.md": "---\nname: my.skill\ndescription: Mine.\n---\n\nBody.\n",
    });
    normalize(dir);
    expect((await fs.readdir(path.join(dir, "skills"))).sort()).toEqual(["my-skill"]);
    expect(parseSkillFrontmatter(await read("skills/my-skill/SKILL.md"))?.name).toBe("my-skill");
  });

  it("renames a folder that keeps no letter or digit by its frontmatter name, else skill, and never onto another skill's name", async () => {
    const dir = await building({
      "skills/writing/SKILL.md": "---\nname: writing\ndescription: Already here.\n---\n\nBody.\n",
      // Chinese folder names leave nothing under the name rule.
      "skills/写作/SKILL.md": "---\nname: writing\ndescription: Write.\n---\n\nBody.\n",
      "skills/翻译/SKILL.md": "---\nname: 翻译\ndescription: Translate.\n---\n\nBody.\n",
      "skills/校对/SKILL.md": "---\nname: 校对\ndescription: Proofread.\n---\n\nBody.\n",
    });
    normalize(dir);
    const described = Object.fromEntries(
      readLibraryPackage(dir).skills.map((s) => [s.name, s.description]),
    );
    expect(Object.keys(described).sort()).toEqual(["skill", "skill-2", "writing", "writing-2"]);
    expect(described.writing).toBe("Already here.");
    expect(described["writing-2"]).toBe("Write.");
    expect([described.skill, described["skill-2"]].sort()).toEqual(["Proofread.", "Translate."]);
  });

  it("leaves a package the plugin library reads with no warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const dir = await building({
      "skills/one/SKILL.md": "---\nname: one\ndescription: >-\n  Folded\n  text.\n---\n\nBody.\n",
      "skills/one/assets/shot.png": new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff]),
      "skills/two/SKILL.md": "# Two\n\nDoes the second thing.\n",
    });
    normalize(dir);
    const plugin = readLibraryPackage(dir);
    expect(plugin.skills.map((s) => [s.name, s.description, s.version])).toEqual([
      ["one", "Folded text.", "2026.10.10.1"],
      ["two", "Does the second thing.", "2026.10.10.1"],
    ]);
    expect(warn).not.toHaveBeenCalled();
  });
});
