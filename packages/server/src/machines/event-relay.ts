/**
 * Every connected machine's own user-level events, carried into THIS server's event stream.
 *
 * A Session on a machine changes state on that machine's server, and only that server's
 * `GET /api/events` says so. The page used to open that stream itself, one per connected
 * machine, through the `/server/<id>` proxy — and a browser allows six HTTP/1.1 connections to
 * one origin. Five connected machines plus the page's own stream took all six, and every other
 * request the page made — the Machines page's reads, an Add, a probe — waited behind them for
 * good. So the subscription moved here: one per machine, through the ssh session this server
 * already holds to it, and each event it brings is republished on the local user channel as a
 * `machine_event` naming the machine. The page holds ONE stream whatever the number of machines.
 *
 * Resumption is the far side's: the last event id is sent back on a resubscribe, and a machine
 * that can no longer replay from it answers `resync_required`, which is relayed like any other
 * event so the page refetches that machine's rows. A stream that ends is taken up again at
 * once; one that cannot be taken up — the machine's server is gone, the connection dropped —
 * is reported `lost`, and bringing the machine back is the machines service's (service.ts).
 */
import http from "node:http";
import type { ServerEvent } from "../api/types.js";

/** How to reach a machine's server right now; null when it is not connected. */
export interface RelayDial {
  /** Dials the machine's server through the session held to it. */
  agent: http.Agent;
  /** The port its server is on over there. */
  port: number;
  /** A session on that machine, as its own cookie. */
  cookie: string;
}

export interface EventRelayDeps {
  dial: (address: string) => Promise<RelayDial | null>;
  /** One event a machine's server said, for this server's admins. */
  publish: (machineId: string, event: ServerEvent) => void;
  /** The stream could not be taken up again: the machine's server or its connection is gone. */
  lost: (address: string) => void;
  /** The machine refused the session: the next dial must mint a fresh one. */
  refused: (address: string) => void;
}

/** What the machines service holds: the relay, or a stand-in a test provides. */
export interface EventRelay {
  /** Subscribes to a machine's events; a subscription already open is kept. */
  start(address: string, machineId: string): void;
  /** Ends the subscription, and with it any report that it was lost. */
  stop(address: string): void;
  stopAll(): void;
  /** Subscribed, or on the way to it. */
  active(address: string): boolean;
}

/** The far side pings every 20 s; this much silence means the stream died without a word. */
const SILENCE_MS = 50_000;
/** A stream that ended is taken up again after this, times its failures in a row. */
const RESUBSCRIBE_MS = 1_000;
/** Taken up this many times in a row without hearing anything, it is lost. */
const MAX_FAILURES = 3;

interface Subscription {
  machineId: string;
  /** The far side's id of the last event heard, sent back to resume from it. */
  lastEventId: string | null;
  request: http.ClientRequest | null;
  /** Ended on purpose: nothing reopens it and nothing reports it lost. */
  stopped: boolean;
  /** Attempts in a row that heard nothing; reset by the first event of a stream. */
  failures: number;
  watchdog: NodeJS.Timeout | null;
  retry: NodeJS.Timeout | null;
}

/** One frame of `text/event-stream`, as far as this relay reads it. */
interface Frame {
  event: string | null;
  id: string | null;
  data: string[];
}

export class MachineEventRelay implements EventRelay {
  readonly #subs = new Map<string, Subscription>();

  constructor(private readonly deps: EventRelayDeps) {}

  start(address: string, machineId: string): void {
    const existing = this.#subs.get(address);
    if (existing !== undefined && !existing.stopped) {
      existing.machineId = machineId;
      return;
    }
    const sub: Subscription = {
      machineId,
      lastEventId: null,
      request: null,
      stopped: false,
      failures: 0,
      watchdog: null,
      retry: null,
    };
    this.#subs.set(address, sub);
    void this.#open(address, sub);
  }

  stop(address: string): void {
    const sub = this.#subs.get(address);
    if (sub === undefined) return;
    this.#subs.delete(address);
    sub.stopped = true;
    this.#quiet(sub);
  }

