/**
 * The creator of a temp root removes it: `makeTempRoot()` records what it hands out and the
 * setup-file sweep (`removeTempRoots`) takes all of it, including the roots no test removes
 * on its own.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createTestApp, makeTempRoot } from "./helpers.js";
import { pendingTempRoots, removeTempRoots } from "./temp-roots.js";

describe("temp roots", () => {
  it("records every root it creates, under TMPDIR, until a sweep removes them", async () => {
    const a = await makeTempRoot();
    const b = await makeTempRoot();
    expect(path.dirname(a)).toBe(os.tmpdir());
    expect(path.basename(a)).toMatch(/^penguin-server-test-/);
    expect(pendingTempRoots()).toEqual(expect.arrayContaining([a, b]));

    await removeTempRoots();
    expect(fs.existsSync(a)).toBe(false);
    expect(fs.existsSync(b)).toBe(false);
    expect(pendingTempRoots()).toEqual([]);
  });

  it("sweeps a root a test already removed without failing", async () => {
    const root = await makeTempRoot();
    fs.rmSync(root, { recursive: true, force: true });
    await expect(removeTempRoots()).resolves.toBeUndefined();
  });

  it("sweeps the root a test hands to createTestApp, which cleanup() does not remove", async () => {
    const root = await makeTempRoot();
    const t = await createTestApp({ config: { root, dbPath: path.join(root, "web.db") } });
    await t.cleanup();
    // cleanup() removes the root createTestApp made for itself; the one passed in survives it.
    expect(fs.existsSync(path.join(root, "web.db"))).toBe(true);

    await removeTempRoots();
    expect(fs.existsSync(root)).toBe(false);
  });
});
