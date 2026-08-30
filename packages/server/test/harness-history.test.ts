/**
 * The harness history: every version persistVersion commits is appended to
 * <root>/hmr/history.json (newest first, HISTORY_KEEP entries), read back defensively,
 * and served with the current commit by GET /api/version/history.
 */
import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import {
  HISTORY_KEEP,
  appendHarnessHistory,
  readHarnessHistory,
  withCurrent,
} from "../src/hmr/manifest.js";
import type { VersionHistoryDiffResponse, VersionHistoryResponse } from "../src/api/types.js";
import { diffIfaces } from "../src/hmr/ifaces-diff.js";
import { apiClient, createTestApp, loginAdmin, makeTempRoot, type TestApp } from "./helpers.js";

const entry = (n: number, source: { repo: string; revision: string } | null = null) => ({
  source,
  pushedAt: new Date(Date.UTC(2026, 7, 30, 0, 0, n)).toISOString(),
  bundles: {
    platform: `store/platform/p${n}.mjs`,
    cli: `store/cli/c${n}.mjs`,
    web: `store/web/w${n}.webz`,
  },
  ifaces: null,
});

describe("harness history file", () => {
  it("appends newest first and keeps HISTORY_KEEP entries", async () => {
    const root = await makeTempRoot();
    for (let i = 0; i < HISTORY_KEEP + 3; i++) await appendHarnessHistory(root, entry(i));
    const entries = await readHarnessHistory(root);
    expect(entries).toHaveLength(HISTORY_KEEP);
    expect(entries[0]!.bundles.platform).toBe(`store/platform/p${HISTORY_KEEP + 2}.mjs`);
    expect(entries[HISTORY_KEEP - 1]!.bundles.platform).toBe("store/platform/p3.mjs");
  });

  it("the committed version is folded in when the history lacks it (a runtime older than the record)", () => {
    const current = {
      source: null,
      pushedAt: "2026-08-30T00:00:00.000Z",
      bundles: entry(9).bundles,
      ifaces: null,
    };
    expect(withCurrent([], current)).toEqual([
      { source: null, pushedAt: current.pushedAt, bundles: current.bundles, ifaces: null },
    ]);
    expect(withCurrent([entry(9)], current)).toEqual([entry(9)]); // already recorded: not doubled
    expect(withCurrent([entry(1)], current).map((e) => e.bundles.platform)).toEqual([
      "store/platform/p9.mjs",
      "store/platform/p1.mjs",
    ]);
    expect(withCurrent([entry(1)], null)).toEqual([entry(1)]);
  });

  it("a missing, corrupt, or partly malformed file degrades to what still parses", async () => {
    const root = await makeTempRoot();
    expect(await readHarnessHistory(root)).toEqual([]);
    await fs.mkdir(path.join(root, "hmr"), { recursive: true });
    await fs.writeFile(path.join(root, "hmr", "history.json"), "{ not json");
    expect(await readHarnessHistory(root)).toEqual([]);
    await fs.writeFile(
      path.join(root, "hmr", "history.json"),
      JSON.stringify([
        entry(1, { repo: "git@x:y.git", revision: "v0.2.9-3-gabc" }),
        { pushedAt: "2026-01-01T00:00:00.000Z" }, // no artifact at all: not a version
        { bundles: { platform: "store/platform/z.mjs" } }, // no time: a version that predates the stamp
        { ...entry(2), source: { repo: "only-half" } }, // half a provenance names nothing
      ]),
    );
    const entries = await readHarnessHistory(root);
    expect(entries.map((e) => e.bundles.platform)).toEqual([
      "store/platform/p1.mjs",
      "store/platform/z.mjs",
      "store/platform/p2.mjs",
    ]);
    expect(entries[0]!.source).toEqual({ repo: "git@x:y.git", revision: "v0.2.9-3-gabc" });
    expect(entries[1]!.pushedAt).toBeNull();
    expect(entries[2]!.source).toBeNull();
  });
});

const TABLE_A = {
  ifaces: {
    "@x#Users": {
      name: "Users",
      methods: { findById: { params: [{ data: "string" }], returns: { data: "string" } } },
      slots: {},
    },
  },
  types: { "@x#Row": { id: "string" } },
  modules: {
    UsersRepo: {
      name: "UsersRepo",
      kind: "component",
      requires: {},
      provides: { Users: "@x#Users" },
      contributes: {},
      children: [],
    },
  },
};
const TABLE_B = {
  ifaces: {
    "@x#Users": {
      name: "Users",
      methods: {
        findById: { params: [{ data: "string" }], returns: { data: "string|null" } },
        count: { params: [], returns: { data: "number" } },
      },
      slots: {},
    },
    "@x#Clock": {
      name: "Clock",
      methods: { now: { params: [], returns: { data: "number" } } },
      slots: {},
    },
  },
  types: { "@x#Row": { id: "string", name: "string" }, "@x#Extra": { n: "number" } },
  modules: {
    UsersRepo: {
      name: "UsersRepo",
      kind: "component",
      requires: { clock: { iface: "@x#Clock", from: "SystemClock" } },
      provides: { Users: "@x#Users" },
      contributes: {},
      children: [],
    },
    SystemClock: {
      name: "SystemClock",
      kind: "component",
      requires: {},
      provides: { Clock: "@x#Clock" },
      contributes: {},
      children: [],
    },
  },
};