  stopAll(): void {
    for (const address of [...this.#subs.keys()]) this.stop(address);
  }

  active(address: string): boolean {
    const sub = this.#subs.get(address);
    return sub !== undefined && !sub.stopped;
  }

  /** Clears the timers and drops the open request, if any. */
  #quiet(sub: Subscription): void {
    if (sub.watchdog !== null) clearTimeout(sub.watchdog);
    if (sub.retry !== null) clearTimeout(sub.retry);
    sub.watchdog = null;
    sub.retry = null;
    const request = sub.request;
    sub.request = null;
    request?.destroy();
  }

  async #open(address: string, sub: Subscription): Promise<void> {
    if (sub.stopped) return;
    let dial: RelayDial | null;
    try {
      dial = await this.deps.dial(address);
    } catch {
      dial = null;
    }
    if (sub.stopped) return;
    if (dial === null) {
      this.#ended(address, sub, null);
      return;
    }
    const request = http.request(
      {
        agent: dial.agent,
        host: "127.0.0.1",
        port: dial.port,
        path: "/api/events",
        method: "GET",
        headers: {
          // The canonical app host, as machine-api.ts explains: 127.0.0.1 is the preview host.
          host: `localhost:${dial.port}`,
          cookie: dial.cookie,
          accept: "text/event-stream",
          ...(sub.lastEventId === null ? {} : { "last-event-id": sub.lastEventId }),
        },
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          // A refused session is a stale cookie (its TTL ran out, the far side's database was
          // replaced), not a dead machine: the next attempt mints another.
          if (res.statusCode === 401) this.deps.refused(address);
          this.#ended(address, sub, request);
          return;
        }
        res.setEncoding("utf8");
        let buffer = "";
        let frame: Frame = { event: null, id: null, data: [] };
        res.on("data", (chunk: string) => {
          if (sub.request !== request) return;
          sub.failures = 0;
          this.#arm(address, sub, request);
          buffer += chunk;
          for (let nl = buffer.indexOf("\n"); nl !== -1; nl = buffer.indexOf("\n")) {
            const line = buffer.slice(0, nl).replace(/\r$/, "");
            buffer = buffer.slice(nl + 1);
            if (line === "") {
              this.#dispatch(sub, frame);
              frame = { event: null, id: null, data: [] };
              continue;
            }
            if (line.startsWith(":")) continue;
            const colon = line.indexOf(":");
            const field = colon === -1 ? line : line.slice(0, colon);
            const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
            if (field === "event") frame.event = value;
            else if (field === "id") frame.id = value;
            else if (field === "data") frame.data.push(value);
          }
        });
        const over = () => this.#ended(address, sub, request);
        res.on("end", over);
        res.on("error", over);
        res.on("close", over);
      },
    );
    request.on("error", () => this.#ended(address, sub, request));
    sub.request = request;
    this.#arm(address, sub, request);
    request.end();
  }

  /** (Re)starts the silence watchdog for the request that is open. */
  #arm(address: string, sub: Subscription, request: http.ClientRequest): void {
    if (sub.watchdog !== null) clearTimeout(sub.watchdog);
    sub.watchdog = setTimeout(() => this.#ended(address, sub, request), SILENCE_MS);
    sub.watchdog.unref?.();
  }

  #dispatch(sub: Subscription, frame: Frame): void {
    if (frame.id !== null && frame.id !== "") sub.lastEventId = frame.id;
    // The user channel carries server events only; its pings and any other frame are the
    // stream's own business. `hello` is a handshake, not news.
    if (frame.event !== "server_event" || frame.data.length === 0) return;
    let event: ServerEvent;
    try {
      event = JSON.parse(frame.data.join("\n")) as ServerEvent;
    } catch {
      return;
    }
    if (typeof event !== "object" || event === null || event.type === "hello") return;
    try {
      this.deps.publish(sub.machineId, event);
    } catch {
      // Publishing is the caller's; a failure there must not end the subscription.
    }
  }

  /**
   * A stream ended — or never began. Taken up again unless it was stopped; after
   * MAX_FAILURES attempts in a row that heard nothing, it is reported lost and let go.
   * `request` guards against a late event of a request already replaced.
   */
  #ended(address: string, sub: Subscription, request: http.ClientRequest | null): void {
    if (sub.stopped || (request !== null && sub.request !== request)) return;
    this.#quiet(sub);
    sub.failures += 1;
    if (sub.failures >= MAX_FAILURES) {
      sub.stopped = true;
      if (this.#subs.get(address) === sub) this.#subs.delete(address);
      this.deps.lost(address);
      return;
    }
    sub.retry = setTimeout(() => void this.#open(address, sub), RESUBSCRIBE_MS * sub.failures);
    sub.retry.unref?.();
  }
}
