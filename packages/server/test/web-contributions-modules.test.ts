/**
 * GET /api/contributions names the server modules plugins run in this generation (`modules`),
 * which is what the Web App draws a plugin's web half on.
 *
 * - Given no plugin, it names none; the platform's own modules are never listed.
 * - Given a plugin that runs, its modules are listed — also when this build dropped one of its
 *   contributions and runs the rest of it.
 * - Given a plugin this build left out of the generation, none of its modules is listed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseManifest, type ModuleDef } from "@prismshadow/penguin-core/kernel";
import type { ContributionsResponse } from "../src/api/types.js";
import { PluginHost } from "../src/plugin/host.js";
import { apiClient, createTestApp, loginAdmin } from "./helpers.js";
import type { TestApp } from "./helpers.js";

/** A plugin module with the given manifest, providing whatever it declares as an empty object. */
const moduleOf = (
  manifest: Record<string, unknown> & { name: string; provides: Record<string, string> },
): ModuleDef => ({
  manifest: parseManifest({ requires: {}, contributes: {}, children: [], ...manifest }),
  create: () => ({
    api: Object.fromEntries(Object.keys(manifest.provides).map((alias) => [alias, {}])),
  }),
});

const board = moduleOf({
  name: "BoardModule",
  requires: {},
  provides: {},
  contributes: {},
  children: [],
});
/** Contributes to a slot this build lacks: the contribution is dropped, the module runs. */
const partial = moduleOf({
  name: "PartialModule",
  requires: {},
  provides: {},
  contributes: { "nowhere.slot": [{ id: "partial.x" }] },
  children: [],
});
/** Stands in for a platform node under an interface no table carries: left out. */
const unmet = moduleOf({
  name: "ServerSettingsRepo",
  requires: {},
  provides: { Settings: "@prismshadow/penguin-server#Nope" },
  contributes: {},
  children: [],
});

async function modulesOf(t: TestApp): Promise<string[] | undefined> {
  const admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
  const res = await admin.get("/api/contributions");
  expect(res.status).toBe(200);
  return ((await res.json()) as ContributionsResponse).modules;
}

describe("the server modules /api/contributions names", () => {
  let t: TestApp | undefined;
  afterEach(async () => {
    await t?.cleanup();
    t = undefined;
    vi.restoreAllMocks();
  });

  it("names none without a plugin", async () => {
    t = await createTestApp();
    expect(await modulesOf(t)).toEqual([]);
  });

  it("names a running plugin's modules, and none of a plugin this build left out", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const host = new PluginHost();
    host.use({ specifier: "@acme/board", modules: [board], replaces: [] });
    host.use({ specifier: "@acme/partial", modules: [partial], replaces: [] });
    host.use({ specifier: "@acme/unmet", modules: [], replaces: [unmet] });
    t = await createTestApp({ plugins: host });
    expect(await modulesOf(t)).toEqual(["BoardModule", "PartialModule"]);
  });
});
