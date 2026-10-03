/**
 * The file panel's reader: a file under the proposal's base comes back whole or cut at the
 * limit, a binary one without content, and nothing outside the base is ever read — not by an
 * absolute path, not by `..`, not through a symlink whose name is inside and target is not.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FILE_READ_LIMIT, readBaseFile, relativeSegments } from "../src/files.js";

describe("readBaseFile", () => {
  let root: string;
  let base: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "proposals-files-"));
    base = path.join(root, "repo");
    await fs.mkdir(path.join(base, "src"), { recursive: true });
    await fs.writeFile(path.join(base, "src", "main.ts"), "export const a = 1;\n");
    await fs.writeFile(path.join(root, "secret.txt"), "outside");
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("reads a file under the base, with its extension", async () => {
    expect(await readBaseFile(base, "src/main.ts")).toEqual({
      path: "src/main.ts",
      size: 20,
      binary: false,
      truncated: false,
      content: "export const a = 1;\n",
      extension: "ts",
    });
    // `./` and doubled separators name the same file, and it is reported in one spelling.
    expect(await readBaseFile(base, "./src//main.ts")).toMatchObject({ path: "src/main.ts" });
  });

  it("refuses an absolute path, a `..` segment and an empty path before touching the disk", async () => {
    for (const rel of [
      "",
      "/etc/passwd",
      "C:\\Windows\\win.ini",
      "../secret.txt",
      "src/../../secret.txt",
    ]) {
      expect(await readBaseFile(base, rel)).toMatchObject({ code: "bad_path" });
    }
    expect(relativeSegments("src/./main.ts")).toEqual(["src", "main.ts"]);
  });

  it("refuses a symlink inside the base whose target leaves it", async () => {
    // Creating one needs a privilege Windows does not always grant; without it there is
    // nothing to follow, and the test has nothing to say.
    const made = await fs
      .symlink(path.join(root, "secret.txt"), path.join(base, "linked.txt"))
      .then(() => true)
      .catch(() => false);
    if (!made) return;
    expect(await readBaseFile(base, "linked.txt")).toMatchObject({ code: "path_outside" });
    // A link that stays inside is followed.
    await fs.symlink(path.join(base, "src", "main.ts"), path.join(base, "alias.ts"));
    expect(await readBaseFile(base, "alias.ts")).toMatchObject({
      content: "export const a = 1;\n",
    });
  });

  it("answers file_not_found for a missing path, a directory and a missing base", async () => {
    expect(await readBaseFile(base, "src/nope.ts")).toMatchObject({ code: "file_not_found" });
    expect(await readBaseFile(base, "src")).toMatchObject({ code: "file_not_found" });
    expect(await readBaseFile(path.join(root, "gone"), "src/main.ts")).toMatchObject({
      code: "file_not_found",
    });
  });

  it("sends a binary file without content, and a large one cut at the limit", async () => {
    await fs.writeFile(path.join(base, "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]));
    expect(await readBaseFile(base, "logo.png")).toMatchObject({
      binary: true,
      content: null,
      size: 7,
      extension: "png",
    });
    const big = "x".repeat(FILE_READ_LIMIT + 10);
    await fs.writeFile(path.join(base, "big.log"), big);
    const read = await readBaseFile(base, "big.log");
    expect(read).toMatchObject({ truncated: true, size: FILE_READ_LIMIT + 10, binary: false });
    expect("content" in read && read.content?.length).toBe(FILE_READ_LIMIT);
  });
});
