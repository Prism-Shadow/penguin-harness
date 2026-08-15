/**
 * Business-platform proof: terminals surviving a hot swap via resource
 * claiming, exercised through the repo's own packaged platform (not the
 * standalone fixture bundle).
 *
 * Parked with describe.skip since A1 (refactor(hmr): move the business
 * platform out of the minimal core) trimmed packages/server/src/platform/
 * down to a bare mechanism-only stub with no /terminals routes — the
 * business platform (terminal.ts, platform.ts's `terminals` child, the
 * /terminals* routes) only exists on feat/workflow-hmr. Un-skip this file
 * (and delete this note) once that platform is restored.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { apiClient, createTestApp, loginAdmin } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const NEXT_BUNDLE_FILE = fileURLToPath(
  new URL("./fixtures/platform-next.bundle.mjs", import.meta.url),
);

/** Polls until fn() is truthy (live child processes emit output asynchronously). */
async function until(fn: () => Promise<boolean>, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (await fn()) return;
    if (Date.now() - start > timeoutMs) throw new Error("condition not reached in time");
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe.skip("hot update: business platform (terminals)", () => {
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;
  let nextBundle: string;

  beforeEach(async () => {
    t = await createTestApp();
    const admin = await loginAdmin(t.app);
    api = apiClient(t.app, admin.cookie);
    nextBundle = await fs.readFile(NEXT_BUNDLE_FILE, "utf8");
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("pushing the next build as inline bytes migrates the platform; terminals survive", async () => {
    // A `cat` terminal echoes stdin: live proof the same process spans the swap.
    const created = await api.post("/api/hmr/terminals", { command: "cat" });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    await api.post(`/api/hmr/terminals/${id}/input`, { data: "before-upgrade\n" });
    await until(async () => {
      const r = await api.get(`/api/hmr/terminals/${id}`);
      return ((await r.json()) as { output: string }).output.includes("before-upgrade");
    });

    // The bundle bytes travel in the request body — exactly what a remote /
    // HTTP-only runtime receives; the optional git specifier is provenance
    // only (echoed, never executed).
    const source = { repo: "file:///builds/penguin.git", revision: "deadbeef" };
    const upgraded = await api.post("/api/hmr/platform/upgrade", { bundle: nextBundle, source });
    expect(upgraded.status).toBe(200);
    // The packaged doc is v1; the pushed build is v2 with a 1→2 migrator.
    expect(await upgraded.json()).toEqual({ status: "ok", mode: "migrated", impl: "next", source });

    const info = (await (await api.get("/api/hmr/platform")).json()) as {
      impl: string;
      info: { impl: string; theme: string };
    };
    expect(info.info.impl).toBe("next");
    expect(info.info.theme).toBe("classic"); // filled by the migrator

    // Same process, buffer intact, still responsive.
    const after = (await (await api.get(`/api/hmr/terminals/${id}`)).json()) as {
      output: string;
      alive: boolean;
      lost: boolean;
    };
    expect(after.alive).toBe(true);
    expect(after.lost).toBe(false);
    expect(after.output).toContain("before-upgrade");

    await api.post(`/api/hmr/terminals/${id}/input`, { data: "after-upgrade\n" });
    await until(async () => {
      const r = await api.get(`/api/hmr/terminals/${id}`);
      return ((await r.json()) as { output: string }).output.includes("after-upgrade");
    });
  });
});
