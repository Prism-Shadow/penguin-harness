/**
 * The plugin library's file source of truth and core's loader: one npm package per plugin under the repo's `plugins/`
 * (manifest fields, the skills and hook packages they ship), the version scheme, the
 * category grouping, the preinstall filter, the name lookups, the doc conventions every
 * shipped skill follows, and the README tables that repeat the library for human readers.
 */
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  PLUGIN_CATEGORIES,
  PLUGIN_VERSION_PATTERN,
  comparePluginVersions,
  groupPlugins,
  libraryPlugin,
  librarySkill,
  loadLibraryPlugins,
  loadPluginGroups,
  loadPreinstalledPlugins,
  parseSkillFrontmatter,
  workspacePluginRoot,
  type LibraryPlugin,
  type PluginCategory,
} from "../src/plugins/index.js";

const pluginsRoot = path.resolve(import.meta.dirname, "../../../plugins");

/** Minimal LibraryPlugin for groupPlugins unit tests. */
const fakePlugin = (name: string, category?: string): LibraryPlugin => ({
  name,
  description: `Do ${name}.`,
  version: "2026.08.29.1",
  preinstall: true,
  skills: [],
  ...(category !== undefined ? { category } : {}),
});

describe("loadLibraryPlugins", () => {
  it("loads every plugin directory sorted by name, each with a date-sequence version and a category", () => {
    const plugins = loadLibraryPlugins();
    expect(plugins.map((p) => p.name)).toEqual([...plugins.map((p) => p.name)].sort());
    expect(plugins.length).toBe(13);
    for (const plugin of plugins) {
      expect(plugin.version, plugin.name).toMatch(PLUGIN_VERSION_PATTERN);
      expect(
        PLUGIN_CATEGORIES.map((c) => c.id),
        plugin.name,
      ).toContain(plugin.category);
      expect(plugin.description.length, plugin.name).toBeGreaterThan(0);
      expect(plugin.skills.length > 0 || plugin.hooks !== undefined, plugin.name).toBe(true);
    }
  });

  it("every library plugin declares a quick start: a demo prompt in both languages, naming only its own skills", () => {
    for (const plugin of loadLibraryPlugins()) {
      const quickStart = plugin.quickStart;
      expect(quickStart, plugin.name).toBeDefined();
      expect(quickStart!.prompt.length, plugin.name).toBeGreaterThan(0);
      expect(quickStart!.promptZh?.length ?? 0, plugin.name).toBeGreaterThan(0);
      for (const skill of quickStart!.skills ?? []) {
        expect(
          plugin.skills.map((s) => s.name),
          plugin.name,
        ).toContain(skill);
      }
    }
    // The goal plugin's demo is a goal: its hooks only run for one.
    expect(libraryPlugin("goal")?.quickStart?.goal).toBe(true);
  });

  it("stamps the plugin's metadata into each skill: slim file frontmatter, full installable frontmatter", async () => {
    for (const plugin of loadLibraryPlugins()) {
      // Chinese in a manifest is written as real characters, not \uXXXX escapes.
      const rawManifest = await fs.readFile(
        path.join(pluginsRoot, plugin.name, "plugin.json"),
        "utf8",
      );
      expect(rawManifest, `${plugin.name} plugin.json escapes`).not.toMatch(/\\u[0-9a-fA-F]{4}/);
      // Every built-in plugin ships an icon.svg beside plugin.json.
      expect(plugin.icon, `${plugin.name} icon.svg`).toBeDefined();
      expect(plugin.icon).toMatch(/^<svg[\s\S]*<\/svg>\s*$/);
      expect(plugin.icon).not.toMatch(/<script/i);
      for (const skill of plugin.skills) {
        const dir = path.join(pluginsRoot, plugin.name, "skills", skill.name);
        const file = await fs.readFile(path.join(dir, "SKILL.md"), "utf8");
        // The library file carries only name + description; plugin.json is the metadata holder.
        const fileFront = /^---\n([\s\S]*?)\n---/.exec(file)![1]!;
        expect(fileFront, `${plugin.name}/${skill.name} file frontmatter`).not.toMatch(
          /^(version|short_description|short_description_zh):/m,
        );
        // The installable content regenerates the frontmatter with the plugin's fields and
        // keeps the body verbatim.
        const meta = parseSkillFrontmatter(skill.content)!;
        expect(meta.version, `${plugin.name}/${skill.name} version`).toBe(plugin.version);
        expect(skill.version).toBe(plugin.version);
        expect(meta.shortDescriptionZh).toBe(plugin.shortDescriptionZh);
        expect(skill.content.endsWith(file.replace(/^---\n[\s\S]*?\n---/, ""))).toBe(true);
        // A skill's icon is its plugin's, stamped by the loader — no skill directory ships
        // an icon.svg of its own.
        expect(skill.icon, `${plugin.name}/${skill.name} icon`).toBe(plugin.icon);
        await expect(fs.access(path.join(dir, "icon.svg"))).rejects.toThrow();
        // Every shipped skill asks before starting when the message only names it.
        expect(skill.content, `${skill.name} lacks ## Before you start`).toMatch(
          /^## Before you start$/m,
        );
      }
    }
  });

  it("collects auxiliary files a SKILL.md references (reference/*), excluding SKILL.md and icon.svg", () => {
    const humanizer = librarySkill("humanizer");
    expect(humanizer).toBeDefined();
    const files = humanizer!.skill.files ?? {};
    expect(Object.keys(files).length).toBeGreaterThan(0);
    expect(Object.keys(files).every((rel) => rel !== "SKILL.md" && rel !== "icon.svg")).toBe(true);
    expect(Object.keys(files).some((rel) => rel.startsWith("reference/"))).toBe(true);
  });

  it("a hook plugin carries a manifest naming its stop scripts and the hooks/ files to install", () => {
    const goal = libraryPlugin("goal");
    expect(goal?.hooks?.manifest).toMatchObject({
      name: "goal",
      version: goal!.version,
      stop: [{ command: "stop.mjs", timeout: 60 }],
      pre_tool_use: [],
      user_prompt: [{ command: "start.mjs", timeout: 60 }],
    });
    expect(goal!.hooks!.manifest.description_zh).toBeDefined();
    expect(Object.keys(goal!.hooks!.files).sort()).toEqual(["lib.mjs", "start.mjs", "stop.mjs"]);
    expect(goal!.skills).toEqual([]);
    const learning = libraryPlugin("continual-learning");
    expect(learning?.hooks?.manifest.stop).toEqual([{ command: "stop.mjs", timeout: 60 }]);
    expect(Object.keys(learning!.hooks!.files)).toEqual(["stop.mjs"]);
  });

  it("a single-skill plugin reads as its own; a merged plugin's skills each resolve to it", () => {
    const plugin = libraryPlugin("data-analysis")!;
    expect(plugin.description.length).toBeGreaterThan(0);
    expect(plugin.skills).toHaveLength(1);
    // Merged plugins carry several skills, each still resolvable by its own name.
    expect(librarySkill("web-design")?.plugin.name).toBe("software-development");
    expect(librarySkill("unified-llm-api")?.plugin.name).toBe("agent-development");
    expect(librarySkill("penguin-config")?.plugin.name).toBe("agent-development");
  });
});

