/**
 * A workbench's data folder (`WorkbenchHost.listFiles` and friends; `<agentDir>/app/data/<id>/`),
 * against a real directory.
 *
 * - Before anything is written there is nothing to list or read; the folder is made when its
 *   path is first handed out.
 * - What the handler writes the Agent finds on disk, and what the Agent writes with its own file
 *   tools the handler lists and reads: one file, whichever side wrote last.
 * - A write replaces the file in one step and leaves no staging file in a listing.
 * - Nothing follows a link: a linked file is left out of a listing and refused by name, a path
 *   through a linked directory is refused, and so is a link planted where `app/` or `app/data/`
 *   belongs, so the Agent cannot point the server outside. Removing a link removes the link.
 * - A path that leaves the folder is refused.
 * - Removing a workbench's folder never reaches through a link on the way to it.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { removeBelow, WorkbenchFileError, WorkbenchFiles } from "../src/workbenches/files.js";

let agent: string;
let files: WorkbenchFiles;
const data = (...rel: string[]) => path.join(agent, "app", "data", "deck", ...rel);
const text = (bytes: Uint8Array | null) => (bytes === null ? null : Buffer.from(bytes).toString());

/** A folder outside the Agent holding one secret, and its listing. */
async function outside(): Promise<string> {
  const dir = path.join(path.dirname(agent), "outside");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "secret.txt"), "secret");
  return dir;
}

beforeEach(async () => {
  const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), "penguin-wb-files-"));
  agent = path.join(root, "agent");
  await fs.mkdir(agent);
  files = new WorkbenchFiles(agent, data());
});
afterEach(async () => {
  await fs.rm(path.dirname(agent), { recursive: true, force: true });
});

describe("a workbench's data folder", () => {
  it("lists and reads nothing before anything was written, and exists once its path is handed out", async () => {
    expect(await files.list()).toEqual([]);
    expect(await files.read("decks/a.json")).toBeNull();
    await files.remove("decks/a.json");
    await expect(fs.stat(path.join(agent, "app"))).rejects.toMatchObject({ code: "ENOENT" });

    files.ensure("dataPaths");
    expect((await fs.stat(data())).isDirectory()).toBe(true);
  });

  it("the handler's write is a file on disk the Agent can open, at the path the host names", async () => {
    const written = await files.write("decks/a.json", '{"title":"A"}');
    expect(written).toMatchObject({ path: "decks/a.json", size: 13 });
    expect(files.pathOf("decks/a.json")).toBe(data("decks", "a.json"));
    expect(await fs.readFile(data("decks", "a.json"), "utf8")).toBe('{"title":"A"}');
  });

  it("the Agent's write is listed and read by the handler, with a new time each time it changes", async () => {
    await fs.mkdir(data("decks"), { recursive: true });
    await fs.writeFile(data("decks", "a.json"), "one");
    const [first] = await files.list();
    expect(first).toMatchObject({ path: "decks/a.json", size: 3 });
    await fs.writeFile(data("decks", "a.json"), "three");
    await fs.utimes(data("decks", "a.json"), new Date(), new Date(first!.mtimeMs + 5000));
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
    expect(await fs.readdir(data())).toEqual(["a.txt"]);
  });

  it("removes a file and lists the rest sorted by path", async () => {
    await files.write("b/2.txt", "2");
    await files.write("a.txt", "a");
    await files.write("b/1.txt", "1");
    await files.remove("b/2.txt");
    expect((await files.list()).map((file) => file.path)).toEqual(["a.txt", "b/1.txt"]);
  });

  it("never follows a link the Agent planted inside the folder", async () => {
    const away = await outside();
    await fs.mkdir(data(), { recursive: true });
    await fs.symlink(path.join(away, "secret.txt"), data("link.txt"));
    await fs.symlink(away, data("linked"), "dir");

    expect(await files.list()).toEqual([]);
    await expect(files.read("link.txt")).rejects.toBeInstanceOf(WorkbenchFileError);
    await expect(files.write("link.txt", "x")).rejects.toBeInstanceOf(WorkbenchFileError);
    await expect(files.read("linked/secret.txt")).rejects.toBeInstanceOf(WorkbenchFileError);
    await expect(files.write("linked/new.txt", "x")).rejects.toBeInstanceOf(WorkbenchFileError);
    // Removing the link removes the link, never what it points at.
    await files.remove("link.txt");
    await expect(fs.lstat(data("link.txt"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await fs.readFile(path.join(away, "secret.txt"), "utf8")).toBe("secret");
    expect(await fs.readdir(away)).toEqual(["secret.txt"]);
  });

  it.each([["app"], ["app", "data"], ["app", "data", "deck"]])(
    "never follows a link planted where %s belongs",
    async (...segments: string[]) => {
      const away = await outside();
      await fs.mkdir(path.join(agent, ...segments.slice(0, -1)), { recursive: true });
      await fs.symlink(away, path.join(agent, ...segments), "dir");

      await expect(files.list()).rejects.toBeInstanceOf(WorkbenchFileError);
      await expect(files.read("secret.txt")).rejects.toBeInstanceOf(WorkbenchFileError);
      await expect(files.write("new.txt", "x")).rejects.toBeInstanceOf(WorkbenchFileError);
      expect(() => files.ensure("dataPaths")).toThrow(WorkbenchFileError);
      expect(await fs.readdir(away)).toEqual(["secret.txt"]);
    },
  );

  it("refuses a path that leaves the folder", async () => {
    for (const rel of ["../state.json", "/etc/passwd", "a/../../b", "a\\b", "", "./a"]) {
      await expect(files.write(rel, "x")).rejects.toBeInstanceOf(WorkbenchFileError);
      await expect(files.read(rel)).rejects.toBeInstanceOf(WorkbenchFileError);
      await expect(files.remove(rel)).rejects.toBeInstanceOf(WorkbenchFileError);
      expect(() => files.pathOf(rel)).toThrow(WorkbenchFileError);
    }
    expect(await fs.readdir(agent)).toEqual([]);
  });

  it("removing the folder never reaches through a link on the way to it", async () => {
    const away = await outside();
    await fs.mkdir(path.join(away, "deck"));
    await fs.mkdir(path.join(agent, "app"));
    await fs.symlink(away, path.join(agent, "app", "data"), "dir");

    await expect(removeBelow(agent, data())).rejects.toBeInstanceOf(WorkbenchFileError);
    expect((await fs.readdir(away)).sort()).toEqual(["deck", "secret.txt"]);

    // Without the link, the folder and everything in it go.
    await fs.rm(path.join(agent, "app", "data"));
    await files.write("decks/a.json", "{}");
    await removeBelow(agent, data());
    await expect(fs.stat(data())).rejects.toMatchObject({ code: "ENOENT" });
  });
});