describe("interface table diff", () => {
  it("names the nodes and interfaces that appeared, vanished, or changed, member by member", () => {
    const d = diffIfaces({ hash: "a", ...TABLE_A } as never, { hash: "b", ...TABLE_B } as never);
    expect(d.from).toBe("a");
    expect(d.to).toBe("b");
    expect(d.modules.map((m) => [m.name, m.change])).toEqual([
      ["SystemClock", "added"],
      ["UsersRepo", "changed"],
    ]);
    expect(d.modules[1]!.requires).toEqual([{ name: "clock", change: "added" }]);
    expect(d.ifaces.map((i) => [i.key, i.change])).toEqual([
      ["@x#Clock", "added"],
      ["@x#Users", "changed"],
    ]);
    expect(d.ifaces[1]!.methods).toEqual([
      { name: "count", change: "added" },
      { name: "findById", change: "changed" },
    ]);
    expect(d.types).toEqual({ added: 1, removed: 0, changed: 1 });
    // The other direction is the mirror, and a missing side is "everything appeared".
    expect(
      diffIfaces({ hash: "b", ...TABLE_B } as never, { hash: "a", ...TABLE_A } as never).modules[0],
    ).toMatchObject({ name: "SystemClock", change: "removed" });
    expect(diffIfaces(null, { hash: "a", ...TABLE_A } as never).ifaces).toEqual([
      { key: "@x#Users", change: "added", methods: [], fields: [], slots: [] },
    ]);
    // Identical tables: nothing.
    const same = diffIfaces({ hash: "a", ...TABLE_A } as never, { hash: "a", ...TABLE_A } as never);
    expect(same.modules).toEqual([]);
    expect(same.ifaces).toEqual([]);
  });
});

describe("GET /api/version/history", () => {
  let t: TestApp | null = null;
  afterEach(async () => {
    await t?.cleanup();
    t = null;
  });

  it("serves the committed versions newest first, with the current commit", async () => {
    t = await createTestApp({
      beforeSeed: async (root) => {
        await appendHarnessHistory(root, entry(1));
        await appendHarnessHistory(root, entry(2, { repo: "r", revision: "v1" }));
      },
    });
    const admin = await loginAdmin(t.app);
    const res = await apiClient(t.app, admin.cookie).get("/api/version/history");
    expect(res.status).toBe(200);
    const body = (await res.json()) as VersionHistoryResponse;
    expect(body.current).toBeNull(); // nothing pushed to this root's store
    expect(body.entries.map((e) => e.pushedAt)).toEqual([entry(2).pushedAt, entry(1).pushedAt]);
    expect(body.entries[0]!.source).toEqual({ repo: "r", revision: "v1" });
  });

  it("serves a stored table by hash and the diff between two stored tables", async () => {
    const hashA = "a".repeat(64);
    const hashB = "b".repeat(64);
    t = await createTestApp({
      beforeSeed: async (root) => {
        const dir = path.join(root, "hmr", "store", "ifaces");
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(
          path.join(dir, `${hashA}.json`),
          JSON.stringify({ hash: hashA, ...TABLE_A }),
        );
        await fs.writeFile(
          path.join(dir, `${hashB}.json`),
          JSON.stringify({ hash: hashB, ...TABLE_B }),
        );
      },
    });
    const admin = await loginAdmin(t.app);
    const client = apiClient(t.app, admin.cookie);
    const table = (await (await client.get(`/api/version/history/ifaces/${hashA}`)).json()) as {
      hash: string;
    };
    expect(table.hash).toBe(hashA);
    expect((await client.get(`/api/version/history/ifaces/${"c".repeat(64)}`)).status).toBe(404);
    expect((await client.get("/api/version/history/ifaces/..%2F..%2Fharness")).status).toBe(404);
    const diff = (await (
      await client.get(`/api/version/history/diff?from=${hashA}&to=${hashB}`)
    ).json()) as VersionHistoryDiffResponse;
    expect(diff.modules.map((m) => m.name)).toEqual(["SystemClock", "UsersRepo"]);
    const fromNothing = (await (
      await client.get(`/api/version/history/diff?from=none&to=${hashA}`)
    ).json()) as VersionHistoryDiffResponse;
    expect(fromNothing.from).toBeNull();
    expect(fromNothing.modules).toEqual([
      expect.objectContaining({ name: "UsersRepo", change: "added" }),
    ]);
  });

  it("an empty root has no history and no current version", async () => {
    t = await createTestApp();
    const admin = await loginAdmin(t.app);
    const body = (await (
      await apiClient(t.app, admin.cookie).get("/api/version/history")
    ).json()) as VersionHistoryResponse;
    expect(body).toEqual({ current: null, entries: [] });
  });
});