describe("loadPreinstalledPlugins", () => {
  it("excludes plugins whose manifest sets preinstall: false and keeps everything else", () => {
    const all = loadLibraryPlugins().map((p) => p.name);
    const preinstalled = loadPreinstalledPlugins().map((p) => p.name);
    expect(preinstalled).toContain("goal");
    expect(preinstalled).toContain("software-development");
    for (const manual of [
      "agent-company",
      "agent-company-proposals",
      "continual-learning",
      "humanizer",
      "use-claude-code",
    ]) {
      expect(all).toContain(manual);
      expect(preinstalled).not.toContain(manual);
    }
  });
});

describe("comparePluginVersions", () => {
  it("orders by date, then by sequence number numerically; non-versions sort before every version", () => {
    expect(comparePluginVersions("2026.08.29.1", "2026.08.29.1")).toBe(0);
    expect(comparePluginVersions("2026.08.29.2", "2026.08.29.10")).toBeLessThan(0);
    expect(comparePluginVersions("2026.09.01.1", "2026.08.29.9")).toBeGreaterThan(0);
    expect(comparePluginVersions("", "2026.08.29.1")).toBeLessThan(0);
    expect(comparePluginVersions("7", "2026.08.29.1")).toBeLessThan(0);
    expect(comparePluginVersions("", "")).toBe(0);
  });

  it("reads the legacy spelling as the same version a copy installed earlier carries", () => {
    expect(comparePluginVersions("2026-08-29.1", "2026.08.29.1")).toBe(0);
    expect(comparePluginVersions("2026.09.10.2", "2026.09.10.1")).toBeGreaterThan(0);
    expect(comparePluginVersions("2026.09.10.1", "2026-09-09.9")).toBeGreaterThan(0);
    expect(comparePluginVersions("2026-09-09.9", "2026.09.09.10")).toBeLessThan(0);
  });
});

