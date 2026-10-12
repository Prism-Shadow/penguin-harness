/**
 * A one-time Project-config migration, and the server that holds the data root.
 *
 * Given a `.project_config.toml` that still names a client type from before MMSP:
 * - When no server holds the root, its lock is left by a server that has gone, the server
 *   holding it is this release (a hot-pushed build of it included) or a newer one, or the lock
 *   is this very process's: loading migrates the table and writes the file back.
 * - When a live server older than this code holds the root, by its release number or by
 *   recording no version at all (every server from before the field): loading returns the
 *   migrated config, the file stays byte for byte as it was, and one warning per root names
 *   that server — however many loads follow.
 */
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VERSION } from "../src/index.js";
import {
  DEFAULT_PROJECT_ID,
  getModel,
  loadProjectConfig,
  projectConfigPath,
  serverLockPath,
} from "../src/state/index.js";

const LEGACY = [
  "[[models]]",
  'provider = "custom"',
  'model_id = "relay-flash"',
  'client_type = "deepseek-v4"',
  'base_url = "https://relay.example/v1"',
  "",
].join("\n");

let root: string;
let file: string;
let listener: net.Server | undefined;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-write-back-"));
  file = projectConfigPath(root, DEFAULT_PROJECT_ID);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, LEGACY, "utf8");
});

afterEach(async () => {
  vi.restoreAllMocks();
  await new Promise<void>((resolve) => (listener ? listener.close(() => resolve()) : resolve()));
  listener = undefined;
  await fs.rm(root, { recursive: true, force: true });
});

/** A port that accepts connections, as a running server's does. */
async function openPort(): Promise<number> {
  listener = net.createServer();
  await new Promise<void>((resolve) => listener!.listen(0, "127.0.0.1", resolve));
  return (listener.address() as net.AddressInfo).port;
}

/** A port nothing listens on any more: the server that recorded it is gone. */
async function closedPort(): Promise<number> {
  const port = await openPort();
  await new Promise<void>((resolve) => listener!.close(() => resolve()));
  listener = undefined;
  return port;
}

/**
 * Another live process stands in for the server: this test's parent, which is alive and is
 * not this process.
 */
async function lockRoot(lock: { pid?: number; port: number; version?: string }): Promise<void> {
  await fs.writeFile(
    serverLockPath(root),
    JSON.stringify({ pid: process.ppid, startedAt: "2026-10-12T00:00:00.000Z", ...lock }),
  );
}

async function loadedClientType(): Promise<string | undefined> {
  const cfg = await loadProjectConfig(root, DEFAULT_PROJECT_ID);
  return getModel(cfg, { provider: "custom", model_id: "relay-flash" })?.client_type;
}

describe("writing a migrated Project config back", () => {
  it.each<{ when: string; arrange: () => Promise<void> }>([
    { when: "no server holds the root", arrange: async () => {} },
    {
      when: "the older server that held it has gone",
      arrange: async () => lockRoot({ port: await closedPort(), version: "0.1.0" }),
    },
    {
      when: "the live server is a hot-pushed build of this release",
      arrange: async () => lockRoot({ port: await openPort(), version: `${VERSION}+hmr.0a1b2c` }),
    },
    {
      when: "the live server is a newer release",
      arrange: async () => lockRoot({ port: await openPort(), version: "99.0.0" }),
    },
    {
      when: "the lock is this process's, whatever version it records",
      arrange: async () => lockRoot({ pid: process.pid, port: await openPort(), version: "0.1.0" }),
    },
  ])("writes it back when $when", async ({ arrange }) => {
    await arrange();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(await loadedClientType()).toBe("deepseek-official");
    const written = await fs.readFile(file, "utf8");
    expect(written).toContain('client_type = "deepseek-official"');
    expect(written).not.toContain("deepseek-v4");
    expect(warn).not.toHaveBeenCalled();
  });

  it("leaves the file as it was while an older live server holds the root, and warns once", async () => {
    const port = await openPort();
    await lockRoot({ port, version: "0.1.0" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(await loadedClientType()).toBe("deepseek-official");
    expect(await loadedClientType()).toBe("deepseek-official");
    expect(await fs.readFile(file, "utf8")).toBe(LEGACY);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain(`pid ${process.ppid}, port ${port}, v0.1.0`);
  });

  it("counts a live server whose lock records no version as older", async () => {
    await lockRoot({ port: await openPort() });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(await loadedClientType()).toBe("deepseek-official");
    expect(await fs.readFile(file, "utf8")).toBe(LEGACY);
    expect(String(warn.mock.calls[0]![0])).toContain("no version recorded");
  });
});
