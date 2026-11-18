/**
 * The pet's state: the merge rules (pet-state.ts) and the pet's own state routes
 * (state-routes.ts) driven through a real Hono mount — the same prefix the contribution
 * declares, so the page's `?v=`-stamped reads and PATCHes answer the way the server mounts
 * them.
 */
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { mergePetState } from "../src/pet-state.js";
import { petStateChannel } from "../src/settings.js";
import type { SettingsStore } from "../src/settings.js";
import { petStateRoutes } from "../src/state-routes.js";

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

  it("keeps portions whole, coins fractional, and both non-negative", () => {
    expect(mergePetState({}, { pet: { food: 2.6 } })).toEqual({ pet: { food: 3 } });
    expect(mergePetState({}, { pet: { food: -1 } })).toEqual({ pet: { food: 0 } });
    expect(mergePetState({}, { pet: { coins: 1.239 } })).toEqual({ pet: { coins: 1.24 } });
    expect(mergePetState({}, { pet: { coins: -5 } })).toEqual({ pet: { coins: 0 } });
    expect(mergePetState({}, { pet: { food: "lots" } })).toEqual({ pet: {} });
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
});

/** The settings store, in memory: the shape `setup` is injected with. */
function fakeSettings(store: Map<string, string>): SettingsStore {
  return {
    get: (key) => store.get(key) ?? null,
    set: (key, value) => void store.set(key, value),
    watch: () => () => {},
  };
}

describe("petStateChannel over the settings store", () => {
  it("reads an absent key as an empty document and keeps the merged document under one key", () => {
    const store = new Map<string, string>();
    const state = petStateChannel(fakeSettings(store), "@penguinharness/pet");
    expect(state.read()).toEqual({});
    const next = state.merge({ pet: { name: "Mochi", fullness: 40 } });
    expect(next).toEqual({ pet: { name: "Mochi", fullness: 40 } });
    expect(store.get("plugin-state:@penguinharness/pet")).toBe(
      JSON.stringify({ pet: { name: "Mochi", fullness: 40 } }),
    );
    expect(state.read()).toEqual({ pet: { name: "Mochi", fullness: 40 } });
  });

  it("reads an unparsable stored document as empty, and a merge overwrites it", () => {
    const store = new Map<string, string>([["plugin-state:@penguinharness/pet", "{oops"]]);
    const state = petStateChannel(fakeSettings(store), "@penguinharness/pet");
    expect(state.read()).toEqual({});
    expect(state.merge({ pet: { name: "Mochi" } })).toEqual({ pet: { name: "Mochi" } });
  });
});

describe("the pet's state routes", () => {
  /** The app, mounted the way the server mounts a contributed route group. */
  function appWith(state: ReturnType<typeof petStateChannel>) {
    const app = new Hono();
    app.route("/api/plugins/@penguinharness/pet/state", petStateRoutes({ state }));
    return app;
  }

  it("answers GET with the document and PATCH merges and reads back what it wrote", async () => {
    const store = new Map<string, string>();
    const state = petStateChannel(fakeSettings(store), "@penguinharness/pet");
    const app = appWith(state);

    const first = await app.request("/api/plugins/@penguinharness/pet/state");
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ package: "@penguinharness/pet", state: {} });

    const patch = await app.request("/api/plugins/@penguinharness/pet/state", {
      method: "PATCH",
      body: JSON.stringify({ pet: { name: "Mochi", fullness: 40 } }),
      headers: { "content-type": "application/json" },
    });
    expect(patch.status).toBe(200);
    expect(await patch.json()).toEqual({
      package: "@penguinharness/pet",
      state: { pet: { name: "Mochi", fullness: 40 } },
    });

    const second = await app.request("/api/plugins/@penguinharness/pet/state", {
      method: "PATCH",
      body: JSON.stringify({ mood: { doing: "walk" } }),
      headers: { "content-type": "application/json" },
    });
    expect(await second.json()).toEqual({
      package: "@penguinharness/pet",
      state: { pet: { name: "Mochi", fullness: 40 }, mood: { doing: "walk" } },
    });
  });

  it("clamps through the merge: a PATCHed fullness lands in 0–100", async () => {
    const app = appWith(petStateChannel(fakeSettings(new Map()), "@penguinharness/pet"));
    const patch = await app.request("/api/plugins/@penguinharness/pet/state", {
      method: "PATCH",
      body: JSON.stringify({ pet: { fullness: 150 } }),
      headers: { "content-type": "application/json" },
    });
    expect(await patch.json()).toEqual({
      package: "@penguinharness/pet",
      state: { pet: { fullness: 100 } },
    });
  });

  it("answers 400 when the PATCH body is not a JSON object", async () => {
    const app = appWith(petStateChannel(fakeSettings(new Map()), "@penguinharness/pet"));
    for (const body of ["[1,2]", "5", "null", "{oops", `"text"`]) {
      const res = await app.request("/api/plugins/@penguinharness/pet/state", {
        method: "PATCH",
        body,
        headers: { "content-type": "application/json" },
      });
      expect(res.status).toBe(400);
    }
  });
});
