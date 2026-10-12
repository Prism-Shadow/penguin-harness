/**
 * The Optimize tab's Method select (src/features/benchmark/rsi-methods.ts) is pinned to the
 * plugin library: one row per plugin of the `rsi` category, each naming Skills that the plugins
 * it names ship (the default row's evaluator ships in Agent Evaluation, not in the toolkit), each
 * labelled and described in both dictionaries. A toolkit added to plugins/ without a row — or a
 * row whose plugin left — fails here rather than as a missing or dead option.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RSI_METHODS } from "../src/features/benchmark/rsi-methods";
import { zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { REPO_ROOT } from "./helpers/roots";

const PLUGINS = join(REPO_ROOT, "plugins");

/** The library's plugins whose package.json (`penguin.category`) files them under `rsi`, by name. */
function rsiPlugins(): string[] {
  return readdirSync(PLUGINS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => {
      const file = join(PLUGINS, entry.name, "package.json");
      if (!existsSync(file)) return false;
      const manifest = JSON.parse(readFileSync(file, "utf8")) as {
        penguin?: { category?: string };
      };
      return manifest.penguin?.category === "rsi";
    })
    .map((entry) => entry.name)
    .sort();
}

describe("RSI_METHODS", () => {
  it("has one row per plugin of the library's rsi category", () => {
    const plugins = rsiPlugins();
    expect(plugins.length).toBeGreaterThan(0);
    expect(RSI_METHODS.map((m) => m.plugin).sort()).toEqual(plugins);
  });

  it("names Skills the plugins it names ship", () => {
    for (const m of RSI_METHODS) {
      const skills: Array<[plugin: string, skill: string]> = [[m.plugin, m.skill]];
      if ("evaluationSkill" in m) skills.push([m.evaluationPlugin, m.evaluationSkill]);
      for (const [plugin, skill] of skills) {
        const file = join(PLUGINS, plugin, "skills", skill, "SKILL.md");
        expect(existsSync(file), `${plugin} ships ${skill}`).toBe(true);
      }
    }
  });

  it("labels and describes every method in both dictionaries", () => {
    for (const dict of [zh, en]) {
      for (const m of RSI_METHODS) {
        expect(dict.benchmark.methods[m.id].label.trim()).not.toBe("");
        expect(dict.benchmark.methods[m.id].blurb.trim()).not.toBe("");
      }
    }
  });
});
