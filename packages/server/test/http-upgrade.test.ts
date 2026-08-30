/**
 * An upgrade nobody claims is refused, not left open (src/http-upgrade.ts).
 *
 * Node destroys an unhandled upgrade socket only while NO `upgrade` listener is registered.
 * Register one — the terminal transport does — and that default is gone for every path,
 * including ones that listener declines. Two independent listeners each returning silently
 * therefore leaves the socket open, and the browser waits forever on a handshake that will
 * never be answered.
 *
 * That is how a terminal on a machine presented before there was a router: not an error, not
 * a refusal, just a pane stuck on "connecting" — indistinguishable from a slow machine, and
 * carrying no information at all. Hence one listener, ordered routes, and a named refusal
 * for a path none of them wants.
 */
import { afterEach, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import net from "node:net";
import { attachUpgradeRoutes, refuseUpgrade, type UpgradeRoute } from "../src/http-upgrade.js";

let server: http.Server | null = null;

afterEach(async () => {
  if (server !== null) await new Promise<void>((resolve) => server?.close(() => resolve()));
  server = null;
});

/** Starts a server with these routes and returns the raw first line of an upgrade attempt. */
async function handshake(routes: UpgradeRoute[], path: string): Promise<string> {
  server = http.createServer((_req, res) => res.end("body"));
  attachUpgradeRoutes(server, routes);
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return new Promise<string>((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1", () => {
      socket.write(
        `GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n` +
          "Connection: Upgrade\r\nUpgrade: websocket\r\n" +
          "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n",
      );
    });
    let seen = "";
    socket.on("data", (chunk) => {
      seen += chunk.toString();
      if (seen.includes("\r\n")) {
        socket.destroy();
        resolve(seen.split("\r\n")[0]!);
      }
    });
    socket.on("error", reject);
    // The bug this file exists for: no answer at all. A test that waited forever would
    // reproduce it rather than report it.
    socket.setTimeout(2_000, () => {
      socket.destroy();
      resolve("(no answer)");
    });
  });
}

const claims = (prefix: string, status: number): UpgradeRoute => {
  return (req, socket) => {
    if (!(req.url ?? "").startsWith(prefix)) return false;
    refuseUpgrade(socket, status, "Claimed");
    return true;
  };
};

describe("the upgrade router", () => {
  it("refuses a path no route claims, rather than leaving it hanging", async () => {
    expect(await handshake([claims("/a", 401)], "/nowhere")).toBe("HTTP/1.1 404 Not Found");
  });

  it("refuses it even when there are no routes at all", async () => {
    expect(await handshake([], "/nowhere")).toBe("HTTP/1.1 404 Not Found");
  });

  it("gives the socket to the first route that claims it", async () => {
    expect(await handshake([claims("/a", 401), claims("/", 403)], "/a/b")).toBe(
      "HTTP/1.1 401 Claimed",
    );
  });

  it("keeps trying past a route that declines", async () => {
    // Declining says only "not my path" — the next route still gets its turn. A router that
    // stopped at the first `false` would 404 every path but the first route's.
    expect(await handshake([claims("/a", 401), claims("/b", 403)], "/b/c")).toBe(
      "HTTP/1.1 403 Claimed",
    );
  });
});
