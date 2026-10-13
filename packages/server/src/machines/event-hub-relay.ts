/** The service's event supervision, reading the socket hub's one upstream per machine. */
import type { ServerEvent } from "../api/types.js";
import type { EventRelay, EventRelayDeps, RelayDial } from "./event-relay.js";
import type { MachineEventHub } from "./event-hub.js";

interface Subscription {
  machineId: string;
  lastEventId: string | null;
  failures: number;
  stopped: boolean;
  detach: (() => void) | null;
  retry: ReturnType<typeof setTimeout> | null;
  watchdog: ReturnType<typeof setTimeout> | null;
}

/** Same supervision thresholds as MachineEventRelay; transport silence remains distinct from SSH loss. */
const SILENCE_MS = 50_000;
const RESUBSCRIBE_MS = 1_000;
const MAX_FAILURES = 3;

export class SocketEventRelay implements EventRelay {
  readonly #subs = new Map<string, Subscription>();

  constructor(
    private readonly deps: EventRelayDeps,
    private readonly hub: MachineEventHub,
  ) {}

  start(address: string, machineId: string): void {
    const existing = this.#subs.get(address);
    if (existing !== undefined) {
      existing.machineId = machineId;
      return;
    }
    const sub: Subscription = {
      machineId,
      lastEventId: null,
      failures: 0,
      stopped: false,
      detach: null,
      retry: null,
      watchdog: null,
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
    return this.#subs.has(address);
  }

  #quiet(sub: Subscription): void {
    if (sub.retry !== null) clearTimeout(sub.retry);
    if (sub.watchdog !== null) clearTimeout(sub.watchdog);
    sub.retry = null;
    sub.watchdog = null;
    const detach = sub.detach;
    sub.detach = null;
    detach?.();
  }

  async #open(address: string, sub: Subscription): Promise<void> {
    const dial = await this.deps.dial(address).catch(() => null);
    if (sub.stopped) return;
    // Production dials carry the held SSH session's identity; never cache without it.
    const target = dial as (RelayDial & { session?: number }) | null;
    if (target === null || typeof target.session !== "number") {
      this.#ended(address, sub);
      return;
    }
    let ended = false;
    const end = () => {
      if (ended || sub.stopped) return;
      ended = true;
      this.#ended(address, sub);
    };
    const arm = () => {
      if (sub.watchdog !== null) clearTimeout(sub.watchdog);
      sub.watchdog = setTimeout(end, SILENCE_MS);
      sub.watchdog.unref?.();
    };
    arm();
    const detach = this.hub.subscribe(
      sub.machineId,
      { ...target, session: target.session },
      sub.lastEventId,
      {
        onStart: () => {},
        onEvent: (frame) => {
          if (ended || sub.stopped) return;
          // The hub synthesizes a reader's hello; it is not evidence from the machine.
          if (frame.event === "server_event" && frame.data === '{"type":"hello"}') return;
          sub.failures = 0;
          arm();
          if (frame.eventId !== null) sub.lastEventId = frame.eventId;
          if (frame.event !== "server_event") return;
          let event: ServerEvent;
          try {
            event = JSON.parse(frame.data) as ServerEvent;
          } catch {
            return;
          }
          if (event === null || typeof event !== "object" || event.type === "hello") return;
          try {
            this.deps.publish(sub.machineId, event);
          } catch {
            // Publishing must not end a machine's subscription.
          }
        },
        onEnd: end,
        onResponse: (status) => {
          if (ended || sub.stopped) return;
          if (status === 401) this.deps.refused(address);
          end();
        },
      },
    );
    // subscribe can synchronously deliver a preamble or end an already-open reader.
    if (ended || sub.stopped) detach();
    else sub.detach = detach;
  }

  #ended(address: string, sub: Subscription): void {
    if (sub.stopped) return;
    this.#quiet(sub);
    sub.failures += 1;
    if (sub.failures >= MAX_FAILURES) {
      this.stop(address);
      this.deps.lost(address);
      return;
    }
    sub.retry = setTimeout(() => {
      sub.retry = null;
      void this.#open(address, sub);
    }, RESUBSCRIBE_MS * sub.failures);
    sub.retry.unref?.();
  }
}
