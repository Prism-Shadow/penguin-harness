/**
 * Docs ↔ plugin-library sync: the Skills & Plugins doc pages must mention every plugin that
 * actually ships in the repository's plugins/ — every package there, library content and server
 * modules alike (what a package carries is in its built ifaces.json, which this suite does not
 * build, so it does not tell them apart). Derived, not hardcoded, so adding a plugin without
 * documenting it fails here instead of silently drifting.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const pluginsRoot = join(__dirname, "..", "..", "..", "plugins");
const contentDir = join(__dirname, "..", "content");

/** A plugin directory: one npm package, its package.json at the top. */
const isPluginDir = (dir: string): boolean => existsSync(join(dir, "package.json"));

const libraryPlugins = readdirSync(pluginsRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && isPluginDir(join(pluginsRoot, entry.name)))
  .map((entry) => entry.name)
  .sort();

describe("docs ↔ plugin library sync", () => {
  it("found the plugin library", () => {
    expect(libraryPlugins.length).toBeGreaterThan(0);
  });

  for (const lang of ["zh", "en"] as const) {
    it(`skills.${lang}.md mentions every library plugin`, () => {
      const page = readFileSync(join(contentDir, `skills.${lang}.md`), "utf8");
      const missing = libraryPlugins.filter((name) => !page.includes(`\`${name}\``));
      expect(missing, `undocumented plugins in skills.${lang}.md`).toEqual([]);
    });
  }
});