describe("groupPlugins / loadPluginGroups", () => {
  it("groups by category in manifest order, members sorted, empty categories omitted, unknown ones in Other", () => {
    const groups = groupPlugins([
      fakePlugin("b", "ai-app-development"),
      fakePlugin("a", "ai-app-development"),
      fakePlugin("z"),
      fakePlugin("y", "made-up"),
      fakePlugin("h", "office-productivity"),
    ]);
    expect(groups.map((g) => [g.id, g.plugins.map((p) => p.name)])).toEqual([
      ["office-productivity", ["h"]],
      ["ai-app-development", ["a", "b"]],
      ["other", ["y", "z"]],
    ]);
    expect(groups[2]).toMatchObject({ title: "Other", titleZh: "其他" });
  });

  it("the library itself fills every category and leaves no Other group; hook packages sit with their audience", () => {
    const groups = loadPluginGroups();
    expect(groups.map((g) => g.id)).toEqual(PLUGIN_CATEGORIES.map((c) => c.id));
    const names = (id: string) => groups.find((g) => g.id === id)?.plugins.map((p) => p.name);
    expect(names("office-productivity")).toEqual([
      "continual-learning",
      "data-analysis",
      "goal",
      "humanizer",
      "use-bento-slides",
      "use-firecrawl",
    ]);
    expect(names("ai-app-development")).toEqual([
      "agent-development",
      "agent-tuning",
      "model-development",
      "skill-porting",
    ]);
    expect(names("agent-company")).toEqual(["agent-company", "agent-company-proposals"]);
  });
});

describe("lookups", () => {
  it("libraryPlugin and librarySkill find by name; illegal names never touch the filesystem", () => {
    expect(libraryPlugin("goal")?.name).toBe("goal");
    expect(libraryPlugin("does-not-exist")).toBeUndefined();
    expect(libraryPlugin("../etc")).toBeUndefined();
    expect(librarySkill("goal")).toBeUndefined();
    expect(librarySkill("..")).toBeUndefined();
  });
});

describe("parseSkillFrontmatter", () => {
  it("parses name/description/version and the optional short descriptions; values may contain colons", () => {
    const meta = parseSkillFrontmatter(
      "---\nname: x\ndescription: a: b\nshort_description: s\nshort_description_zh: 中\nversion: 2026.08.29.3\n---\nbody",
    );
    expect(meta).toEqual({
      name: "x",
      description: "a: b",
      shortDescription: "s",
      shortDescriptionZh: "中",
      version: "2026.08.29.3",
    });
  });

  it("keeps the legacy version spelling an installed copy from before the rename carries", () => {
    expect(parseSkillFrontmatter("---\nname: x\nversion: 2026-08-29.3\n---\nbody")).toEqual({
      name: "x",
      description: "",
      version: "2026-08-29.3",
    });
  });

  it("tolerates a BOM and CRLF, drops a malformed version to the empty string, and needs a name", () => {
    expect(parseSkillFrontmatter("﻿---\r\nname: x\r\nversion: 9\r\n---\r\nbody")).toEqual({
      name: "x",
      description: "",
      version: "",
    });
    expect(parseSkillFrontmatter("no frontmatter")).toBeNull();
    expect(parseSkillFrontmatter("---\ndescription: d\n---\n")).toBeNull();
  });
});

/**
 * This package's README and the repository's two root READMEs each repeat the library as a
 * table for human readers, and nothing else reads those tables. Derived from the library
 * rather than pinned, so adding a plugin — or filing it under the wrong heading — fails here
 * instead of leaving a table quietly wrong; the docs pages get the same guard from docs'
 * skills-sync test.
 */
const README_TABLES = [
  {
    label: "plugins/README.md",
    file: "../../../plugins/README.md",
    heading: (c: PluginCategory) => c.title,
  },
  { label: "README.md", file: "../../../README.md", heading: (c: PluginCategory) => c.title },
  {
    label: "README.zh.md",
    file: "../../../README.zh.md",
    heading: (c: PluginCategory) => c.titleZh ?? c.title,
  },
];

