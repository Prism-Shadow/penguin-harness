/**
 * Readiness is the App answering, not the port accepting: the server binds before it has
 * built the App and answers 503 until it has. A probe that returned on that answer would
 * load the window against the "starting" page and leave it there.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

// The module under test forks the server as an Electron utilityProcess; loading the real
// `electron` package outside the app would fetch its binary, and none of it is reached here.
vi.mock("electron", () => ({ app: {}, utilityProcess: {} }));
const { waitForHttp } = await import("../src/server-process.js");

let server: http.Server | null = null;

afterEach(async () => {
  if (server !== null) await new Promise((resolve) => server!.close(resolve));
  server = null;
});

/** A server that answers 503 the first `starting` times, then 200. Returns its origin. */
async function serving(starting: number): Promise<{ origin: string; asked: () => number }> {
  let asked = 0;
  server = http.createServer((_req, res) => {
    asked += 1;
    res.writeHead(asked <= starting ? 503 : 200).end("body");
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  return {
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    asked: () => asked,
  };
}

describe("waitForHttp", () => {
  it("keeps asking while the server answers 503, and returns on the App's own answer", async () => {
    const { origin, asked } = await serving(2);
    await waitForHttp(origin, () => false);
    expect(asked()).toBe(3);
  });

  it("gives up when the server process dies mid-startup", async () => {
    const { origin } = await serving(Number.MAX_SAFE_INTEGER);
    await expect(waitForHttp(origin, () => true)).rejects.toThrow(/exited during startup/);
  });
});
