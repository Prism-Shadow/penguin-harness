/**
 * A workbench's own folders (`WorkbenchHost.dataPaths()`, `socketPath()`), against a real
 * directory.
 *
 * - A folder is made one level at a time when first asked for, readable by this user only.
 * - Nothing goes through a link: a link planted where `app/`, `app/data/`, the data folder, the
 *   data root's `run/` or a level of it belongs is refused, so the Agent cannot point the server
 *   outside; removing a folder never reaches through a link on the way to it, and a link where
 *   the folder itself belongs goes as a link.
 * - A local socket listens in the state folder; a path past the 103 bytes a Unix socket path
 *   holds is refused naming the limit, before `listen` could answer a bare EINVAL; a name that is
 *   not one plain segment is refused; on Windows the socket is a named pipe of its own.
 */
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ensureDir,
  MAX_SOCKET_PATH_BYTES,
  removeBelow,
  socketPathIn,
  WorkbenchDirError,
} from "../src/workbenches/data-dirs.js";

let base: string;
const data = () => path.join(base, "app", "data", "deck");

/** A folder outside the base holding one secret. */
async function outside(): Promise<string> {
  const dir = path.join(path.dirname(base), "outside");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "secret.txt"), "secret");
  return dir;
}

beforeEach(async () => {
  // Short on every platform: macOS's temp folder alone is half a socket path.
  const tmp = process.platform === "win32" ? os.tmpdir() : "/tmp";
  const root = await fs.mkdtemp(path.join(await fs.realpath(tmp), "pwd-"));
  base = path.join(root, "a");
  await fs.mkdir(base);
});
afterEach(async () => {
  await fs.rm(path.dirname(base), { recursive: true, force: true });
});

describe("a workbench's folders", () => {
  it("are made one level at a time when first asked for, readable by this user only", async () => {
    await expect(fs.stat(path.join(base, "app"))).rejects.toMatchObject({ code: "ENOENT" });
    ensureDir(base, data(), "dataPaths");
    expect((await fs.stat(data())).isDirectory()).toBe(true);
    if (process.platform !== "win32") {
      expect((await fs.stat(data())).mode & 0o777).toBe(0o700);
    }
    // Asked again, nothing changes.
    await fs.writeFile(path.join(data(), "a.json"), "{}");
    ensureDir(base, data(), "dataPaths");
    expect(await fs.readdir(data())).toEqual(["a.json"]);
  });

  it.each([["app"], ["app", "data"], ["run"], ["run", "p1"]])(
    "never go through a link planted where %s belongs",
    async (...segments: string[]) => {
      const away = await outside();
      await fs.mkdir(path.join(base, ...segments.slice(0, -1)), { recursive: true });
      await fs.symlink(away, path.join(base, ...segments), "dir");
      const dir = segments[0] === "run" ? path.join(base, "run", "p1", "a1", "w1") : data();

      expect(() => ensureDir(base, dir, "dataPaths")).toThrow(WorkbenchDirError);
      await expect(removeBelow(base, dir)).rejects.toBeInstanceOf(WorkbenchDirError);
      expect(await fs.readdir(away)).toEqual(["secret.txt"]);
    },
  );

  it("refuse a link where the folder itself belongs, and remove it as a link", async () => {
    const away = await outside();
    await fs.mkdir(path.dirname(data()), { recursive: true });
    await fs.symlink(away, data(), "dir");

    expect(() => ensureDir(base, data(), "dataPaths")).toThrow(WorkbenchDirError);
    await removeBelow(base, data());
    await expect(fs.lstat(data())).rejects.toMatchObject({ code: "ENOENT" });
    expect(await fs.readdir(away)).toEqual(["secret.txt"]);
  });

  it("removing a folder takes everything in it, and a link inside goes as a link", async () => {
    const away = await outside();
    ensureDir(base, data(), "dataPaths");
    await fs.writeFile(path.join(data(), "a.json"), "{}");
    await fs.symlink(away, path.join(data(), "linked"), "dir");

    await removeBelow(base, data());
    await expect(fs.stat(data())).rejects.toMatchObject({ code: "ENOENT" });
    expect(await fs.readdir(away)).toEqual(["secret.txt"]);
  });
});

describe("a workbench's local socket", () => {
  it.skipIf(process.platform === "win32")(
    "listens in the state folder and answers there",
    async () => {
      const state = path.join(base, "run", "p1", "a1", "w1");
      ensureDir(base, state, "socketPath");
      const at = socketPathIn(state, "dev.sock");
      expect(at).toBe(path.join(state, "dev.sock"));

      const server = net.createServer((socket) => socket.end("pong"));
      await new Promise<void>((resolve) => server.listen(at, resolve));
      const reply = await new Promise<string>((resolve, reject) => {
        let text = "";
        net
          .connect(at)
          .on("data", (chunk) => (text += chunk.toString()))
          .on("end", () => resolve(text))
          .on("error", reject);
      });
      await new Promise<void>((resolve) => server.close(() => resolve()));
      expect(reply).toBe("pong");
    },
  );

  it("refuses a path past the limit, naming it and the room left, before listen is reached", () => {
    const state = path.join("/srv", "x".repeat(80));
    const room = MAX_SOCKET_PATH_BYTES - Buffer.byteLength(state) - 1;
    expect(() => socketPathIn(state, "a".repeat(room), "linux")).not.toThrow();
    expect(() => socketPathIn(state, "a".repeat(room + 1), "linux")).toThrow(
      new RegExp(`at most ${MAX_SOCKET_PATH_BYTES} .* at most ${room} bytes here`),
    );
  });

  it("refuses a name that is not one plain segment", () => {
    for (const name of ["", ".", "..", "a/b", "a\\b", "a\0b"]) {
      expect(() => socketPathIn("/srv/state", name, "linux")).toThrow(WorkbenchDirError);
    }
  });

  it("on Windows is a named pipe, a different one for each state folder", () => {
    const one = socketPathIn("C:\\data\\run\\p\\a\\w1", "dev.sock", "win32");
    const two = socketPathIn("C:\\data\\run\\p\\a\\w2", "dev.sock", "win32");
    expect(one).toMatch(/^\\\\\.\\pipe\\penguin-[0-9a-f]{16}-dev\.sock$/);
    expect(two).not.toBe(one);
  });
});
