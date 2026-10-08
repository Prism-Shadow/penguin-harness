import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renameOver } from "../src/internal/rename-over.js";

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: operation not permitted, rename`), { code });
}

describe("renameOver", () => {
  afterEach(() => vi.restoreAllMocks());

  async function files(): Promise<{ from: string; to: string }> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rename-over-"));
    const from = path.join(dir, "next.tmp");
    const to = path.join(dir, "activity_spec.json");
    await fs.writeFile(from, "new");
    await fs.writeFile(to, "old");
    return { from, to };
  }

  it("waits out a passing Windows lock on the target", async () => {
    const { from, to } = await files();
    const rename = fs.rename.bind(fs);
    let refused = 0;
    vi.spyOn(fs, "rename").mockImplementation(async (a, b) => {
      if (refused < 2) {
        refused += 1;
        throw errno(refused === 1 ? "EPERM" : "EBUSY");
      }
      return rename(a, b);
    });
    await renameOver(from, to, { platform: "win32" });
    expect(refused).toBe(2);
    expect(await fs.readFile(to, "utf8")).toBe("new");
  });

  it("gives up on a lock nothing releases with the original error", async () => {
    const { from, to } = await files();
    vi.spyOn(fs, "rename").mockRejectedValue(errno("EPERM"));
    await expect(renameOver(from, to, { platform: "win32", timeoutMs: 60 })).rejects.toMatchObject(
      { code: "EPERM" },
    );
  });

  it("does not retry off Windows, where EACCES is a real permission error", async () => {
    const { from, to } = await files();
    const spy = vi.spyOn(fs, "rename").mockRejectedValue(errno("EACCES"));
    await expect(renameOver(from, to, { platform: "linux" })).rejects.toMatchObject({
      code: "EACCES",
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("does not retry an error that is not a lock", async () => {
    const { from, to } = await files();
    const spy = vi.spyOn(fs, "rename").mockRejectedValue(errno("ENOENT"));
    await expect(renameOver(from, to, { platform: "win32" })).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
