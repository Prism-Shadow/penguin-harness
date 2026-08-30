/**
 * The one `upgrade` listener on each HTTP listener, and the routes under it.
 *
 * Node destroys an upgrade socket nobody handles — but ONLY while no `upgrade` listener is
 * registered at all. Register one and that default is gone for every path, including the
 * ones that listener declines. Two independent listeners (the terminal transport and the
 * machines proxy) each declining silently therefore does not mean "nobody handled it": it
 * means the socket is left open, and the browser waits on a handshake that will never be
 * answered. A hang is the worst answer available — it carries no information at all, and
 * looks exactly like a slow machine.
 *
 * So there is one listener, it tries each route in order, and a path no route claims is
 * refused immediately and by name.
 */
import type { IncomingMessage, Server as HttpServer } from "node:http";
import type { Duplex } from "node:stream";

/**
 * One upgrade route. Returns true when it has taken responsibility for the socket — which
 * INCLUDES refusing it: a route that answers 401 has handled the request. False means only
 * "this path is not mine", and the next route is tried.
 */
export type UpgradeRoute = (req: IncomingMessage, socket: Duplex, head: Buffer) => boolean;

export function attachUpgradeRoutes(server: HttpServer, routes: readonly UpgradeRoute[]): void {
  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    for (const route of routes) {
      if (route(req, socket, head)) return;
    }
    refuseUpgrade(socket, 404, "Not Found");
  });
}

/** Answers a handshake with an ordinary HTTP status and closes. */
export function refuseUpgrade(socket: Duplex, status: number, text: string): void {
  socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}
