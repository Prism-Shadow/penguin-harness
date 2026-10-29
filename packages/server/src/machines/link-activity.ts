/**
 * When bytes last came in from each machine, over any connection dialled to it.
 *
 * Everything this server exchanges with a machine shares one link: the ssh session its
 * connections are channels of (transport/connection.ts) — the API socket the streams ride, and
 * one connection per proxied request beside it (proxy.ts proxyThroughSession). On a slow link the
 * machine's ssh server queues those channels' bytes behind one another, so a stream on the socket
 * can hear nothing for longer than its watchdog while a large proxied answer crosses the same
 * link: the link is busy, not silent. A stream's liveness is therefore the link's — any byte from
 * the machine, on any of its connections (history-sync.ts reads `heardAt`).
 */
import type http from "node:http";
import type { Duplex } from "node:stream";

type CreateConnection = (
  options: unknown,
  callback: (err: Error | null, socket?: Duplex) => void,
) => Duplex | undefined | null;

/** The last time bytes arrived from each machine, by machine id. */
export class LinkActivity {
  readonly #heard = new Map<string, number>();
  readonly #now: () => number;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  /**
   * `agent`, its every connection marking `machineId` heard whenever bytes arrive on it. The
   * listener goes on after the connection's own reader has taken it (a `data` listener puts a
   * stream in flowing mode, which must not hand bytes out before their reader is there).
   */
  tap(machineId: string, agent: http.Agent): http.Agent {
    const holder = agent as unknown as { createConnection?: CreateConnection };
    if (typeof holder.createConnection !== "function") return agent;
    const create = holder.createConnection.bind(agent);
    const tapped = new WeakSet<Duplex>();
    const mark = (socket: Duplex | undefined | null): void => {
      if (socket === undefined || socket === null || tapped.has(socket)) return;
      tapped.add(socket);
      setImmediate(() => {
        if (!socket.destroyed) socket.on("data", () => this.heard(machineId));
      });
    };
    holder.createConnection = (options, callback) => {
      // A dial answers either way: a socket returned (node's own, whose callback is then only
      // its connect listener) or one handed to the callback (transport/connection.ts's).
      const socket = create(options, (err, made) => {
        if (!err) mark(made);
        callback(err, made);
      });
      mark(socket);
      return socket;
    };
    return agent;
  }

  /** Marks `machineId` heard now. */
  heard(machineId: string): void {
    this.#heard.set(machineId, this.#now());
  }

  /** When bytes last came in from `machineId`; null when none has since this server started. */
  heardAt(machineId: string): number | null {
    return this.#heard.get(machineId) ?? null;
  }
}
