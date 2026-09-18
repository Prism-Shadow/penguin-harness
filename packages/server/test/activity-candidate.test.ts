import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readCandidate } from "../src/activities/generation.js";

describe("activity candidate handle reads", () => {
  const directories: string[] = [];
  afterEach(async () => {
    vi.restoreAllMocks();
    for (const dir of directories.splice(0)) await fs.rm(dir, { recursive: true, force: true });
  });
  async function fixture() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "activity-candidate-"));
    directories.push(dir);
    const file = path.join(dir, "activity-spec.json");
    await fs.writeFile(file, '{"title":"safe"}');
    return { dir, file };
  }
  it("reads the validated handle and refuses oversized files", async () => {
    const { file } = await fixture();
    expect(await readCandidate(file)).toBe('{"title":"safe"}');
    await fs.writeFile(file, "x".repeat(2 * 1024 * 1024 + 1));
    await expect(readCandidate(file)).rejects.toThrow("regular JSON file");
  });
  it("refuses a different file substituted at open, including on Windows without O_NOFOLLOW", async () => {
    const { dir, file } = await fixture();
    const secret = path.join(dir, "secret");
    await fs.writeFile(secret, "private content");
    const open = fs.open.bind(fs);
    const handle = await open(secret, "r");
    const read = vi.spyOn(handle, "read");
    const close = vi.spyOn(handle, "close");
    vi.spyOn(fs, "open").mockResolvedValueOnce(handle);
    await expect(readCandidate(file)).rejects.toThrow("unchanged regular");
    expect(read).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });
  it.skipIf(process.platform === "win32")(
    "rejects a symlink swapped in immediately before open",
    async () => {
      const { dir, file } = await fixture();
      const secret = path.join(dir, "secret");
      await fs.writeFile(secret, "private content");
      const open = fs.open.bind(fs);
      vi.spyOn(fs, "open").mockImplementationOnce(async (target, flags, mode) => {
        await fs.unlink(file);
        await fs.symlink(secret, file);
        return open(target, flags, mode);
      });
      await expect(readCandidate(file)).rejects.toMatchObject({ code: "ELOOP" });
    },
  );
});
