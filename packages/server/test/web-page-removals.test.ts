/**
 * Page removals on the server side: a module's `WebModule.pageRemovals` contribution reaches
 * GET /api/contributions as data (id, contributing module, key), none without it, and an entry
 * the slot's type does not accept — a key that is not a string, a field the slot does not
 * declare — is refused by the boot check, naming the contribution.
 */
import { afterEach, describe, expect, it } from "vitest";
import { boot, initialDoc, parseManifest } from "@prismshadow/penguin-core/kernel";
import type { ModuleDef } from "@prismshadow/penguin-core/kernel";
import { HotResources } from "@prismshadow/penguin-hmr";
import type { ContributionsResponse } from "../src/api/types.js";
import { HMR_INTERFACES_RESOURCE_ID, PENGUIN_FAMILY } from "../src/hmr/capabilities.js";
import { packagedPlatform } from "../src/hmr/platform.js";
import { PluginHost, PLUGINS_RESOURCE_ID } from "../src/plugin/host.js";
import { apiClient, createTestApp, loginAdmin } from "./helpers.js";
import type { TestApp } from "./helpers.js";

/** A plugin module that only contributes page removals. */
function removing(entries: Array<Record<string, unknown>>): PluginHost {
  const def: ModuleDef = {
    manifest: parseManifest({
      name: "NoEvaluationCenter",
      requires: {},
      provides: {},
      contributes: {
        "WebModule.pageRemovals": entries.map((e, i) => ({ id: `removal.${i}`, ...e })),
      },
      children: [],
    }),
    create: () => ({ api: {}, bind: {} }),
  };
  const host = new PluginHost();
  host.use({ specifier: "test-removal", modules: [def], replaces: [] });
  return host;
}

/** Boots the packaged platform's tree with the host's plugins: the check runs before anything is built. */
function bootWith(host: PluginHost) {
  const resources = new HotResources();
  resources.register(HMR_INTERFACES_RESOURCE_ID, { family: PENGUIN_FAMILY });
  resources.register(PLUGINS_RESOURCE_ID, host);
  return boot(
    packagedPlatform.impl,
    packagedPlatform.iface,
    initialDoc(packagedPlatform.iface, { motd: "m" }),
    resources,
  );
}

describe("web page removals", () => {
  let t: TestApp | undefined;
  afterEach(async () => {
    await t?.cleanup();
    t = undefined;
  });

  it("serves a plugin's page removal, and none without the plugin", async () => {
    t = await createTestApp();
    const bare = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    const none = (await (await bare.get("/api/contributions")).json()) as ContributionsResponse;
    expect(none.pageRemovals).toEqual([]);
    await t.cleanup();

    t = await createTestApp({ plugins: removing([{ key: "benchmark" }]) });
    const admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    const res = await admin.get("/api/contributions");
    expect(res.status).toBe(200);
    const body = (await res.json()) as ContributionsResponse;
    expect(body.pageRemovals).toEqual([
      { id: "removal.0", from: "NoEvaluationCenter", key: "benchmark" },
    ]);
  });

  it("refuses a removal whose key is not a string", async () => {
    await expect(bootWith(removing([{ key: 7 }]))).rejects.toThrow(
      /contribution 'removal\.0' to 'WebModule\.pageRemovals'/,
    );
  });

  it("refuses a removal carrying a field the slot does not declare", async () => {
    await expect(bootWith(removing([{ key: "benchmark", path: "/benchmark" }]))).rejects.toThrow(
      /contribution 'removal\.0' to 'WebModule\.pageRemovals'/,
    );
  });
});
