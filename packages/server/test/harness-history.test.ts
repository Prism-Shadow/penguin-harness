/**
 * The harness history: every version persistVersion commits is appended to
 * <root>/hmr/history.json (newest first, HISTORY_KEEP entries), read back defensively,
 * and served with the current commit by GET /api/version/history.
 */
import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { appendHarnessHistory, HISTORY_KEEP, readHarnessHistory } from "../src/hmr/manifest.js";
import type { VersionHistoryResponse } from "../src/api/types.js";
import { apiClient, createTestApp, loginAdmin, makeTempRoot, type TestApp } from "./helpers.js";

const entry = (n: number, source: { repo: string; revision: string } | null = null) => ({
  source,
  pushedAt: new Date(Date.UTC(2026, 7, 30, 0, 0, n)).toISOString(),
  bundles: {
    platform: `store/platform/p${n}.mjs`,
    cli: `store/cli/c${n}.mjs`,
    web: `store/web/w${n}.webz`,
  },
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
        { bundles: { platform: "store/platform/z.mjs" } }, // no time: not a record
        { ...entry(2), source: { repo: "only-half" } }, // half a provenance names nothing
      ]),
    );
    const entries = await readHarnessHistory(root);
    expect(entries.map((e) => e.bundles.platform)).toEqual([
      "store/platform/p1.mjs",
      "store/platform/p2.mjs",
    ]);
    expect(entries[0]!.source).toEqual({ repo: "git@x:y.git", revision: "v0.2.9-3-gabc" });
    expect(entries[1]!.source).toBeNull();
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

  it("an empty root has no history and no current version", async () => {
    t = await createTestApp();
    const admin = await loginAdmin(t.app);
    const body = (await (
      await apiClient(t.app, admin.cookie).get("/api/version/history")
    ).json()) as VersionHistoryResponse;
    expect(body).toEqual({ current: null, entries: [] });
  });
});
