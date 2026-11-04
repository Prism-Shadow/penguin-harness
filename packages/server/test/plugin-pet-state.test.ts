import { describe, it, expect, afterEach } from "vitest";
import { mergePetState, mergeState } from "../src/plugin/pet-state.js";
import { PluginHost } from "../src/plugin/host.js";
import { apiClient, createTestApp, loginAdmin, provisionUser } from "./helpers.js";
import type { ModuleDef } from "@prismshadow/penguin-core/kernel";
import { parseManifest } from "@prismshadow/penguin-core/kernel";
import type { TestApp } from "./helpers.js";

describe("mergePetState", () => {
  it("merges a facet shallowly and keeps the other facet", () => {
    const stored = { pet: { name: "Mochi", fullness: 40 }, mood: { doing: "walk" } };
    const next = mergePetState(stored, { pet: { fullness: 60 } });
    expect(next).toEqual({ pet: { name: "Mochi", fullness: 60 }, mood: { doing: "walk" } });
  });

  it("clamps the fullness into 0–100 and rounds it", () => {
    expect(mergePetState({}, { pet: { fullness: 150 } })).toEqual({ pet: { fullness: 100 } });
    expect(mergePetState({}, { pet: { fullness: -3 } })).toEqual({ pet: { fullness: 0 } });
    expect(mergePetState({}, { pet: { fullness: 33.6 } })).toEqual({ pet: { fullness: 34 } });
  });

  it("drops the fullness when the update does not carry a number", () => {
    const stored = { pet: { name: "Mochi", fullness: 40 } };
    expect(mergePetState(stored, { pet: { fullness: "many" } })).toEqual({ pet: { name: "Mochi" } });
  });

  it("drops a facet written null, and keeps unknown facets as written", () => {
    const stored = { pet: { name: "Mochi" }, mood: { doing: "sit" }, extra: { note: 1 } };
    const next = mergePetState(stored, { mood: null, extra: { note: 2 } });
    expect(next).toEqual({ pet: { name: "Mochi" }, extra: { note: 2 } });
  });

  it("merges a null inner key as a drop", () => {
    const next = mergePetState({ mood: { doing: "idle", bubble: "hi" } }, { mood: { bubble: null } });
    expect(next).toEqual({ mood: { doing: "idle" } });
  });

  it("starts from nothing when the stored document is not an object", () => {
    expect(mergePetState(null, { pet: { name: "Mochi" } })).toEqual({ pet: { name: "Mochi" } });
    expect(mergePetState("old", { pet: { name: "Mochi" } })).toEqual({ pet: { name: "Mochi" } });
  });

  it("mergeState is the generic alias the routes run", () => {
    expect(mergeState({}, { pet: { fullness: 60 } })).toEqual(
      mergePetState({}, { pet: { fullness: 60 } }),
    );
  });
});

describe("plugin state routes (e2e)", () => {
  let t: TestApp | undefined;
  afterEach(async () => {
    await t?.cleanup();
    t = undefined;
  });

  function createModule(name: string): ModuleDef {
    return {
      manifest: parseManifest({
        name,
        requires: {},
        provides: {},
        contributes: {},
        children: [],
      }),
      create: () => ({ api: {} }),
    };
  }

  it("answers GET with an empty document, PATCH merges and reads back what it wrote", async () => {
    const host = new PluginHost();
    host.use({ specifier: "@acme/pet", modules: [createModule("AcmePet")], replaces: [] });
    t = await createTestApp({ plugins: host });
    const app = t;
    const { cookie } = await loginAdmin(app.app);
    const client = apiClient(app.app, cookie);

    const first = await client.get("/api/plugins/@acme/pet/state");
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ package: "@acme/pet", state: {} });

    const patch = await client.patch("/api/plugins/@acme/pet/state", {
      pet: { name: "Mochi", fullness: 40 },
    });
    expect(patch.status).toBe(200);
    expect(await patch.json()).toEqual({
      package: "@acme/pet",
      state: { pet: { name: "Mochi", fullness: 40 } },
    });

    const second = await client.patch("/api/plugins/@acme/pet/state", {
      mood: { doing: "walk" },
    });
    expect(await second.json()).toEqual({
      package: "@acme/pet",
      state: { pet: { name: "Mochi", fullness: 40 }, mood: { doing: "walk" } },
    });
  });

  it("answers 404 for a package no loaded plugin is behind", async () => {
    const host = new PluginHost();
    host.use({ specifier: "@acme/pet", modules: [createModule("AcmePet")], replaces: [] });
    t = await createTestApp({ plugins: host });
    const app = t;
    const { cookie } = await loginAdmin(app.app);
    const client = apiClient(app.app, cookie);
    const resp = await client.get("/api/plugins/@other/thing/state");
    expect(resp.status).toBe(404);
  });

  it("answers 400 when the PATCH body is not a JSON object", async () => {
    const host = new PluginHost();
    host.use({ specifier: "@acme/pet", modules: [createModule("AcmePet")], replaces: [] });
    t = await createTestApp({ plugins: host });
    const app = t;
    const { cookie } = await loginAdmin(app.app);
    const client = apiClient(app.app, cookie);
    const resp = await client.patch("/api/plugins/@acme/pet/state", [1, 2]);
    expect(resp.status).toBe(400);
  });

  it("needs a signed-in user", async () => {
    const host = new PluginHost();
    host.use({ specifier: "@acme/pet", modules: [createModule("AcmePet")], replaces: [] });
    t = await createTestApp({ plugins: host });
    const app = t;
    const client = apiClient(app.app, "");
    const resp = await client.get("/api/plugins/@acme/pet/state");
    expect(resp.status).toBe(401);
  });
});
