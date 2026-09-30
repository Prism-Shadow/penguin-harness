/**
 * The file tools under the sandbox (tools/fs-port.ts, tools/fs-worker.ts): a confined
 * Session's read_file, edit_file and write_file do their file-system work in a helper
 * process the Session's confiner wraps, so the backend that bounds its commands bounds
 * them too. The helper serves the port's primitives over JSON lines; the same tool code
 * runs against it and against this process.
 *
 * - The helper's port agrees with the in-process one, errors and their codes included.
 * - The Environment works through the helper when the confiner rewrites the helper's argv,
 *   and in-process when the confiner leaves it alone.
 * - One helper serves a Session: reused across calls, started over when the confiner's
 *   answer changes, killed by an abort and on dispose.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Environment } from "../src/environment/index.js";
import { SandboxedFsHost, fsWorkerArgv } from "../src/environment/tools/fs-worker.js";
import { describeFsError, errorCode, localFsPort } from "../src/environment/tools/fs-port.js";
import type { FsPort } from "../src/environment/tools/fs-port.js";
import { EDIT_FILE_NAME } from "../src/environment/tools/edit-file.js";
import { READ_FILE_NAME } from "../src/environment/tools/read-file.js";
import { WRITE_FILE_NAME } from "../src/environment/tools/write-file.js";
import { toolCall } from "../src/omnimessage/index.js";
import type { ConfinedSpawn, SpawnConfiner, ToolConfig } from "../src/interfaces/index.js";

let tmp: string;

beforeEach(async () => {
  tmp = await realpath(await mkdtemp(path.join(tmpdir(), "penguin-fs-helper-")));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

/** A confiner's answer that names the helper as it is, with a runner entry so it reads as confined. */
const marked = (): ConfinedSpawn => ({ argv: fsWorkerArgv(), env: { PENGUIN_TEST_HELPER: "1" } });

