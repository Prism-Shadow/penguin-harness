/**
 * The account's keyboard shortcut overrides, stored under `ui_prefs.keybindings`.
 *
 * The validator's cases pin the documented shape and each bound; the route cases go through the
 * real `PUT /api/me/prefs`, because the two claims that matter are about the route: a rejected
 * write stores nothing, and an accepted one round-trips through GET without disturbing the other
 * preferences merged into the same object.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";
import {
  KEYBINDINGS_BYTES_MAX,
  KEYBINDINGS_CHORD_MAX,
  KEYBINDINGS_ID_MAX,
  KEYBINDINGS_SECTION_MAX,
  validateKeybindings,
} from "../src/services/keybindings.js";
import { HttpError } from "../src/http/errors.js";

const rejects = (value: unknown, pattern: RegExp): void => {
  try {
    validateKeybindings(value);
  } catch (err) {
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(400);
    expect((err as HttpError).code).toBe("invalid_keybindings");
    expect((err as HttpError).message).toMatch(pattern);
    return;
  }
  throw new Error(`expected ${JSON.stringify(value)} to be rejected`);
};

describe("validateKeybindings", () => {
  it("accepts the documented shape and returns it normalized", () => {
    const doc = {
      v: 1,
      mac: { "terminal.close": "Mod+Alt+KeyW", "editor.save": null },
      windows: { "dock.toggleRight": "Mod+Alt+KeyB" },
      linux: { "future.command.here": "F5" },
    };
    expect(validateKeybindings(doc)).toEqual(doc);
    expect(validateKeybindings({ v: 1 })).toEqual({ v: 1 });
  });

  it("drops sections it does not know rather than storing them", () => {
    expect(validateKeybindings({ v: 1, ios: { "terminal.close": "Mod+KeyW" }, extra: 1 })).toEqual({
      v: 1,
    });
  });

  it("rejects a non-object, a wrong version and a malformed section", () => {
    rejects(null, /must be an object/);
    rejects([], /must be an object/);
    rejects("Mod+KeyW", /must be an object/);
    rejects({ v: 2 }, /v must be 1/);
    rejects({}, /v must be 1/);
    rejects({ v: 1, mac: [] }, /mac must be an object/);
    rejects({ v: 1, mac: null }, /mac must be an object/);
  });

  it("rejects an id outside the grammar or over the length cap", () => {
    rejects({ v: 1, mac: { terminal: null } }, /invalid command id/);
    rejects({ v: 1, mac: { "Terminal.close": null } }, /invalid command id/);
    rejects({ v: 1, mac: { "terminal..close": null } }, /invalid command id/);
    rejects({ v: 1, mac: { "terminal.close ": null } }, /invalid command id/);
    const long = `a.${"b".repeat(KEYBINDINGS_ID_MAX)}`;
    rejects({ v: 1, mac: { [long]: null } }, /invalid command id/);
  });

  it("rejects a chord outside the grammar, a non-string, or one over the length cap", () => {
    rejects({ v: 1, mac: { "terminal.close": "Cmd-W" } }, /must be null or a chord string/);
    rejects(
      { v: 1, mac: { "terminal.close": "Shift+Mod+KeyW" } },
      /must be null or a chord string/,
    );
    rejects({ v: 1, mac: { "terminal.close": 7 } }, /must be null or a chord string/);
    rejects({ v: 1, mac: { "terminal.close": "" } }, /must be null or a chord string/);
    rejects(
      { v: 1, mac: { "terminal.close": `Mod+${"K".repeat(KEYBINDINGS_CHORD_MAX)}` } },
      /must be null or a chord string/,
    );
  });

  it("rejects more entries than a section may hold, and a document over the byte cap", () => {
    const tooMany = Object.fromEntries(
      Array.from({ length: KEYBINDINGS_SECTION_MAX + 1 }, (_, i) => [`cmd.c${i}`, null]),
    );
    rejects({ v: 1, mac: tooMany }, /at most/);
    // Three full sections of maximal ids and chords exceed the byte cap while each stays legal.
    const id = (i: number) =>
      `a.${"b".repeat(KEYBINDINGS_ID_MAX - 4)}${String(i).padStart(2, "0")}`;
    const chord = `Mod+${"K".repeat(KEYBINDINGS_CHORD_MAX - 4)}`;
    const big = Object.fromEntries(
      Array.from({ length: KEYBINDINGS_SECTION_MAX }, (_, i) => [id(i), chord]),
    );
    expect(JSON.stringify({ v: 1, mac: big, windows: big, linux: big }).length).toBeGreaterThan(
      KEYBINDINGS_BYTES_MAX,
    );
    rejects({ v: 1, mac: big, windows: big, linux: big }, /bytes/);
  });
});

describe("PUT /api/me/prefs keybindings", () => {
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;

  beforeEach(async () => {
    t = await createTestApp();
    const { cookie } = await provisionUser(t.app, "kira");
    api = apiClient(t.app, cookie);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  const readPrefs = async (): Promise<Record<string, unknown>> => {
    const body = (await (await api.get("/api/me/prefs")).json()) as {
      prefs: Record<string, unknown>;
    };
    return body.prefs;
  };

  it("round-trips a valid document and leaves the other preferences alone", async () => {
    await api.put("/api/me/prefs", { lastProjectId: "default_project" });
    const doc = { v: 1, linux: { "terminal.close": "Mod+Alt+KeyW", "editor.save": null } };
    const res = await api.put("/api/me/prefs", { keybindings: doc });
    expect(res.status).toBe(200);
    expect(await readPrefs()).toEqual({ lastProjectId: "default_project", keybindings: doc });
  });

  it("stores nothing from a request whose document is invalid", async () => {
    await api.put("/api/me/prefs", { keybindings: { v: 1, linux: { "editor.save": null } } });
    const res = await api.put("/api/me/prefs", {
      lastProjectId: "other",
      keybindings: { v: 1, linux: { "editor.save": "Cmd-S" } },
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("invalid_keybindings");
    const prefs = await readPrefs();
    expect(prefs.keybindings).toEqual({ v: 1, linux: { "editor.save": null } });
    expect(prefs.lastProjectId).toBeUndefined();
  });

  it("is per user", async () => {
    await api.put("/api/me/prefs", { keybindings: { v: 1, mac: { "editor.save": null } } });
    const other = apiClient(t.app, (await provisionUser(t.app, "liam")).cookie);
    const theirs = (await (await other.get("/api/me/prefs")).json()) as { prefs: object };
    expect(theirs.prefs).toEqual({});
  });
});
