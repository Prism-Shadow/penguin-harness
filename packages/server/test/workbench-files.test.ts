/**
 * The folder of files a workbench shares with its Agent (`WorkbenchHost.listFiles` and friends;
 * `.files/` in the workbench's own folder), against a real directory.
 *
 * - What the handler writes the Agent finds on disk, and what the Agent writes with its own file
 *   tools the handler lists and reads: one file, whichever side wrote last.
 * - A write replaces the file in one step and leaves no staging file in a listing.
 * - Nothing follows a link: a linked file is left out of a listing and refused by name, and a
 *   path through a linked directory is refused, so the Agent cannot point the server outside.
 * - A path that leaves the folder is refused.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FILES_DIR, WorkbenchFileError, WorkbenchFiles } from "../src/workbenches/files.js";

let dir: string;
let files: WorkbenchFiles;
const shared = (...rel: string[]) => path.join(dir, FILES_DIR, ...rel);
const text = (bytes: Uint8Array | null) => (bytes === null ? null : Buffer.from(bytes).toString());

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), "penguin-wb-files-"));
  files = new WorkbenchFiles(dir);
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("a workbench's shared files", () => {
  it("lists nothing, and reads nothing, before anything was written", async () => {
    expect(await files.list()).toEqual([]);
    expect(await files.read("decks/a.json")).toBeNull();
    await files.remove("decks/a.json");
  });

  it("the handler's write is a file on disk the Agent can open, at the path the host names", async () => {
    const written = await files.write("decks/a.json", '{"title":"A"}');
    expect(written).toMatchObject({ path: "decks/a.json", size: 13 });
    expect(files.pathOf("decks/a.json")).toBe(shared("decks", "a.json"));
    expect(await fs.readFile(shared("decks", "a.json"), "utf8")).toBe('{"title":"A"}');
  });

  it("the Agent's write is listed and read by the handler, with a new time each time it changes", async () => {
    await fs.mkdir(shared("decks"), { recursive: true });
    await fs.writeFile(shared("decks", "a.json"), "one");
    const [first] = await files.list();
    expect(first).toMatchObject({ path: "decks/a.json", size: 3 });
    await fs.writeFile(shared("decks", "a.json"), "three");
    await fs.utimes(shared("decks", "a.json"), new Date(), new Date(first!.mtimeMs + 5000));
    const [second] = await files.list();
    expect(second!.size).toBe(5);
    expect(second!.mtimeMs).toBeGreaterThan(first!.mtimeMs);
    expect(text(await files.read("decks/a.json"))).toBe("three");
  });

  it("replaces a file whole and leaves no staging file behind", async () => {
    await files.write("a.txt", "first");
    await files.write("a.txt", new TextEncoder().encode("second"));
    expect(text(await files.read("a.txt"))).toBe("second");
    expect((await files.list()).map((file) => file.path)).toEqual(["a.txt"]);
    expect(await fs.readdir(shared())).toEqual(["a.txt"]);
  });

  it("removes a file and lists the rest sorted by path", async () => {
    await files.write("b/2.txt", "2");
    await files.write("a.txt", "a");
    await files.write("b/1.txt", "1");
    await files.remove("b/2.txt");
    expect((await files.list()).map((file) => file.path)).toEqual(["a.txt", "b/1.txt"]);
  });

  it("never follows a link the Agent planted", async () => {
    const outside = path.join(dir, "outside");
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, "secret.txt"), "secret");
    await fs.mkdir(shared(), { recursive: true });
    await fs.symlink(path.join(outside, "secret.txt"), shared("link.txt"));
    await fs.symlink(outside, shared("linked"));

    expect(await files.list()).toEqual([]);
    await expect(files.read("link.txt")).rejects.toBeInstanceOf(WorkbenchFileError);
    await expect(files.write("link.txt", "x")).rejects.toBeInstanceOf(WorkbenchFileError);
    await expect(files.read("linked/secret.txt")).rejects.toBeInstanceOf(WorkbenchFileError);
    await expect(files.write("linked/new.txt", "x")).rejects.toBeInstanceOf(WorkbenchFileError);
    expect(await fs.readFile(path.join(outside, "secret.txt"), "utf8")).toBe("secret");
    expect(await fs.readdir(outside)).toEqual(["secret.txt"]);
  });

  it("refuses a path that leaves the folder", async () => {
    for (const rel of ["../state.json", "/etc/passwd", "a/../../b", "a\\b", ""]) {
      await expect(files.write(rel, "x")).rejects.toBeInstanceOf(WorkbenchFileError);
      await expect(files.read(rel)).rejects.toBeInstanceOf(WorkbenchFileError);
    }
    expect(await fs.readdir(dir)).toEqual([]);
  });
});
