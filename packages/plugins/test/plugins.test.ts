/**
 * The plugin library's file source of truth and its loader: plugins read from `official/`
 * (manifest fields, the skills and hook packages they ship), the version scheme, the
 * category grouping, the preinstall filter, the name lookups, the doc conventions every
 * shipped skill follows, and the README tables that repeat the library for human readers.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  PLUGIN_CATEGORIES,
  PLUGIN_VERSION_PATTERN,
  compareVersions,
  groupPlugins,
  libraryPlugin,
  librarySkill,
  loadLibraryPlugins,
  loadPluginGroups,
  loadPreinstalledPlugins,
  parseSkillFrontmatter,
  type LibraryPlugin,
  type PluginCategory,
} from "../src/index.js";

const pluginsRoot = path.resolve(import.meta.dirname, "../official");

/** Minimal LibraryPlugin for groupPlugins unit tests. */
const fakePlugin = (name: string, category?: string): LibraryPlugin => ({
  name,
  description: `Do ${name}.`,
  version: "2026-08-29.1",
  preinstall: true,
  skills: [],
  ...(category !== undefined ? { category } : {}),
});

describe("loadLibraryPlugins", () => {
  it("loads every plugin directory sorted by name, each with a date-sequence version and a category", () => {
    const plugins = loadLibraryPlugins();
    expect(plugins.map((p) => p.name)).toEqual([...plugins.map((p) => p.name)].sort());
    expect(plugins.length).toBeGreaterThan(19);
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

  it("stamps the plugin's metadata into each skill: slim file frontmatter, full installable frontmatter", async () => {
    for (const plugin of loadLibraryPlugins()) {
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
        expect(skill.icon, `${plugin.name}/${skill.name} icon.svg`).toBeDefined();
        expect(skill.icon).toMatch(/^<svg[\s\S]*<\/svg>\s*$/);
        expect(skill.icon).not.toMatch(/<script/i);
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
    });
    expect(goal!.hooks!.manifest.descriptionZh).toBeDefined();
    expect(Object.keys(goal!.hooks!.files).sort()).toEqual(["lib.mjs", "start.mjs", "stop.mjs"]);
    expect(goal!.skills).toEqual([]);
    const summary = libraryPlugin("skill-summary");
    expect(summary?.hooks?.manifest.stop).toEqual([{ command: "stop.mjs", timeout: 60 }]);
    expect(Object.keys(summary!.hooks!.files)).toEqual(["stop.mjs"]);
  });

  it("a plugin manifest falls back to its first skill's descriptions", () => {
    const plugin = libraryPlugin("web-design")!;
    expect(plugin.description).toBe(plugin.skills[0]!.description);
    expect(plugin.shortDescription).toBe(plugin.skills[0]!.shortDescription);
    expect(plugin.shortDescriptionZh).toBe(plugin.skills[0]!.shortDescriptionZh);
  });
});

describe("loadPreinstalledPlugins", () => {
  it("excludes plugins whose manifest sets preinstall: false and keeps everything else", () => {
    const all = loadLibraryPlugins().map((p) => p.name);
    const preinstalled = loadPreinstalledPlugins().map((p) => p.name);
    expect(preinstalled).toContain("goal");
    expect(preinstalled).toContain("web-design");
    for (const manual of ["skill-summary", "humanizer", "remote-claude-code"]) {
      expect(all).toContain(manual);
      expect(preinstalled).not.toContain(manual);
    }
  });
});

describe("compareVersions", () => {
  it("orders by date, then by sequence number numerically; non-versions sort before every version", () => {
    expect(compareVersions("2026-08-29.1", "2026-08-29.1")).toBe(0);
    expect(compareVersions("2026-08-29.2", "2026-08-29.10")).toBeLessThan(0);
    expect(compareVersions("2026-09-01.1", "2026-08-29.9")).toBeGreaterThan(0);
    expect(compareVersions("", "2026-08-29.1")).toBeLessThan(0);
    expect(compareVersions("7", "2026-08-29.1")).toBeLessThan(0);
    expect(compareVersions("", "")).toBe(0);
  });
});

describe("groupPlugins / loadPluginGroups", () => {
  it("groups by category in manifest order, members sorted, empty categories omitted, unknown ones in Other", () => {
    const groups = groupPlugins([
      fakePlugin("b", "agent-tuning"),
      fakePlugin("a", "agent-tuning"),
      fakePlugin("z"),
      fakePlugin("y", "made-up"),
      fakePlugin("h", "session-hooks"),
    ]);
    expect(groups.map((g) => [g.id, g.plugins.map((p) => p.name)])).toEqual([
      ["agent-tuning", ["a", "b"]],
      ["session-hooks", ["h"]],
      ["other", ["y", "z"]],
    ]);
    expect(groups[2]).toMatchObject({ title: "Other", titleZh: "其他" });
  });

  it("the library itself fills the five categories and leaves no Other group", () => {
    const groups = loadPluginGroups();
    expect(groups.map((g) => g.id)).toEqual(PLUGIN_CATEGORIES.map((c) => c.id));
    expect(groups.find((g) => g.id === "session-hooks")?.plugins.map((p) => p.name)).toEqual([
      "goal",
      "skill-summary",
    ]);
  });
});

describe("lookups", () => {
  it("libraryPlugin and librarySkill find by name; illegal names never touch the filesystem", () => {
    expect(libraryPlugin("goal")?.name).toBe("goal");
    expect(libraryPlugin("does-not-exist")).toBeUndefined();
    expect(libraryPlugin("../etc")).toBeUndefined();
    expect(librarySkill("web-design")?.plugin.name).toBe("web-design");
    expect(librarySkill("goal")).toBeUndefined();
    expect(librarySkill("..")).toBeUndefined();
  });
});

describe("parseSkillFrontmatter", () => {
  it("parses name/description/version and the optional short descriptions; values may contain colons", () => {
    const meta = parseSkillFrontmatter(
      "---\nname: x\ndescription: a: b\nshort_description: s\nshort_description_zh: 中\nversion: 2026-08-29.3\n---\nbody",
    );
    expect(meta).toEqual({
      name: "x",
      description: "a: b",
      shortDescription: "s",
      shortDescriptionZh: "中",
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
    label: "packages/plugins/README.md",
    file: "../README.md",
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
