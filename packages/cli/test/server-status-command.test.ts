/**
 * `penguin server status` (commands/server-status.ts), driven through `cli()` in-process
 * against real data roots: the one line of JSON a controller parses over ssh, for an empty
 * root, a live lock, the two ways a lock is stale, a web.db that is not a Penguin database,
 * where the root comes from (--root over PENGUIN_HOME) and where the database comes from
 * (PENGUIN_WEB_DB over <root>/web.db). Every probe is checked to leave the root as it found it.
 *
 * A non-null machineId is not driven here: it needs a web.db carrying the server's schema, and
 * openDatabase / MachinesRepo are not reachable from this package (the reader itself is covered
 * in the server package).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { acquireServerLock } from "@prismshadow/penguin-server/lock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cli } from "../src/index.js";

/** Every test starts without these and gets back what was there. */
const ENV_KEYS = ["PENGUIN_HOME", "PENGUIN_WEB_DB"];
const saved = new Map<string, string | undefined>();

let root: string;
let stdout: string[];
let stderr: string[];
let outSpy: { mockRestore(): void };
let errSpy: { mockRestore(): void };
const cleanups: Array<() => Promise<void> | void> = [];

beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved.set(key, process.env[key]);
    delete process.env[key];
  }
  root = tempRoot();
  stdout = [];
  stderr = [];
  outSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout.push(String(chunk));
    return true;
  });
  errSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });
});
afterEach(async () => {
  outSpy.mockRestore();
  errSpy.mockRestore();
  for (const cleanup of cleanups.splice(0)) await cleanup();
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const out = () => stdout.join("");
const err = () => stderr.join("");

function tempRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-cli-server-status-"));
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** The root's entries with their sizes — what a probe must leave exactly as it found. */
function snapshot(dir: string): Record<string, number> {
  const entries: Record<string, number> = {};
  for (const name of fs.readdirSync(dir).sort()) {
    entries[name] = fs.statSync(path.join(dir, name)).size;
  }
  return entries;
}

/** The exact line the command prints, in the key order a controller reads. */
function line(status: {
  running: boolean;
  port: number | null;
  pid: number | null;
  machineId: string | null;
}): string {
  return JSON.stringify(status) + "\n";
}

const NOTHING = { running: false, port: null, pid: null, machineId: null };

/** A loopback port that accepts TCP until the test ends. */
async function listening(): Promise<number> {
  const listener = net.createServer((socket) => socket.destroy());
  await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise<void>((resolve) => listener.close(() => resolve())));
  return (listener.address() as AddressInfo).port;
}

/** A loopback port nothing listens on (bound, then released). */
async function deadPort(): Promise<number> {
  const probe = net.createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = (probe.address() as AddressInfo).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

/** The pid of a child that has already exited. */
function deadPid(): number {
  const child = spawnSync(process.execPath, ["-e", ""]);
  expect(child.pid).toBeGreaterThan(0);
  return child.pid!;
}

describe("penguin server status", () => {
  it("an empty root: nothing running, no id, exit 0, and the root stays empty", async () => {
    const code = await cli(["server", "status", "--root", root]);
    expect(code).toBe(0);
    expect(out()).toBe(line(NOTHING));
    expect(err()).toBe("");
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it("a live lock (pid alive, port accepting) reports running with that port and pid", async () => {
    const port = await listening();
    acquireServerLock(root, { pid: process.pid, port, startedAt: "2026-09-01T00:00:00.000Z" });
    const before = snapshot(root);
    const code = await cli(["server", "status", "--root", root]);
    expect(code).toBe(0);
    expect(out()).toBe(line({ running: true, port, pid: process.pid, machineId: null }));
    expect(snapshot(root)).toEqual(before);
  });

  it("a lock whose port no longer answers is stale: not running, no port or pid", async () => {
    acquireServerLock(root, { pid: process.pid, port: await deadPort(), startedAt: "" });
    const before = snapshot(root);
    const code = await cli(["server", "status", "--root", root]);
    expect(code).toBe(0);
    expect(out()).toBe(line(NOTHING));
    // The stale lock is reported, not cleaned up.
    expect(snapshot(root)).toEqual(before);
  });

  it("a lock whose pid is gone is stale even while its port answers", async () => {
    acquireServerLock(root, { pid: deadPid(), port: await listening(), startedAt: "" });
    const code = await cli(["server", "status", "--root", root]);
    expect(code).toBe(0);
    expect(out()).toBe(line(NOTHING));
  });

  it("a web.db that is not a Penguin database answers no id, and is left untouched", async () => {
    fs.writeFileSync(path.join(root, "web.db"), "");
    const before = snapshot(root);
    const code = await cli(["server", "status", "--root", root]);
    expect(code).toBe(0);
    expect(out()).toBe(line(NOTHING));
    expect(err()).toBe("");
    expect(snapshot(root)).toEqual(before);
  });

  it("without --root the root is PENGUIN_HOME", async () => {
    const port = await listening();
    acquireServerLock(root, { pid: process.pid, port, startedAt: "" });
    process.env.PENGUIN_HOME = root;
    const code = await cli(["server", "status"]);
    expect(code).toBe(0);
    expect(out()).toBe(line({ running: true, port, pid: process.pid, machineId: null }));
  });

  it("--root wins over PENGUIN_HOME", async () => {
    const served = tempRoot();
    acquireServerLock(served, { pid: process.pid, port: await listening(), startedAt: "" });
    process.env.PENGUIN_HOME = served;
    const code = await cli(["server", "status", "--root", root]);
    expect(code).toBe(0);
    expect(out()).toBe(line(NOTHING));
  });

  it("PENGUIN_WEB_DB is the database it opens: one that cannot be opened fails the command", async () => {
    // <root>/web.db does not exist, which on its own answers `machineId: null`. The variable
    // names a directory instead, so the only way to fail is to have opened what it names.
    const elsewhere = path.join(tempRoot(), "not-a-file");
    fs.mkdirSync(elsewhere);
    process.env.PENGUIN_WEB_DB = elsewhere;
    const code = await cli(["server", "status", "--root", root]);
    expect(code).toBe(1);
    expect(out()).toBe("");
    expect(err()).not.toBe("");
    expect(fs.readdirSync(root)).toEqual([]);
  });
});
