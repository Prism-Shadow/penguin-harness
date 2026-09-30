/**
 * The harness history is kept by the platform: every boot records the runtime's current
 * commit together with the booting platform's own interface table, under
 * <root>/harness-history/ — so the record is complete on any runtime old enough to boot
 * the platform, and never depends on the runtime knowing about it.
 */
import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { wire } from "@prismshadow/penguin-core/kernel";
import table from "../src/ifaces.json" with { type: "json" };
import {
  HarnessHistoryStore,
  HISTORY_KEEP,
  KEEP_VERSIONS,
} from "../src/services/harness-history.js";
import zlib from "node:zlib";
import { diffIfaces } from "@prismshadow/penguin-hmr";
import type { VersionHistoryDiffResponse, VersionHistoryResponse } from "../src/api/types.js";
import {
  apiClient,
  createTestApp,
  loginAdmin,
  makeTempRoot,
  provisionUser,
  type TestApp,
} from "./helpers.js";

const OWN_HASH = (table as { hash: string }).hash;

/** A runtime commit record, as harness.json would carry it. */
async function commit(
  root: string,
  n: number,
  source: { repo: string; revision: string } | null = null,
) {
  await fs.mkdir(path.join(root, "hmr"), { recursive: true });
  // The store's files behind the pointers, so the platform has something to keep.
  for (const [rel, body] of [
    [`store/platform/p${n}.mjs`, `export const platform = ${n};`],
    [`store/cli/c${n}.mjs`, `export const cli = ${n};`],
    [
      `store/web/w${n}.webz`,
      zlib.gzipSync(
        JSON.stringify({ files: { "index.html": Buffer.from(`<b>${n}</b>`).toString("base64") } }),
      ),
    ],
    [`assets/a${n}/node_modules/node-pty/spawn-helper`, "#!/bin/sh"],
  ] as Array<[string, string | Buffer]>) {
    await fs.mkdir(path.dirname(path.join(root, "hmr", rel)), { recursive: true });
    await fs.writeFile(path.join(root, "hmr", rel), body);
  }
  await fs.writeFile(
    path.join(root, "hmr", "harness.json"),
    JSON.stringify({
      platform: { bundle: `store/platform/p${n}.mjs` },
      cli: { bundle: `store/cli/c${n}.mjs` },
      web: { manifest: `store/web/w${n}.webz` },
      assets: { dir: `assets/a${n}` },
      ...(source ? { source } : {}),
      pushedAt: new Date(Date.UTC(2026, 7, 30, 0, 0, n)).toISOString(),
    }),
  );
}

/** What a rollback handed the runtime's upgrade channel, and what the runtime answered with. */
const pushed: Request[] = [];
const broadcasts: unknown[] = [];
let answer: () => Response = () =>
  new Response(JSON.stringify({ status: "ok", web: { rev: "r2" } }), { status: 200 });
/** Resolves when the test says the runtime's commit has landed (the swap that booted the platform is over). */
let landed: () => Promise<void> = async () => {};
const storeAt = (root: string) =>
  wire(HarnessHistoryStore, {
    paths: { root },
    clock: { now: () => new Date("2026-08-30T12:00:00Z") },
    log: { line: () => {} },
    hmrControl: {
      current: () => landed().then(() => ({})),
      endpoint: async (req: Request) => {
        pushed.push(req);
        return answer();
      },
    },
    channels: { broadcast: (...args: unknown[]) => broadcasts.push(args) },
  });

/** Boots the store the way the platform does: setup() defers the record to the commit. */
function bootedAt(root: string) {
  const store = storeAt(root);
  const disposers: Array<() => void> = [];
  store.setup({ effect: (fn: () => void) => disposers.push(fn) } as never);
  return { store, dispose: () => disposers.forEach((fn) => fn()) };
}

