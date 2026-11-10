/**
 * The shipped plugin library, as the server reads it: its own package is the library's host (its
 * dependencies name the plugin packages), and each package's content is what its built
 * `ifaces.json` declares. The reader's rules are core's suite (plugins.test.ts, on fixtures);
 * this one holds the shipped packages to them.
 *
 * - Every plugin lists, sorted by name: its npm version, a known category, a description, a dated
 *   version on every part, and at least one part.
 * - Every shipped package reads clean — the loader throws at any warning for a shipped package —
 *   and its card describes it for the Plugins page in both languages, under a known category,
 *   with a safe icon; no package.json escapes its Chinese, and no plugin.json is left anywhere.
 * - Every plugin declares a quick start in both languages naming only its own Skills.
 * - The loader stamps each Skill with its plugin's short descriptions and icon and keeps its own
 *   dated version, the body verbatim; the library SKILL.md carries no short descriptions and no
 *   Skill directory an icon of its own; every Skill asks before it starts; the installable
 *   frontmatter reads back as YAML.
 * - No Skill name ships from two plugins, and the four prompt-optimization toolkits ship one
 *   evaluation reference.
 * - In this checkout every plugin is read from the repo's plugins/<name>/, not a copy.
 */
import { existsSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  PLUGIN_CATEGORIES,
  PLUGIN_VERSION_PATTERN,
  libraryPlugin,
  libraryPluginPackage,
  loadLibraryPlugins,
  parsePackageJson,
  parseSkillFrontmatter,
  readPackageCard,
  readPluginTable,
} from "@prismshadow/penguin-core";

const repo = path.resolve(import.meta.dirname, "../../..");
const pluginsRoot = path.join(repo, "plugins");
const serverPackage = JSON.parse(
  readFileSync(path.join(repo, "packages", "server", "package.json"), "utf8"),
) as { dependencies: Record<string, string> };
/** The plugin packages the server ships: its `@penguinharness/*` dependencies. */
const shipped = Object.keys(serverPackage.dependencies)
  .filter((name) => name.startsWith("@penguinharness/"))
  .sort();

