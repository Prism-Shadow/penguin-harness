/**
 * `readMachineStatus`: what `penguin server status` answers when a controller asks a machine
 * "is a server running on this root, and which machine is this?". Driven against a real temp
 * data root; every case also checks the probe left the root as it found it — same files, same
 * sizes, same mtimes — except for the two SQLite WAL files a read-only open creates when no
 * server holds the database (see `probe`, and readMachineId's note in the source).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../src/db/database.js";
import { acquireServerLock } from "../src/lock.js";
import { readMachineStatus } from "../src/machine-status.js";
import { makeTempRoot } from "./helpers.js";

const sqlite = process.getBuiltinModule("node:sqlite");

/** A pid that is guaranteed dead: a just-exited child of ours. */
function deadPid(): number {
  const child = spawnSync(process.execPath, ["-e", ""]);
  return child.pid ?? 2 ** 21;
}

function listen(): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as net.AddressInfo).port;
      resolve({ port, close: () => new Promise((r) => srv.close(() => r())) });
    });
  });
}

/** Every file under the root (relative path → size and mtime), directories included. */
function snapshot(root: string): Record<string, { size: number; mtimeMs: number }> {
  const out: Record<string, { size: number; mtimeMs: number }> = {};
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const stat = fs.statSync(full);
      const size = entry.isDirectory() ? 0 : stat.size;
      out[path.relative(root, full)] = { size, mtimeMs: stat.mtimeMs };
      if (entry.isDirectory()) walk(full);
    }
  };
  walk(root);
  return out;
}

/**
 * Runs the probe and asserts it changed nothing on the root. `walSidecars` is the one measured
 * exception: a read-only open of a WAL-mode web.db that no connection holds creates SQLite's
 * `web.db-wal` (empty) and `web.db-shm` beside it, and closing does not remove them. Only
 * those two may appear; everything else, web.db's own size and mtime included, must not move.
 */
async function probe(root: string, walSidecars = false) {
  const before = snapshot(root);
  const status = await readMachineStatus(root);
  const after = snapshot(root);
  if (walSidecars) {
    expect(before).not.toHaveProperty("web.db-wal");
    expect(before).not.toHaveProperty("web.db-shm");
    expect(after["web.db-wal"]).toMatchObject({ size: 0 });
    expect(after).toHaveProperty("web.db-shm");
    delete after["web.db-wal"];
    delete after["web.db-shm"];
  }
  expect(after).toEqual(before);
  return status;
}

describe("readMachineStatus", () => {
  const roots: string[] = [];
  const closers: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const close of closers.splice(0)) await close();
    for (const root of roots.splice(0)) {
      await fs.promises.rm(root, { recursive: true, force: true });
    }
  });

  async function tempRoot(): Promise<string> {
    const root = await makeTempRoot();
    roots.push(root);
    return root;
  }

  async function livePort(): Promise<number> {
    const { port, close } = await listen();
    closers.push(close);
    return port;
  }

  /** A web.db the way a server leaves it: schema applied, this machine's id minted. */
  function seedDatabase(root: string, machineId: string | null): void {
    const db = openDatabase(path.join(root, "web.db"));
    try {
      if (machineId !== null) {
        db.prepare("INSERT INTO machine (singleton, machine_id) VALUES (1, ?)").run(machineId);
      }
    } finally {
      db.close();
    }
  }

  it("answers 'nothing running, no id' on a root without web.db, and creates none", async () => {
    const root = await tempRoot();
    expect(await probe(root)).toEqual({ running: false, port: null, pid: null, machineId: null });
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it("reads the id stored in the machine table, as written", async () => {
    const root = await tempRoot();
    seedDatabase(root, "LNrJdHAZJ91G58i0");
    expect(await probe(root, true)).toEqual({
      running: false,
      port: null,
      pid: null,
      machineId: "LNrJdHAZJ91G58i0",
    });
  });

  it("answers no id for a database whose id was never minted", async () => {
    const root = await tempRoot();
    seedDatabase(root, null);
    expect((await probe(root, true)).machineId).toBeNull();
  });

  it("answers no id for a database that predates the machine table", async () => {
    const root = await tempRoot();
    const db = new sqlite.DatabaseSync(path.join(root, "web.db"));
    db.exec("CREATE TABLE sessions (id TEXT PRIMARY KEY)");
    db.close();
    expect((await probe(root)).machineId).toBeNull();
  });

  it("reads a lock whose pid is dead as nothing running, even with its port answering", async () => {
    const root = await tempRoot();
    const port = await livePort();
    acquireServerLock(root, { pid: deadPid(), port, startedAt: "2026-01-01T00:00:00Z" });
    expect(await probe(root)).toEqual({ running: false, port: null, pid: null, machineId: null });
  });

  it("reads a lock whose pid is alive and whose port answers as a running server", async () => {
    const root = await tempRoot();
    const port = await livePort();
    acquireServerLock(root, { pid: process.pid, port, startedAt: "2026-01-01T00:00:00Z" });
    seedDatabase(root, "LNrJdHAZJ91G58i0");
    // Held open the way the running server holds it, so its WAL files are already there.
    const held = openDatabase(path.join(root, "web.db"));
    closers.push(async () => held.close());
    expect(await probe(root)).toEqual({
      running: true,
      port,
      pid: process.pid,
      machineId: "LNrJdHAZJ91G58i0",
    });
  });
});