describe("harness history store", () => {
  it("records a boot once per version, with this platform's own table, newest first", async () => {
    const root = await makeTempRoot();
    const store = storeAt(root);
    // Nothing committed yet: a packaged boot, identified by its table.
    await store.record();
    let entries = await store.entries();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.bundles).toEqual({ platform: null, cli: null, web: null });
    expect(entries[0]!.ifaces?.hash).toBe(OWN_HASH);
    expect(entries[0]!.pushedAt).toBe("2026-08-30T12:00:00.000Z");
    // The same version booting again is the same line, not a second one.
    await store.record();
    expect(await store.entries()).toHaveLength(1);
    // A committed version: the runtime's record, plus the table.
    await commit(root, 1, { repo: "r", revision: "v1" });
    await store.record();
    await commit(root, 2);
    await store.record();
    entries = await store.entries();
    expect(entries.map((e) => e.bundles.platform)).toEqual([
      "store/platform/p2.mjs",
      "store/platform/p1.mjs",
      null,
    ]);
    expect(entries[1]!.source).toEqual({ repo: "r", revision: "v1" });
    expect(entries[1]!.pushedAt).toBe(new Date(Date.UTC(2026, 7, 30, 0, 0, 1)).toISOString());
    // The table itself is on disk under its hash, once.
    const stored = (await store.table(OWN_HASH)) as { hash: string };
    expect(stored.hash).toBe(OWN_HASH);
    expect(await store.table("f".repeat(64))).toBeNull();
    expect(await store.table("../../harness")).toBeNull();
  });

  it("never overwrites another platform's line: the boot before a push sees the previous commit", async () => {
    const root = await makeTempRoot();
    // The previous platform recorded version 1 with ITS table …
    await commit(root, 1);
    await fs.mkdir(path.join(root, "harness-history"), { recursive: true });
    const theirs = {
      source: null,
      pushedAt: "2026-08-29T00:00:00.000Z",
      bundles: {
        platform: "store/platform/p1.mjs",
        cli: "store/cli/c1.mjs",
        web: "store/web/w1.webz",
      },
      ifaces: { hash: "e".repeat(64), nodes: 1, interfaces: 1, types: 0 },
    };
    await fs.writeFile(
      path.join(root, "harness-history", "history.json"),
      JSON.stringify([theirs]),
    );
    // … and this platform boots while harness.json still says version 1.
    const store = storeAt(root);
    await store.record();
    expect(await store.entries()).toEqual([{ id: "p1-c1-w1", rollbackable: false, ...theirs }]);
    // Once the runtime commits version 2, the record is this platform's own line.
    await commit(root, 2);
    await store.record();
    const entries = await store.entries();
    expect(entries.map((e) => [e.bundles.platform, e.ifaces?.hash === OWN_HASH])).toEqual([
      ["store/platform/p2.mjs", true],
      ["store/platform/p1.mjs", false],
    ]);
  });

  it("keeps a committed version's body and hands it back to the runtime's own upgrade channel", async () => {
    const root = await makeTempRoot();
    const store = storeAt(root);
    await commit(root, 1, { repo: "r", revision: "v1" });
    await store.record();
    await commit(root, 2);
    await store.record();
    const entries = (await store.list()).entries;
    expect(entries.map((e) => [e.id, e.rollbackable])).toEqual([
      ["p2-c2-w2", true],
      ["p1-c1-w1", true],
    ]);
    // Rolling back hands the channel exactly what a deploy would post — the body a hand-over
    // forwards — with no network, token or bind address in between.
    pushed.length = 0;
    broadcasts.length = 0;
    expect(await store.rollback("p1-c1-w1")).toBe(true);
    expect(pushed).toHaveLength(1);
    expect(new URL(pushed[0]!.url).pathname).toBe("/api/hmr/upgrade");
    expect(pushed[0]!.headers.get("content-type")).toBe("application/gzip");
    expect(pushed[0]!.headers.get("authorization")).toBeNull();
    const payload = JSON.parse(
      zlib.gunzipSync(Buffer.from(await pushed[0]!.arrayBuffer())).toString("utf8"),
    ) as {
      platform: string;
      cli: string;
      web: { files: Record<string, string> };
      assets: { files: Record<string, string>; exec: string[] };
      source: { revision: string };
    };
    expect(payload.platform).toBe("export const platform = 1;");
    expect(payload.cli).toBe("export const cli = 1;");
    expect(Buffer.from(payload.web.files["index.html"]!, "base64").toString()).toBe("<b>1</b>");
    expect(payload.assets.exec).toEqual(["node_modules/node-pty/spawn-helper"]);
    expect(payload.source.revision).toBe("v1");
    // Live clients are told to reload, as they are for a push from outside.
    expect(broadcasts).toEqual([["user:", { type: "web_updated", rev: "r2" }, "server_event"]]);
    expect((await store.list()).lastRollback).toBeNull();
    // Nothing kept under that id: not a rollback.
    expect(await store.rollback("nope")).toBe(false);
    expect(await store.rollback("../etc")).toBe(false);
  });

  it("a push the runtime refuses is reported on the next read, in the runtime's words", async () => {
    const root = await makeTempRoot();
    const store = storeAt(root);
    await commit(root, 1);
    await store.record();
    await commit(root, 2);
    await store.record();
    answer = () => new Response(JSON.stringify({ status: "refused", reason: "no upgrade route" }));
    try {
      await expect(store.rollback("p1-c1-w1")).rejects.toThrow(/no upgrade route/);
      expect((await store.list()).lastRollback).toMatchObject({
        id: "p1-c1-w1",
        error: expect.stringContaining("no upgrade route") as string,
        at: "2026-08-30T12:00:00.000Z",
      });
      // The channel's own 400 (a body it could not parse) is a refusal too.
      answer = () => new Response("expected a gzip body", { status: 400 });
      await expect(store.rollback("p2-c2-w2")).rejects.toThrow(/400 expected a gzip body/);
      expect((await store.list()).lastRollback?.id).toBe("p2-c2-w2");
    } finally {
      answer = () =>
        new Response(JSON.stringify({ status: "ok", web: { rev: "r2" } }), { status: 200 });
    }
  });

  it("records a boot only once the runtime's commit has landed, and never after being put back", async () => {
    // Version 1 is committed and the platform booting is version 2's: while its boot is in
    // flight harness.json still names version 1, and no line may be written for it.
    const root = await makeTempRoot();
    await commit(root, 1);
    let commitLanded!: () => void;
    landed = () =>
      new Promise<void>((resolve) => {
        commitLanded = resolve;
      });
    try {
      const { store } = bootedAt(root);
      await new Promise((r) => setTimeout(r, 20));
      expect(await store.entries()).toEqual([]);
      await commit(root, 2);
      commitLanded();
      const entries = (await store.list()).entries;
      expect(entries.map((e) => e.bundles.platform)).toEqual(["store/platform/p2.mjs"]);
      // A generation the runtime put back (its boot failed) is disposed before the swap ends:
      // what harness.json names then is the previous version, and it stays unrecorded.
      const failed = bootedAt(root);
      failed.dispose();
      commitLanded();
      await new Promise((r) => setTimeout(r, 20));
      await commit(root, 3);
      expect(await store.entries()).toHaveLength(1);
    } finally {
      landed = async () => {};
    }
  });

  it("writes one record at a time, and rewrites nothing when the line is unchanged", async () => {
    const root = await makeTempRoot();
    const store = storeAt(root);
    await commit(root, 1);
    await Promise.all([store.record(), store.record(), store.list(), store.record()]);
    const file = path.join(root, "harness-history", "history.json");
    expect(JSON.parse(await fs.readFile(file, "utf8"))).toHaveLength(1);
    const before = await fs.stat(file);
    await new Promise((r) => setTimeout(r, 20));
    await store.record();
    expect((await fs.stat(file)).mtimeMs).toBe(before.mtimeMs);
    expect(await fs.readdir(path.join(root, "harness-history", "versions"))).toEqual(["p1-c1-w1"]);
  });

  it("keeps the newest KEEP_VERSIONS versions' artifacts", async () => {
    const root = await makeTempRoot();
    const store = storeAt(root);
    for (let i = 0; i < KEEP_VERSIONS + 2; i++) {
      await commit(root, i);
      await store.record();
    }
    const dirs = (await fs.readdir(path.join(root, "harness-history", "versions"))).sort();
    expect(dirs).toHaveLength(KEEP_VERSIONS);
    expect(dirs).not.toContain("p0-c0-w0");
    expect(dirs).toContain(`p${KEEP_VERSIONS + 1}-c${KEEP_VERSIONS + 1}-w${KEEP_VERSIONS + 1}`);
  });

  it("keeps HISTORY_KEEP entries and degrades a corrupt file to what still parses", async () => {
    const root = await makeTempRoot();
    const store = storeAt(root);
    for (let i = 0; i < HISTORY_KEEP + 3; i++) {
      await commit(root, i);
      await store.record();
    }
    expect(await store.entries()).toHaveLength(HISTORY_KEEP);
    await fs.writeFile(path.join(root, "harness-history", "history.json"), "{ not json");
    expect(await store.entries()).toEqual([]);
    await fs.writeFile(
      path.join(root, "harness-history", "history.json"),
      JSON.stringify([{ pushedAt: "x" }, { bundles: { platform: "store/platform/z.mjs" } }]),
    );
    expect((await store.entries()).map((e) => e.bundles.platform)).toEqual([
      "store/platform/z.mjs",
    ]);
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
    expect([d.from, d.to]).toEqual(["a", "b"]);
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
    expect(
      diffIfaces({ hash: "b", ...TABLE_B } as never, { hash: "a", ...TABLE_A } as never).modules[0],
    ).toMatchObject({ name: "SystemClock", change: "removed" });
    expect(diffIfaces(null, { hash: "a", ...TABLE_A } as never).ifaces).toEqual([
      { key: "@x#Users", change: "added", methods: [], fields: [], slots: [] },
    ]);
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

  it("a fresh root already has this platform's boot on record, with its table", async () => {
    t = await createTestApp();
    const admin = await loginAdmin(t.app);
    const client = apiClient(t.app, admin.cookie);
    const body = (await (
      await client.get("/api/version/history")
    ).json()) as VersionHistoryResponse;
    expect(body.current).toBeNull(); // the runtime committed nothing
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]!.ifaces?.hash).toBe(OWN_HASH);
    const stored = (await (await client.get(`/api/version/history/ifaces/${OWN_HASH}`)).json()) as {
      hash: string;
    };
    expect(stored.hash).toBe(OWN_HASH);
    expect((await client.get(`/api/version/history/ifaces/${"c".repeat(64)}`)).status).toBe(404);
    expect((await client.get("/api/version/history/ifaces/..%2F..%2Fharness")).status).toBe(404);
    const diff = (await (
      await client.get(`/api/version/history/diff?from=none&to=${OWN_HASH}`)
    ).json()) as VersionHistoryDiffResponse;
    expect(diff.from).toBeNull();
    expect(diff.modules.length).toBeGreaterThan(0);
    expect(diff.modules.every((m) => m.change === "added")).toBe(true);
  });

  it("a committed version is recorded with the runtime's provenance and shown current", async () => {
    t = await createTestApp({
      beforeSeed: (root) => commit(root, 7, { repo: "r", revision: "v7" }),
    });
    const admin = await loginAdmin(t.app);
    const body = (await (
      await apiClient(t.app, admin.cookie).get("/api/version/history")
    ).json()) as VersionHistoryResponse;
    expect(body.current?.bundles.platform).toBe("store/platform/p7.mjs");
    expect(body.entries[0]).toMatchObject({
      source: { repo: "r", revision: "v7" },
      bundles: { platform: "store/platform/p7.mjs" },
      ifaces: { hash: OWN_HASH },
    });
  });
});
