import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { libraryParts, readPluginTable } from "@prismshadow/penguin-core";
import { moduleDefOf } from "@prismshadow/penguin-core/kernel";
import { describe, expect, it } from "vitest";
import plugin from "../src/index.js";

const dir = fileURLToPath(new URL("../", import.meta.url));

describe("the shipped Multimodal tools plugin", () => {
  it("boots the same module whose library entry installs the CLI Skill", () => {
    const table = readPluginTable(dir)!;
    const [component] = plugin.modules;
    const { manifest } = moduleDefOf(component, { manifests: table.manifests });
    expect(table.plugin.modules).toEqual([manifest.name]);
    expect(libraryParts(dir)).toMatchObject({ modules: true, skills: true });
    expect(manifest.contributes["PluginLibraryModule.cards"]).toEqual([
      expect.objectContaining({ preinstall: true, category: "utilities" }),
    ]);
    const [skill] = manifest.contributes["PluginLibraryModule.skills"]!;
    expect(skill).toMatchObject({ name: "multimodal-tools", path: "skills/multimodal-tools" });
    const instructions = readFileSync(
      new URL(`../${skill!.path}/SKILL.md`, import.meta.url),
      "utf8",
    );
    const actions = manifest.contributes["ModelCapabilitiesProvider.capabilities"]!;
    expect(actions.map((action) => action.key).sort()).toEqual([
      "fetch",
      "image",
      "search",
      "stt",
      "tts",
      "video",
    ]);
    for (const action of actions) {
      expect(action).toMatchObject({
        id: `multimodal.${action.key}`,
        title: { en: expect.any(String), zh: expect.any(String) },
      });
      expect(instructions).toContain(`penguin tools ${action.key} `);
    }
  });
});
