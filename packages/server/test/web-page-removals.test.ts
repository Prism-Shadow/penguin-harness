/**
 * Page removals on the server side: a module's `WebModule.pageRemovals` contribution reaches
 * GET /api/contributions as data (id, contributing module, key), none without it, and an entry
 * the slot's type does not accept — a key that is not a string, a field the slot does not
 * declare — is refused by the boot check, naming the contribution.
 */
import fs from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { parseManifest } from "@prismshadow/penguin-core/kernel";
import type { ModuleDef } from "@prismshadow/penguin-core/kernel";
import type { ContributionsResponse } from "../src/api/types.js";
import { PluginHost } from "../src/plugin/host.js";
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

/** The boot error of an App with the host's plugins; the check runs before anything is built. */
async function refusal(host: PluginHost): Promise<unknown> {
  let root: string | undefined;
  try {
    await createTestApp({ plugins: host, beforeSeed: async (r) => void (root = r) });
  } catch (err) {
    return err;
  } finally {
    if (root !== undefined) await fs.rm(root, { recursive: true, force: true });
  }
  throw new Error("the App booted");
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
    expect(String(await refusal(removing([{ key: 7 }])))).toMatch(
      /contribution 'removal\.0' to 'WebModule\.pageRemovals'/,
    );
  });

  it("refuses a removal carrying a field the slot does not declare", async () => {
    const err = await refusal(removing([{ key: "benchmark", path: "/benchmark" }]));
    expect(String(err)).toMatch(/contribution 'removal\.0' to 'WebModule\.pageRemovals'/);
  });
});
