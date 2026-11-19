/**
 * The platform's WebSocket seam: where the runtime hands an upgrade to the current generation.
 *
 * A live socket cannot cross the HTTP seam (http-seam.ts) — there is no Response to return for
 * it — so a WebSocket endpoint would otherwise have to live in the runtime, which a push cannot
 * update. Instead a module contributes it (`HttpModule.upgrades`, http/app.ts) and this seam, one
 * listener per Node server, offers every upgrade to the generation current at that moment
 * (`Http.upgrade`). The endpoint answers the handshake itself; what the runtime keeps is only
 * the dispatch. A terminal's stream and the API socket are the runtime's own upgrades
 * (terminal/ws.ts) and are never offered.
 *
 * A generation that serves no endpoint for the path declines; the fallback then gets the socket
 * — what this runtime still does for a platform pushed before the slot (legacy-browser.ts) —
 * and a socket nobody takes is left alone, as an upgrade no listener claims always was.
 */
import type { IncomingMessage, Server as HttpServer } from "node:http";
import type { Duplex } from "node:stream";

/** The part of a generation's HTTP surface this seam calls (http/app.ts, `Http.upgrade`). */
export interface UpgradeSurface {
  /** Absent on a platform pushed before the slot. */
  upgrade?(request: IncomingMessage, socket: Duplex, head: Buffer): boolean;
}

export interface UpgradeSeamDeps {
  /** The current generation's HTTP surface; null when there is none (a bare kernel, no tree). */
  current(): Promise<UpgradeSurface | null>;
  /** The runtime's own upgrade paths, which another listener serves. */
  reserved(pathname: string): boolean;
  /** Tried when the generation took nothing; true when it took the socket. */
  fallback?(request: IncomingMessage, socket: Duplex, head: Buffer): boolean;
  log(line: string): void;
}

export function attachUpgradeSeam(server: HttpServer, deps: UpgradeSeamDeps): void {
  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    if (deps.reserved(pathname)) return;
    void deps
      .current()
      .then((surface) => {
        if (surface?.upgrade?.(req, socket, head) === true) return;
        deps.fallback?.(req, socket, head);
      })
      .catch((err: unknown) => {
        deps.log(
          `[upgrade] ${pathname} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        if (socket.destroyed) return;
        socket.write("HTTP/1.1 500 Internal Server Error\r\nConnection: close\r\n\r\n");
        socket.destroy();
      });
  });
}
