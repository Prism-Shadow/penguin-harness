/**
 * Docs ↔ plugin-library sync: the Skills & Plugins doc pages must mention every plugin that
 * actually ships in packages/plugins (the library directory is the source of truth — the
 * same directories loadLibraryPlugins() reads). Derived, not hardcoded, so adding a plugin
 * without documenting it fails here instead of silently drifting.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const pluginsRoot = join(__dirname, "..", "..", "plugins", "official");
const contentDir = join(__dirname, "..", "content");

const libraryPlugins = readdirSync(pluginsRoot, { withFileTypes: true })
  .filter(
    (entry) => entry.isDirectory() && existsSync(join(pluginsRoot, entry.name, "plugin.json")),
  )
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
