/**
 * The demo library's self-evolution plugins ↔ the shipped library. The Plugins page lists the
 * mock library, and the start page counts its `rsi` group as the self-evolution algorithms, so:
 *
 * - Given the plugins directory, when the demo library is built, then its `rsi` group holds
 *   exactly the plugins whose package.json files them under `rsi`, titled as core titles the
 *   category, and each plugin carries its Skills as their SKILL.md files name, describe and
 *   version them.
 * - Given Agent Evaluation, which every toolkit measures through, then it sits under its own
 *   category, with its Skills, and the General Agent that ran the demo's round has every one of
 *   these Skills installed.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PLUGIN_CATEGORIES } from "@prismshadow/penguin-core";
import { buildFixtures } from "../src/app/mock/fixtures";
import { IDS } from "../src/app/mock/ids";

const pluginsRoot = join(__dirname, "..", "..", "..", "plugins");

const categoryOf = (plugin: string): string | undefined =>
  (
    JSON.parse(readFileSync(join(pluginsRoot, plugin, "package.json"), "utf8")) as {
      penguin?: { category?: string };
    }
  ).penguin?.category;

/** A plugin's Skills as their SKILL.md frontmatter has them, by name. */
function shippedSkills(
  plugin: string,
): Array<{ name: string; description: string; version: string }> {
  const dir = join(pluginsRoot, plugin, "skills");
  return readdirSync(dir)
    .filter((name) => existsSync(join(dir, name, "SKILL.md")))
    .sort()
    .map((name) => {
      const head =
        /^---\n([\s\S]*?)\n---/.exec(readFileSync(join(dir, name, "SKILL.md"), "utf8"))?.[1] ?? "";
      const field = (key: string) => new RegExp(`^${key}: (.*)$`, "m").exec(head)?.[1] ?? "";
      return { name: field("name"), description: field("description"), version: field("version") };
    });
}

const library = buildFixtures("en", Date.parse("2026-09-29T08:00:00Z")).library;
const group = (id: string) => library.groups.find((g) => g.id === id);
const listed = (id: string) =>
  (group(id)?.plugins ?? []).map((plugin) => ({
    name: plugin.name,
    skills: plugin.skills
      .map(({ name, description, version }) => ({ name, description, version }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  }));
const titleOf = (id: string) => {
  const category = PLUGIN_CATEGORIES.find((c) => c.id === id)!;
  return { title: category.title, titleZh: category.titleZh };
};

describe("the demo library's self-evolution plugins", () => {
  it("list the rsi category as the library ships it: its plugins, their Skills, its titles", () => {
    const shipped = readdirSync(pluginsRoot)
      .filter((name) => existsSync(join(pluginsRoot, name, "package.json")))
      .filter((name) => categoryOf(name) === "rsi")
      .sort();
    expect(shipped.length).toBeGreaterThan(0);
    expect(listed("rsi")).toEqual(shipped.map((name) => ({ name, skills: shippedSkills(name) })));
    expect({ title: group("rsi")?.title, titleZh: group("rsi")?.titleZh }).toEqual(titleOf("rsi"));
  });

  it("file Agent Evaluation under its own category, and install every one of them on the General Agent", () => {
    const category = categoryOf("agent-evaluation")!;
    expect(listed(category).filter((p) => p.name === "agent-evaluation")).toEqual([
      { name: "agent-evaluation", skills: shippedSkills("agent-evaluation") },
    ]);
    expect({ title: group(category)?.title, titleZh: group(category)?.titleZh }).toEqual(
      titleOf(category),
    );
    const installed = buildFixtures("zh", Date.now()).installed[IDS.agents.general]!.skills.map(
      (s) => s.name,
    );
    for (const plugin of [...listed("rsi"), ...listed(category)]) {
      for (const skill of plugin.skills) expect(installed, skill.name).toContain(skill.name);
    }
  });
});
