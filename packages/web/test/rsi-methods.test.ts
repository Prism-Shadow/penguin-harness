/**
 * The Web App's two RSI surfaces.
 *
 * - The Optimize tab's Method select (src/features/benchmark/rsi-methods.ts) is pinned to the
 *   plugin library: one row per plugin of the `rsi` category, each naming Skills its plugin
 *   ships, each labelled and described in both dictionaries. A toolkit added to plugins/ without
 *   a row — or a row whose plugin left — fails here rather than as a missing or dead option.
 * - The draft screen's counts line links each half of `S.chat.draftStats` to its own page, so
 *   both dictionaries keep exactly one " · " between the two counts, and both pages are ones the
 *   router mounts.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RSI_METHODS } from "../src/features/benchmark/rsi-methods";
import { PAGES } from "../src/lib/pages";
import { zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { REPO_ROOT } from "./helpers/roots";

const PLUGINS = join(REPO_ROOT, "plugins");

/** The library's plugins whose manifest files them under the `rsi` category, by name. */
function rsiPlugins(): string[] {
  return readdirSync(PLUGINS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => {
      const file = join(PLUGINS, entry.name, "plugin.json");
      if (!existsSync(file)) return false;
      const manifest = JSON.parse(readFileSync(file, "utf8")) as { category?: string };
      return manifest.category === "rsi";
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

  it("names Skills its row's plugin ships", () => {
    for (const m of RSI_METHODS) {
      const skills = "evaluationSkill" in m ? [m.skill, m.evaluationSkill] : [m.skill];
      for (const skill of skills) {
        const file = join(PLUGINS, m.plugin, "skills", skill, "SKILL.md");
        expect(existsSync(file), `${m.plugin} ships ${skill}`).toBe(true);
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

describe("the draft screen's counts line", () => {
  it.each([
    { locale: "zh", dict: zh },
    { locale: "en", dict: en },
  ])("$locale reads as two halves, one count each", ({ dict }) => {
    const halves = dict.chat.draftStats(5, 7).split(" · ");
    expect(halves).toHaveLength(2);
    expect(halves[0]).toContain("5");
    expect(halves[1]).toContain("7");
  });

  it("links each half to a page the router mounts", () => {
    // A path the router does not mount falls through to /chat without a word.
    const source = readFileSync(
      join(REPO_ROOT, "packages/web/src/features/chat/draft-view.tsx"),
      "utf8",
    );
    const start = source.indexOf("function RsiStatsLine");
    const body = source.slice(start, source.indexOf("\nfunction ", start + 1));
    const targets = [...body.matchAll(/<Link\s+to="([^"]+)"/g)].map((m) => m[1] ?? "");
    expect(targets).toEqual(["/plugins", "/benchmark"]);
    const mounted = new Set(PAGES.map((page) => page.path));
    for (const target of targets) expect(mounted.has(target)).toBe(true);
  });
});
