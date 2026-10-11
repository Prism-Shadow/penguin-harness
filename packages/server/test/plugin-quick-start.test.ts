/**
 * A library plugin carries its quick start in its package.json (`penguin.quick_start`), listed
 * on GET /api/plugins. The page only pre-fills a draft from it, so what is checked here is that
 * the demo reaches it.
 * Module plugins contribute their demo through WebModule.quickStarts.
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
                { id: "demo.quick-start", prompt: "Show it", promptZh: "演示一下" },
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
      .filter((name) =>
        ["sandbox-bwrap", "sandbox-dsh", "sandbox-seatbelt", "sandbox-wsl"].includes(name),
      );
    expect(modulePlugins.length).toBeGreaterThan(0);
    for (const name of modulePlugins) {
      // The modules' manifests may sit in any source file of the package, not only its index.
      const src = path.join(pluginsRoot, name, "src");
      const source = fs
        .readdirSync(src)
        .filter((f) => f.endsWith(".ts"))
        .map((f) => fs.readFileSync(path.join(src, f), "utf8"))
        .join("\n");
      expect(source, name).toContain('"WebModule.quickStarts"');
    }
  });
});
