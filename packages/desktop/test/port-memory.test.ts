import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { choosePort, readPreferredPort, rememberPreferredPort } from "../src/port-memory.js";

let tmpDir: string | null = null;

function memoryFile(): string {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-port-memory-"));
  return path.join(tmpDir, "nested", "preferred-port");
}

afterEach(() => {
  if (tmpDir !== null) fs.rmSync(tmpDir, { recursive: true, force: true });
  tmpDir = null;
});

function listen(host: string, port = 0): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen({ port, host, exclusive: true }, () => resolve(server));
  });
}

function close(server: net.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

/**
 * An OS-assigned port that is free on both loopback stacks (choosePort probes both, and
 * on a shared machine `::1:<port>` may belong to someone else). A missing IPv6 stack
 * does not disqualify the port — choosePort ignores it the same way.
 */
async function freeLoopbackPort(): Promise<number> {
  for (;;) {
    const v4 = await listen("127.0.0.1");
    const port = (v4.address() as net.AddressInfo).port;
    try {
      const v6 = await listen("::1", port);
      await close(v6);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") {
        await close(v4);
        continue;
      }
    }
    await close(v4);
    return port;
  }
}

describe("preferred-port memory file", () => {
  it("round-trips a remembered port, creating parent directories", () => {
    const file = memoryFile();
    expect(readPreferredPort(file)).toBeNull();
    rememberPreferredPort(file, 41873);
    expect(readPreferredPort(file)).toBe(41873);
  });

  it("treats a corrupt file as no memory", () => {
    const file = memoryFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "not a port\n");
    expect(readPreferredPort(file)).toBeNull();
  });
});

describe("choosePort", () => {
  it("asks for an ephemeral port when there is no memory", async () => {
    expect(await choosePort(null)).toBe(0);
  });

  it("reuses the preferred port while it is free", async () => {
    const port = await freeLoopbackPort();
    expect(await choosePort(port)).toBe(port);
  });

  it("falls back to an ephemeral port when the preferred one is taken", async () => {
    const squatter = await listen("127.0.0.1");
    const port = (squatter.address() as net.AddressInfo).port;
    try {
      expect(await choosePort(port)).toBe(0);
    } finally {
      await close(squatter);
    }
  });
});