describe("the helper's port", () => {
  let host: SandboxedFsHost;
  let port: FsPort;
  beforeEach(() => {
    host = new SandboxedFsHost();
    port = host.portFor(marked());
  });
  afterEach(() => {
    host.dispose();
  });

  it("answers every primitive like the in-process port", async () => {
    const file = path.join(tmp, "a.txt");
    await writeFile(file, "alpha\nbeta\n", { mode: 0o640 });
    await mkdir(path.join(tmp, "sub"));
    await symlink(file, path.join(tmp, "link.txt"));
    for (const fs of [localFsPort, port]) {
      const st = await fs.stat(file);
      expect(st).toMatchObject({ isFile: true, isDirectory: false, size: 11 });
      // Permission bits are a POSIX fact; Windows answers a fixed 0o666.
      if (process.platform !== "win32") expect(st.mode & 0o777).toBe(0o640);
      expect((await fs.readFile(file)).toString()).toBe("alpha\nbeta\n");
      expect((await fs.readRange(file, 6, 100)).toString()).toBe("beta\n");
      expect((await fs.readRange(file, 100, 10)).length).toBe(0);
      expect(await fs.readdir(tmp)).toEqual(
        expect.arrayContaining([
          { name: "a.txt", isFile: true, isDirectory: false },
          { name: "sub", isFile: false, isDirectory: true },
        ]),
      );
      expect(await fs.realpath(path.join(tmp, "link.txt"))).toBe(file);
      expect(await fs.readlink(path.join(tmp, "link.txt"))).toBe(file);
    }
    await port.mkdir(path.join(tmp, "deep", "er"));
    expect((await localFsPort.stat(path.join(tmp, "deep", "er"))).isDirectory).toBe(true);
    // A write through the link lands on the file it names, with the mode asked for.
    await port.writeFileAtomic(path.join(tmp, "link.txt"), Buffer.from("gamma\n"), {
      mode: 0o600,
      followSymlinks: true,
    });
    expect(await readFile(file, "utf8")).toBe("gamma\n");
    if (process.platform !== "win32")
      expect((await localFsPort.stat(file)).mode & 0o777).toBe(0o600);
    expect(await readFile(path.join(tmp, "link.txt"), "utf8")).toBe("gamma\n");
  });

  it("carries an error's code across, so the tools diagnose as they do in-process", async () => {
    for (const fs of [localFsPort, port]) {
      await expect(fs.stat(path.join(tmp, "missing"))).rejects.toMatchObject({ code: "ENOENT" });
      await expect(fs.readFile(tmp)).rejects.toMatchObject({ code: "EISDIR" });
      await expect(fs.readlink(path.join(tmp, "a.txt"))).rejects.toMatchObject({
        code: "ENOENT",
      });
    }
  });

  it("downloads through the helper, and refuses a body past the cap with ETOOBIG", async () => {
    const server = createServer((req, res) => {
      if (req.url === "/big") {
        res.writeHead(200, { "content-type": "image/png", "content-length": "99999999" });
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end("hello");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      for (const fs of [localFsPort, port]) {
        const res = await fs.fetch(`${base}/ok`, { maxBytes: 1000 });
        expect(res).toMatchObject({
          ok: true,
          status: 200,
          contentType: "text/plain; charset=utf-8",
        });
        expect(res.bytes.toString()).toBe("hello");
        await expect(fs.fetch(`${base}/big`, { maxBytes: 1000 })).rejects.toMatchObject({
          code: "ETOOBIG",
          size: 99999999,
        });
      }
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("names the sandbox when a refused effect comes back as a permission error", async () => {
    const err = Object.assign(new Error("EROFS: read-only file system"), { code: "EROFS" });
    expect(describeFsError(err, true)).toContain("refused by this session's sandbox");
    expect(describeFsError(err, false)).toBe("EROFS: read-only file system");
    expect(errorCode(err)).toBe("EROFS");
  });
});

describe("one helper per Session", () => {
  it("is reused across calls, started over when the confiner's answer changes, and stopped on dispose", async () => {
    const starts: ConfinedSpawn[] = [];
    const host = new SandboxedFsHost((confined) => {
      starts.push(confined);
      const [program, ...args] = confined.argv;
      return spawn(program!, args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", ...confined.env },
      });
    });
    try {
      const a = host.portFor(marked());
      await a.stat(tmp);
      await a.readdir(tmp);
      expect(starts).toHaveLength(1);
      expect(host.running).toBe(true);
      // The same answer again: the same helper. Another answer: a fresh one.
      await host.portFor(marked()).stat(tmp);
      expect(starts).toHaveLength(1);
      const b = host.portFor({ argv: fsWorkerArgv(), env: { PENGUIN_TEST_HELPER: "2" } });
      await b.stat(tmp);
      expect(starts).toHaveLength(2);
      expect(starts[1]!.env).toEqual({ PENGUIN_TEST_HELPER: "2" });
    } finally {
      host.dispose();
    }
    expect(host.running).toBe(false);
    await expect(host.portFor(marked()).stat(tmp)).rejects.toThrow(/disposed/);
  });

  it("an abort kills the helper mid-operation, and the next call starts a fresh one", async () => {
    // A download that never finishes: the helper is stuck inside it until the abort.
    const server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "image/png" });
      res.write("partial");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    let started = 0;
    const host = new SandboxedFsHost((confined) => {
      started += 1;
      const [program, ...args] = confined.argv;
      return spawn(program!, args, { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env } });
    });
    try {
      const port = host.portFor(marked());
      const ac = new AbortController();
      const pending = port.fetch(`${base}/stall`, { maxBytes: 1000, signal: ac.signal });
      setTimeout(() => ac.abort(), 100);
      await expect(pending).rejects.toMatchObject({ name: "AbortError" });
      expect(host.running).toBe(false);
      expect((await port.stat(tmp)).isDirectory).toBe(true);
      expect(started).toBe(2);
    } finally {
      host.dispose();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("a helper that cannot start fails the operation with the spawn error", async () => {
    const host = new SandboxedFsHost();
    try {
      const port = host.portFor({ argv: ["definitely-not-a-real-runner-xyz", "--", "x"] });
      await expect(port.stat(tmp)).rejects.toThrow(/sandbox: the file helper could not start/);
    } finally {
      host.dispose();
    }
  });
});

describe("the file tools through the helper", () => {
  const toolConfig = (): ToolConfig => ({
    customTools: [
      { name: WRITE_FILE_NAME, description: "t", permission: "rw" },
      { name: EDIT_FILE_NAME, description: "t", permission: "rw" },
      { name: READ_FILE_NAME, description: "t", permission: "r" },
    ],
    mcpServers: [],
  });
  /** A confiner that names the helper as it is, plus a runner entry — enough for the Environment to route through it. */
  const confining: SpawnConfiner = (argv) => ({
    argv: [...argv],
    env: { PENGUIN_TEST_HELPER: "1" },
  });

  async function execute(env: Environment, name: string, args: Record<string, unknown>) {
    const call = toolCall({ name, arguments: JSON.stringify(args), toolCallId: "t1" });
    let output = "";
    let stopReason: string | undefined;
    for await (const msg of env.executeTool({ toolCall: call })) {
      const p = msg.payload as { type?: string; output?: string; stop_reason?: string };
      if (p.type === "tool_call_output") {
        output = p.output ?? "";
        stopReason = p.stop_reason;
      }
    }
    return { output, stopReason };
  }

  it("writes, edits and reads through the helper, with the same output as in-process", async () => {
    const seen: unknown[] = [];
    const env = new Environment({
      workspaceDir: tmp,
      toolConfig: toolConfig(),
      sessionScratchpadDir: path.join(tmp, "scratchpad", "s1"),
      confineSpawn: () => (argv, opts) => {
        seen.push(opts);
        return confining(argv, opts);
      },
    });
    try {
      await env.listTools();
      const file = path.join(tmp, "note.txt");
      const written = await execute(env, WRITE_FILE_NAME, {
        file_path: file,
        content: "one\ntwo\n",
      });
      expect(written.stopReason).toBe("completed");
      expect(written.output).toContain("Created");
      expect(await readFile(file, "utf8")).toBe("one\ntwo\n");
      const edited = await execute(env, EDIT_FILE_NAME, {
        file_path: file,
        old_string: "two",
        new_string: "three",
      });
      expect(edited.stopReason).toBe("completed");
      expect(edited.output).toContain("-two");
      expect(edited.output).toContain("+three");
      const read = await execute(env, READ_FILE_NAME, { file_path: "note.txt" });
      expect(read.output.split("\n")).toEqual(["     1\tone", "     2\tthree"]);
      // A missing path is diagnosed through the helper too, with the directory's entries.
      const missing = await execute(env, READ_FILE_NAME, { file_path: "nope.txt" });
      expect(missing.stopReason).toBe("fatal");
      expect(missing.output).toContain("has no entry");
      expect(missing.output).toContain("note.txt");
      // The helper is confined with the Session's scope, like a command.
      expect(seen[0]).toEqual({
        cwd: tmp,
        workspaceDir: tmp,
        scratchpadDir: path.join(tmp, "scratchpad", "s1"),
      });
    } finally {
      env.dispose();
    }
  });

  it("reads an image through the helper", async () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      "base64",
    );
    await writeFile(path.join(tmp, "dot.png"), png);
    const env = new Environment({
      workspaceDir: tmp,
      toolConfig: toolConfig(),
      confineSpawn: () => confining,
    });
    try {
      await env.listTools();
      const call = toolCall({
        name: READ_FILE_NAME,
        arguments: JSON.stringify({ file_path: "dot.png" }),
        toolCallId: "t2",
      });
      let images: string[] | undefined;
      for await (const msg of env.executeTool({ toolCall: call })) {
        const p = msg.payload as { type?: string; images?: string[] };
        if (p.type === "tool_call_output") images = p.images;
      }
      expect(images).toEqual([`data:image/png;base64,${png.toString("base64")}`]);
    } finally {
      env.dispose();
    }
  });

  it("reports a refused write as the sandbox's doing", async () => {
    if (process.platform === "win32" || process.getuid?.() === 0) return;
    const locked = path.join(tmp, "locked");
    await mkdir(locked);
    await writeFile(path.join(locked, "f.txt"), "x");
    await chmod(locked, 0o555);
    const env = new Environment({
      workspaceDir: tmp,
      toolConfig: toolConfig(),
      confineSpawn: () => confining,
    });
    try {
      await env.listTools();
      const written = await execute(env, WRITE_FILE_NAME, {
        file_path: path.join(locked, "f.txt"),
        content: "y",
      });
      expect(written.stopReason).toBe("fatal");
      expect(written.output).toContain("refused by this session's sandbox");
    } finally {
      env.dispose();
      await chmod(locked, 0o755);
    }
  });

  it("works in this process when the confiner leaves the helper's argv alone", async () => {
    let asked = 0;
    const env = new Environment({
      workspaceDir: tmp,
      toolConfig: toolConfig(),
      confineSpawn: () => (argv) => {
        asked += 1;
        return { argv };
      },
    });
    try {
      await env.listTools();
      const file = path.join(tmp, "plain.txt");
      const written = await execute(env, WRITE_FILE_NAME, { file_path: file, content: "z" });
      expect(written.stopReason).toBe("completed");
      expect(await readFile(file, "utf8")).toBe("z");
      expect(asked).toBe(1);
    } finally {
      env.dispose();
    }
  });
});
