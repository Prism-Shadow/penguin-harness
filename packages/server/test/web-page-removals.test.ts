/**
 * Page removals on the server side: a module's `WebModule.pageRemovals` contribution reaches
 * GET /api/contributions as data (id, contributing module, key), none without it, and an entry
 * the slot's type does not accept — a key that is not a string, a field the slot does not
 * declare — fails the boot check. A plugin's malformed contribution does not refuse the App
 * (plugin/unsatisfied.ts): it is dropped and named in the log, the plugin and the App stay, and
 * the answer carries no removal.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
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

/**
 * The removals an App with the host's plugins answers, and what its boot logged about dropped
 * contributions.
 */
async function bootedWith(
  host: PluginHost,
): Promise<{ t: TestApp; removals: unknown; logged: string }> {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  try {
    const t = await createTestApp({ plugins: host });
    const admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    const body = (await (await admin.get("/api/contributions")).json()) as ContributionsResponse;
    return { t, removals: body.pageRemovals, logged: warn.mock.calls.flat().join("\n") };
  } finally {
    warn.mockRestore();
  }
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

  it("drops a removal whose key is not a string, and boots without it", async () => {
    const booted = await bootedWith(removing([{ key: 7 }]));
    t = booted.t;
    expect(booted.removals).toEqual([]);
    expect(booted.logged).toMatch(
      /plugin 'test-removal' runs without .*NoEvaluationCenter: contribution 'removal\.0' to 'WebModule\.pageRemovals'/,
    );
  });

  it("drops a removal carrying a field the slot does not declare", async () => {
    const booted = await bootedWith(removing([{ key: "benchmark", path: "/benchmark" }]));
    t = booted.t;
    expect(booted.removals).toEqual([]);
    expect(booted.logged).toMatch(
      /plugin 'test-removal' runs without .*NoEvaluationCenter: contribution 'removal\.0' to 'WebModule\.pageRemovals'/,
    );
  });
});