/** Rows of a README's category table, located by its `Category` / `分类` header row. */
function readmeTableRows(markdown: string): Array<{ group: string; plugins: string[] }> {
  const lines = markdown.split("\n");
  const header = lines.findIndex((line) => /^\|\s*(?:Category|分类)\s*\|/.test(line));
  if (header === -1) return [];
  const rows: Array<{ group: string; plugins: string[] }> = [];
  for (const line of lines.slice(header + 1)) {
    if (!line.startsWith("|")) break;
    const cells = line.split("|").slice(1, -1);
    if (cells.length < 2) continue;
    const group = cells[0]!.trim();
    if (/^:?-{3,}:?$/.test(group)) continue;
    rows.push({ group, plugins: [...cells[1]!.matchAll(/`([^`]+)`/g)].map((m) => m[1]!) });
  }
  return rows;
}

describe("README category tables", () => {
  for (const { label, file, heading } of README_TABLES) {
    it(`${label} names exactly the library's plugins, each under its own category`, async () => {
      const markdown = await fs.readFile(path.resolve(import.meta.dirname, file), "utf8");
      const rows = readmeTableRows(markdown);
      expect(rows.length, `no Category/分类 table found in ${label}`).toBeGreaterThan(0);
      const groups = loadPluginGroups();
      expect(rows.map((row) => row.group).sort()).toEqual(groups.map(heading).sort());
      for (const group of groups) {
        const row = rows.find((entry) => entry.group === heading(group));
        expect(
          [...(row?.plugins ?? [])].sort(),
          `plugins under "${heading(group)}" in ${label}`,
        ).toEqual(group.plugins.map((p) => p.name).sort());
      }
    });
  }
});

describe("workspacePluginRoot (a checkout reads plugins from the repo's plugins/ directory)", () => {
  /** A workspace checkout as pnpm lays it out: the repo root, its plugins/, and an injected copy of a plugin under .pnpm. */
  async function checkout(opts: { workspaceFile: boolean; packageName: string }) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-plugin-root-"));
    if (opts.workspaceFile)
      await fs.writeFile(path.join(root, "pnpm-workspace.yaml"), "packages:\n");
    const source = path.join(root, "plugins", "sample");
    await fs.mkdir(source, { recursive: true });
    await fs.writeFile(
      path.join(source, "package.json"),
      JSON.stringify({ name: opts.packageName }),
    );
    const injected = path.join(
      root,
      "node_modules/.pnpm/@penguinharness+sample@file+plugins+sample/node_modules/@penguinharness/sample",
    );
    await fs.mkdir(injected, { recursive: true });
    // Where core itself sits in that checkout: its own injected copy, deep under .pnpm.
    const core = path.join(
      root,
      "node_modules/.pnpm/@prismshadow+penguin-core@file+packages+core/node_modules/@prismshadow/penguin-core",
    );
    await fs.mkdir(core, { recursive: true });
    return { root, source, injected, core };
  }

  it("prefers the repo's plugins/<name>/ over pnpm's injected copy inside a workspace checkout", async () => {
    const c = await checkout({ workspaceFile: true, packageName: "@penguinharness/sample" });
    try {
      expect(workspacePluginRoot("sample", c.injected, c.core)).toBe(c.source);
    } finally {
      await fs.rm(c.root, { recursive: true, force: true });
    }
  });

  it("keeps the resolved copy outside a workspace: an npm install and the packed app have no workspace file", async () => {
    const c = await checkout({ workspaceFile: false, packageName: "@penguinharness/sample" });
    try {
      expect(workspacePluginRoot("sample", c.injected, c.core)).toBe(c.injected);
    } finally {
      await fs.rm(c.root, { recursive: true, force: true });
    }
  });

  it("keeps the resolved copy when the workspace directory is not that package", async () => {
    const c = await checkout({ workspaceFile: true, packageName: "@penguinharness/other" });
    try {
      expect(workspacePluginRoot("sample", c.injected, c.core)).toBe(c.injected);
    } finally {
      await fs.rm(c.root, { recursive: true, force: true });
    }
  });

  it("the live loader reads this checkout's plugins/ directories, not copies under node_modules", () => {
    // The whole point, on the real tree: every library plugin's files come from the repo.
    for (const plugin of loadLibraryPlugins()) {
      expect(existsSync(path.join(pluginsRoot, plugin.name, "plugin.json"))).toBe(true);
    }
  });
});