describe("the shipped library", () => {
  it("lists every plugin sorted by name: its npm version, a category, and a dated version on every part", async () => {
    const plugins = loadLibraryPlugins();
    expect(plugins.map((p) => p.name)).toEqual([...plugins.map((p) => p.name)].sort());
    for (const plugin of plugins) {
      const pkg = JSON.parse(
        await fs.readFile(path.join(pluginsRoot, plugin.name, "package.json"), "utf8"),
      ) as { version: string };
      expect(plugin.version, plugin.name).toBe(pkg.version);
      for (const skill of plugin.skills) {
        expect(skill.version, `${plugin.name}/${skill.name}`).toMatch(PLUGIN_VERSION_PATTERN);
      }
      if (plugin.hooks !== undefined) {
        expect(plugin.hooks.manifest.version, plugin.name).toMatch(PLUGIN_VERSION_PATTERN);
      }
      expect(
        PLUGIN_CATEGORIES.map((c) => c.id),
        plugin.name,
      ).toContain(plugin.category);
      expect(plugin.description.length, plugin.name).toBeGreaterThan(0);
      expect(plugin.skills.length > 0 || plugin.hooks !== undefined, plugin.name).toBe(true);
    }
  });

  it("every shipped package reads clean and its card describes it in both languages, under a known category, with a safe icon; no plugin.json anywhere", async () => {
    expect(shipped.length).toBeGreaterThan(0);
    for (const packageName of shipped) {
      const dir = packageName.slice("@penguinharness/".length);
      const file = path.join(pluginsRoot, dir, "package.json");
      const text = await fs.readFile(file, "utf8");
      // Chinese in a manifest is written as real characters, not \uXXXX escapes.
      expect(text, `${dir} package.json escapes`).not.toMatch(/\\u[0-9a-fA-F]{4}/);
      const raw = JSON.parse(text) as { files?: string[] };
      const { manifest, warnings } = parsePackageJson(raw, file);
      expect(warnings, dir).toEqual([]);
      expect(manifest.pluginName, dir).toBe(dir);
      expect(manifest.description, dir).not.toBe("");
      expect(readPluginTable(path.join(pluginsRoot, dir)), `${dir}: build it`).not.toBeNull();
      const { card, icon } = readPackageCard(path.join(pluginsRoot, dir));
      expect(card.shortDescription, dir).toBeDefined();
      expect(card.shortDescriptionZh, dir).toBeDefined();
      expect(
        PLUGIN_CATEGORIES.map((c) => c.id),
        dir,
      ).toContain(card.category);
      expect(icon, `${dir} icon`).toMatch(/^<svg[\s\S]*<\/svg>\s*$/);
      expect(raw.files ?? [], dir).toContain("ifaces.json");
      expect(raw.files ?? [], dir).not.toContain("plugin.json");
      expect(existsSync(path.join(pluginsRoot, dir, "plugin.json")), dir).toBe(false);
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
  });

  it("stamps the plugin's metadata into each skill: its own version in the file, full installable frontmatter", async () => {
    for (const plugin of loadLibraryPlugins()) {
      // Every built-in plugin ships an icon.
      expect(plugin.icon, `${plugin.name} icon`).toBeDefined();
      for (const skill of plugin.skills) {
        const dir = path.join(pluginsRoot, plugin.name, "skills", skill.name);
        const file = await fs.readFile(path.join(dir, "SKILL.md"), "utf8");
        // The library file carries name, description and the skill's own dated version; the
        // short descriptions are the card's, stamped in by the loader.
        const fileFront = /^---\n([\s\S]*?)\n---/.exec(file)![1]!;
        expect(fileFront, `${plugin.name}/${skill.name} file frontmatter`).not.toMatch(
          /^(short_description|short_description_zh):/m,
        );
        // The library file's frontmatter is YAML, and carries the skill's dated version.
        expect(
          (parseYaml(fileFront) as { version?: unknown }).version,
          `${plugin.name}/${skill.name}`,
        ).toMatch(PLUGIN_VERSION_PATTERN);
        // The installable content regenerates the frontmatter with the plugin's fields, keeps
        // the skill's own version, and keeps the body verbatim.
        const meta = parseSkillFrontmatter(skill.content)!;
        expect(meta.version, `${plugin.name}/${skill.name} version`).toBe(
          parseSkillFrontmatter(file)!.version,
        );
        expect(skill.version).toBe(meta.version);
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
        // The installable content carries a valid YAML block that reads back to the stamp.
        const block = /^---\n([\s\S]*?)\n---/.exec(skill.content)![1]!;
        const parsed = parseYaml(block, { schema: "failsafe" }) as Record<string, string>;
        expect(parsed["description"], `${skill.name} description`).toBe(skill.description);
        expect(parsed["version"] ?? "").toBe(skill.version);
      }
    }
  });

  // Plugins' own tests validate complete SKILL.md files through @prismshadow/skills.
  // This one is the library's: it installs into one flat skills/
  // directory, so a second skill of the same name would silently overwrite the first.
  it("ships no skill name from two plugins", () => {
    const owner = new Map<string, string>();
    for (const plugin of loadLibraryPlugins()) {
      for (const skill of plugin.skills) {
        expect(owner.get(skill.name), `${plugin.name}/${skill.name}`).toBeUndefined();
        owner.set(skill.name, plugin.name);
      }
    }
    expect(owner.size).toBeGreaterThan(0);
  });

  it("ACE, APE, AWM and OPRO ship the same evaluation reference", () => {
    // These four methods share one evaluation protocol. Continuous-training methods have
    // their own worker instructions; keep this check on the copies that must stay identical.
    const toolkits = [
      "ace-rsi-toolkit",
      "ape-rsi-toolkit",
      "awm-rsi-toolkit",
      "opro-rsi-toolkit",
    ].map((name) => libraryPlugin(name)!);
    expect(toolkits.length).toBeGreaterThan(1);
    const references = toolkits.map((plugin) => {
      // One Skill per algorithm toolkit, named like the plugin.
      expect(
        plugin.skills.map((s) => s.name),
        plugin.name,
      ).toEqual([plugin.name]);
      return plugin.skills[0]!.files?.["references/evaluation.md"] ?? "";
    });
    for (const [i, reference] of references.entries()) {
      expect(reference.length, toolkits[i]!.name).toBeGreaterThan(0);
      expect(reference, `${toolkits[i]!.name} vs ${toolkits[0]!.name}`).toBe(references[0]);
    }
  });

  it("reads this checkout's plugins/ directories, not copies under node_modules", () => {
    for (const plugin of loadLibraryPlugins()) {
      expect(libraryPluginPackage(plugin.name)?.dir).toBe(path.join(pluginsRoot, plugin.name));
    }
  });
});
