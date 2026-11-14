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

/** How far back the link's rate is measured. */
const RATE_SPAN_MS = 10_000;

/** The last time bytes arrived from each machine, and how fast, by machine id. */
export class LinkActivity {
  readonly #heard = new Map<string, number>();
  /** Bytes per whole second of the last RATE_SPAN_MS, oldest first, by machine id. */
  readonly #seconds = new Map<string, Array<{ second: number; bytes: number }>>();
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
        if (!socket.destroyed) {
          socket.on("data", (chunk: Buffer) => this.heard(machineId, chunk.length));
        }
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

  /** Marks `machineId` heard now, `bytes` having come in. */
  heard(machineId: string, bytes = 0): void {
    const now = this.#now();
    this.#heard.set(machineId, now);
    const second = Math.floor(now / 1000);
    const seconds = this.#seconds.get(machineId) ?? [];
    const last = seconds.at(-1);
    if (last?.second === second) last.bytes += bytes;
    else seconds.push({ second, bytes });
    while (seconds.length > 0 && seconds[0]!.second <= second - RATE_SPAN_MS / 1000)
      seconds.shift();
    this.#seconds.set(machineId, seconds);
  }

  /**
   * The bytes per second that came from `machineId` over the last RATE_SPAN_MS (counted from the
   * first second heard in it); 0 when nothing did.
   */
  rate(machineId: string): number {
    const seconds = this.#seconds.get(machineId);
    if (seconds === undefined || seconds.length === 0) return 0;
    const now = Math.floor(this.#now() / 1000);
    const live = seconds.filter((entry) => entry.second > now - RATE_SPAN_MS / 1000);
    if (live.length === 0) return 0;
    const span = now - live[0]!.second + 1;
    return live.reduce((sum, entry) => sum + entry.bytes, 0) / span;
  }

  /** When bytes last came in from `machineId`; null when none has since this server started. */
  heardAt(machineId: string): number | null {
    return this.#heard.get(machineId) ?? null;
  }
}
