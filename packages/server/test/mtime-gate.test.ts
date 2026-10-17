/**
 * mtime-gate `statMtime()`: missing versus unreadable.
 *
 * - Given a path that does not exist, the answer is null (the caller may treat it as gone).
 * - Given a permission error, the error is thrown: the caller must not treat the path as
 *   deleted and must not cache the pass as clean.
 */
import fs from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { statMtime } from "../src/internal/mtime-gate.js";

describe("statMtime", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null when the path does not exist", async () => {
    expect(await statMtime("/no/such/penguin-mtime-gate-path")).toBeNull();
  });

  it("rethrows a permission error instead of calling the path missing", async () => {
    vi.spyOn(fs, "stat").mockRejectedValue(Object.assign(new Error("EACCES"), { code: "EACCES" }));
    await expect(statMtime("/tmp/x")).rejects.toMatchObject({ code: "EACCES" });
  });
});
