/**
 * What this process answers when there is no App to answer with: the entry binds the port
 * before `start` has built one, and the seam can find no generation current. Both are 503
 * with the reason. Only the first ends by itself, so only it asks for a retry — and only it
 * has a socket counterpart, since an upgrade never reaches the fetch handler that answers it.
 */
import type { IncomingMessage, Server as HttpServer } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer } from "ws";

/** RFC 6455's "Try Again Later": what a socket hears where a request hears the starting 503. */
export const TRY_AGAIN_LATER = 1013;

const STARTING = "penguin-server is starting";

export function startingResponse(): Response {
  return unavailable(STARTING, true);
}

export function noPlatformResponse(reason: string): Response {
  return unavailable(`penguin-server has no running platform: ${reason}`, false);
}

/**
 * The starting answer for an upgrade: until `serving()` says the App answers, every WebSocket
 * handshake is completed and closed at once with 1013, the socket's own word for "starting".
 * Refused with a status instead, the client could not tell a server that is starting from one
 * without a socket — a browser sees only 1006, and a hub dialling a machine reads any answered
 * refusal as a build with no socket and stops asking for a while. Nothing is read from the
 * platform meanwhile: this is the one listener that acts until the App's own are attached (the
 * entry attaches them once its startup has finished), and from then on it stands aside.
 */
export function answerStartingUpgrades(server: HttpServer, serving: () => boolean): void {
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (serving()) return;
    try {
      wss.handleUpgrade(req, socket, head, (ws) => ws.close(TRY_AGAIN_LATER, STARTING));
    } catch {
      // Nothing a handshake can be completed on: there is nobody to tell, and nothing to keep.
      socket.destroy();
    }
  });
}

function unavailable(text: string, retry: boolean): Response {
  return new Response(text, {
    status: 503,
    headers: {
      ...(retry ? { "retry-after": "1" } : {}),
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
    },
  });
}
