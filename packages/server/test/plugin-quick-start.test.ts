/**
 * Every plugin can quick-start. A library plugin carries its demo in plugin.json (listed on
 * GET /api/plugins); a module plugin contributes one to `WebModule.quickStarts` (listed on
 * GET /api/contributions, named by its module). The page only pre-fills a draft from either,
 * so what is checked here is that the demo reaches it — and that no builtin plugin lacks one.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseManifest } from "@prismshadow/penguin-core/kernel";
import type { ContributionsResponse, PluginLibraryResponse } from "../src/api/types.js";
import { PluginHost } from "../src/plugin/host.js";
import { apiClient, createTestApp, loginAdmin } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const pluginsRoot = path.resolve(import.meta.dirname, "../../../plugins");

describe("quick start", () => {
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;

  beforeEach(async () => {
    const plugins = new PluginHost();
    plugins.use({
      specifier: "demo",
      modules: [
        {
          manifest: parseManifest({
            name: "DemoPlugin",
            requires: {},
            provides: {},
            contributes: {
              "WebModule.quickStarts": [
                { id: "demo.quick-start", prompt: "Show it", promptZh: "演示一下", surface: "x" },
              ],
            },
            children: [],
          }),
          create: () => ({ api: {} }),
        },
      ],
      replaces: [],
    });
    t = await createTestApp({ plugins });
    api = apiClient(t.app, (await loginAdmin(t.app)).cookie);
  });
  afterEach(() => t.cleanup());

  it("lists a module plugin's demo with the contributions, named by its module", async () => {
    const body = (await (await api.get("/api/contributions")).json()) as ContributionsResponse;
    expect(body.quickStarts).toEqual([
      {
        id: "demo.quick-start",
        from: "DemoPlugin",
        prompt: "Show it",
        promptZh: "演示一下",
        surface: "x",
      },
    ]);
  });

  it("lists a library plugin's demo with the library", async () => {
    const body = (await (await api.get("/api/plugins")).json()) as PluginLibraryResponse;
    const goal = body.groups.flatMap((g) => g.plugins).find((p) => p.name === "goal");
    expect(goal?.quickStart).toMatchObject({ goal: true });
    expect(goal?.quickStart?.prompt.length).toBeGreaterThan(0);
  });

  it("every builtin module plugin contributes a demo", () => {
    const modulePlugins = fs
      .readdirSync(pluginsRoot)
      .filter((name) => fs.existsSync(path.join(pluginsRoot, name, "src", "index.ts")));
    expect(modulePlugins.length).toBeGreaterThan(0);
    for (const name of modulePlugins) {
      const source = fs.readFileSync(path.join(pluginsRoot, name, "src", "index.ts"), "utf8");
      expect(source, name).toContain('"WebModule.quickStarts"');
    }
  });
});
