/**
 * The renderer a server-contributed surface names, read back by GET /api/contributions: an iframe
 * of a document its module serves is the only one there is.
 *
 * - Given a plugin whose page names an iframe, the answer carries the page as data (id,
 *   contributing module, key, path, renderer).
 * - Given a plugin whose page and Agent settings tab name a `builtin` renderer, neither fits its
 *   slot: both are dropped and named in the log, the plugin and the App stay, and the answer
 *   carries neither — beside the other plugin's iframe page, which is unaffected.
 * - The answer has no file renderer rules at all.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseManifest } from "@prismshadow/penguin-core/kernel";
import type { ModuleDef } from "@prismshadow/penguin-core/kernel";
import type { ContributionsResponse } from "../src/api/types.js";
import { PluginHost } from "../src/plugin/host.js";
import { apiClient, createTestApp, loginAdmin } from "./helpers.js";
import type { TestApp } from "./helpers.js";

/** A module that only contributes to the web slots. */
function webModule(name: string, contributes: Record<string, unknown[]>): ModuleDef {
  return {
    manifest: parseManifest({ name, requires: {}, provides: {}, contributes, children: [] }),
    create: () => ({ api: {}, bind: {} }),
  };
}

const REPORTS_PAGE = {
  id: "reports.page",
  key: "reports",
  path: "/reports",
  nav: "none",
  admin: false,
  renderer: { iframe: { src: "/api/reports/ui/index.html", namespace: "reports" } },
};

function plugins(): PluginHost {
  const host = new PluginHost();
  host.use({
    specifier: "test-reports",
    modules: [webModule("ReportsPages", { "WebModule.pages": [REPORTS_PAGE] })],
    replaces: [],
  });
  host.use({
    specifier: "test-legacy",
    modules: [
      webModule("LegacyPages", {
        "WebModule.pages": [
          {
            id: "legacy.page",
            key: "legacy",
            path: "/legacy",
            nav: "none",
            admin: false,
            renderer: { builtin: "LegacyPage" },
          },
        ],
        "WebModule.agentTabs": [
          { id: "legacy.tab", key: "legacy", order: 10, renderer: { builtin: "LegacyTab" } },
        ],
      }),
    ],
    replaces: [],
  });
  return host;
}

describe("the renderer of a server-contributed surface", () => {
  let t: TestApp | undefined;
  afterEach(async () => {
    await t?.cleanup();
    t = undefined;
  });

  it("serves an iframe page, drops a builtin page and tab naming them in the log, and sends no file renderer rules", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    let logged: string;
    try {
      t = await createTestApp({ plugins: plugins() });
      logged = log.mock.calls.flat().join("\n");
    } finally {
      log.mockRestore();
    }
    const admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    const res = await admin.get("/api/contributions");
    expect(res.status).toBe(200);
    const body = (await res.json()) as ContributionsResponse;
    expect(body.pages).toEqual([{ ...REPORTS_PAGE, from: "ReportsPages" }]);
    expect(body.agentTabs).toEqual([]);
    expect(body).not.toHaveProperty("fileRenderers");
    expect(logged).toMatch(
      /plugin 'test-legacy' runs without .*LegacyPages: contribution 'legacy\.page' to 'WebModule\.pages'/,
    );
    expect(logged).toMatch(/contribution 'legacy\.tab' to 'WebModule\.agentTabs'/);
    expect(logged).not.toMatch(/plugin 'test-reports'/);
  });
});
