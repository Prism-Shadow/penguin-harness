/**
 * Server instance lock: read/acquire/release round-trip, stale detection (dead pid,
 * dead port), and the live path against a real loopback listener.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  acquireServerLock,
  isServerLockAlive,
  liveServerLock,
  readServerLock,
  releaseServerLock,
  serverLockPath,
} from "../src/lock.js";
import { makeTempRoot } from "./helpers.js";

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
      resolve({
        port,
        close: () => new Promise((r) => srv.close(() => r())),
      });
    });
  });
}

describe("server lock", () => {
  const roots: string[] = [];
  afterEach(async () => {
    for (const root of roots.splice(0)) {
      await fs.promises.rm(root, { recursive: true, force: true });
    }
  });

  async function tempRoot(): Promise<string> {
    const root = await makeTempRoot();
    roots.push(root);
    return root;
  }

  it("reads null on a missing or malformed file, and round-trips acquire/read", async () => {
    const root = await tempRoot();
    expect(readServerLock(root)).toBeNull();
    fs.writeFileSync(serverLockPath(root), "not json");
    expect(readServerLock(root)).toBeNull();
    fs.writeFileSync(serverLockPath(root), JSON.stringify({ pid: "x", port: 1 }));
    expect(readServerLock(root)).toBeNull();

    acquireServerLock(root, { pid: process.pid, port: 12345, startedAt: "2026-01-01T00:00:00Z" });
    expect(readServerLock(root)).toEqual({
      pid: process.pid,
      port: 12345,
      startedAt: "2026-01-01T00:00:00Z",
    });
  });

  it("treats a dead pid as stale even if the port is live", async () => {
    const { port, close } = await listen();
    try {
      expect(await isServerLockAlive({ pid: deadPid(), port, startedAt: "" })).toBe(false);
    } finally {
      await close();
    }
  });

  it("treats a dead port as stale even if the pid is live", async () => {
    const { port, close } = await listen();
    await close(); // the port is now free — nothing accepts connections
    expect(await isServerLockAlive({ pid: process.pid, port, startedAt: "" })).toBe(false);
  });

  it("reports alive when pid and port both check out, and liveServerLock surfaces it", async () => {
    const root = await tempRoot();
    const { port, close } = await listen();
    try {
      const lock = { pid: process.pid, port, startedAt: "now" };
      expect(await isServerLockAlive(lock)).toBe(true);
      acquireServerLock(root, lock);
      expect(await liveServerLock(root)).toEqual(lock);
    } finally {
      await close();
    }
    expect(await liveServerLock(root)).toBeNull(); // stale once the listener is gone
  });

  it("release removes only a lock owned by this process", async () => {
    const root = await tempRoot();
    acquireServerLock(root, { pid: deadPid(), port: 1, startedAt: "" });
    releaseServerLock(root); // foreign pid: left in place
    expect(readServerLock(root)).not.toBeNull();

    acquireServerLock(root, { pid: process.pid, port: 1, startedAt: "" });
    releaseServerLock(root);
    expect(readServerLock(root)).toBeNull();
  });
});
