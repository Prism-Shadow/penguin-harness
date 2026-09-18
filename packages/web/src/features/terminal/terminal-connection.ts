/**
 * The terminal socket's LIFE: the first attach, the heartbeat, and every reattach after a
 * link that dropped it. Kept out of terminal-view.tsx because none of it is about xterm,
 * and because a state machine with three timers is worth testing on its own.
 *
 * The reason it exists is a phone. On a mobile network the socket does not close politely:
 * the radio hands over, the carrier's NAT reaps an idle flow, the browser freezes the tab,
 * and what the page is left holding is a socket that will never carry another byte. Before
 * this, that state was terminal — `onclose` painted "stream closed" and the pane was dead
 * until the user reloaded the page — even though the pty on the server was fine and one
 * reattach would have repainted it from the server's own snapshot.
 *
 * So: probe for silence, retry with a bounded backoff, and treat a returning tab or a
 * returning network as a reason to try immediately rather than to wait out the timer.
 * A retry first asks whether the terminal is still there, because a gone terminal is the
 * one failure worth stopping on.
 */
import { TerminalOpcode, decodeFrame, encodeFrame, type DecodedFrame } from "./terminal-frames";

/**
 * How the client probes: one Ping per interval, and silence past the limit is a dead socket
 * — but only from a server that has ANSWERED a probe. A server from before the heartbeat
 * ignores the opcode, and an idle terminal on one is silent for perfectly good reasons; a
 * client that judged that silence would reattach every minute, snapshot and all, forever.
 */
const HEARTBEAT_INTERVAL_MS = 15_000;
const SILENCE_LIMIT_MS = 45_000;
/**
 * A tick this far late means the browser froze the tab's timers, not that the link died —
 * a backgrounded tab gets roughly one timer a minute. The silence it "measured" while
 * suspended says nothing, so that tick probes instead of dropping.
 */
const FROZEN_TICK_MS = HEARTBEAT_INTERVAL_MS * 3;
/** How long a wake-up probe waits for its echo before the socket is declared dead. */
const WAKE_PROBE_TIMEOUT_MS = 5_000;

/**
 * Backoff for reattaching, in milliseconds; the last entry repeats. It stays short because
 * the far end costs nothing to attach to (the pty is already running) and because the user
 * is usually staring at the pane waiting for it to come back.
 */
export const RETRY_DELAYS_MS = [500, 1_000, 2_000, 4_000, 8_000, 15_000];

export type TerminalConnectionStatus = "ready" | "reconnecting" | "error";

/** The socket, as this module needs it: three callbacks in, two verbs out. */
export interface SocketHandlers {
  onOpen(): void;
  onMessage(data: ArrayBuffer): void;
  onClose(): void;
}

export interface AttachedSocket {
  send(bytes: Uint8Array): void;
  close(): void;
}

export interface TerminalConnectionDeps {
  /**
   * The first attach: which terminal this view is for. Throwing is fatal — it is the host's
   * own policy (create a shell, honour a URL parameter) that failed, and repeating it could
   * create a second terminal.
   */
  first(): Promise<string>;
  /**
   * Before a retry: is that terminal still there? `false` stops the retries for good (the
   * shell exited and was reaped while the page was away); throwing is transient and retries.
   */
  recheck(id: string): Promise<boolean>;
  open(id: string, handlers: SocketHandlers): AttachedSocket;
  /** Everything that is not heartbeat traffic, in arrival order. */
  onFrame(frame: DecodedFrame): void;
  onStatus(status: TerminalConnectionStatus, detail: string): void;
}

export class TerminalConnection {
  private socket: AttachedSocket | null = null;
  private terminalId: string | null = null;
  private stopped = false;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastSeenAt = 0;
  private lastTickAt = 0;
  /** Whether the far end speaks the heartbeat (see the silence limit above). */
  private answersProbes = false;

  constructor(private readonly deps: TerminalConnectionDeps) {}

  start(): void {
    void this.connect();
  }

  /** Stops for good: the pane is gone, or the shell exited and there is nothing to reattach to. */
  stop(): void {
    this.stopped = true;
    this.clearRetry();
    this.stopHeartbeat();
    this.socket?.close();
    this.socket = null;
  }

  /** True while a socket is open; false through every gap the user might type into. */
  get connected(): boolean {
    return this.socket !== null;
  }

  /** Sends one frame if there is a socket to send it on. Input typed into a gap is dropped. */
  send(bytes: Uint8Array): void {
    this.socket?.send(bytes);
  }

  /**
   * "The tab is back" / "the network is back". With no socket it collapses the backoff to
   * now; with one, it probes it — the socket a phone comes back to often looks open and is
   * not, and waiting for the next heartbeat to notice is fifteen seconds of dead pane.
   */
  wake(): void {
    if (this.stopped) return;
    if (this.socket === null) {
      this.clearRetry();
      this.attempt = 0;
      void this.connect();
      return;
    }
    const probed = this.socket;
    const askedAt = Date.now();
    this.lastSeenAt = askedAt;
    this.ping();
    if (!this.answersProbes) return; // nothing to conclude from an unanswered probe
    setTimeout(() => {
      if (this.socket !== probed || this.stopped) return;
      if (this.lastSeenAt > askedAt) return; // it answered
      this.drop(probed);
    }, WAKE_PROBE_TIMEOUT_MS);
  }

  private async connect(): Promise<void> {
    if (this.stopped || this.socket !== null) return;
    let id: string;
    try {
      if (this.terminalId === null) {
        id = await this.deps.first();
        this.terminalId = id;
      } else {
        id = this.terminalId;
        if (!(await this.deps.recheck(id))) {
          this.stopped = true;
          this.deps.onStatus("error", "terminal is gone");
          return;
        }
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      // A first attach is the host's policy failing, and is fatal. A recheck is just this
      // link being down again — the same thing the retry is for.
      if (this.terminalId === null) {
        this.stopped = true;
        this.deps.onStatus("error", detail);
        return;
      }
      this.deps.onStatus("reconnecting", detail);
      this.scheduleRetry();
      return;
    }
    if (this.stopped) return;

    const socket: AttachedSocket = this.deps.open(id, {
      onOpen: () => {
        if (this.socket !== socket) return;
        this.attempt = 0;
        this.startHeartbeat();
        this.deps.onStatus("ready", "");
      },
      onMessage: (data) => {
        if (this.socket !== socket) return;
        this.lastSeenAt = Date.now();
        const frame = decodeFrame(data);
        if (!frame) return;
        // The heartbeat is this module's own traffic and never reaches the terminal.
        if (frame.opcode === TerminalOpcode.Ping) {
          socket.send(encodeFrame(TerminalOpcode.Pong, frame.text));
          return;
        }
        if (frame.opcode === TerminalOpcode.Pong) {
          this.answersProbes = true;
          return;
        }
        this.deps.onFrame(frame);
      },
      onClose: () => this.drop(socket),
    });
    this.socket = socket;
  }

  /** Gives up on one socket and starts the countdown to the next. */
  private drop(socket: AttachedSocket): void {
    if (this.socket !== socket) return;
    this.socket = null;
    this.stopHeartbeat();
    socket.close();
    if (this.stopped) return;
    this.deps.onStatus("reconnecting", "");
    this.scheduleRetry();
  }

  private scheduleRetry(): void {
    if (this.retryTimer !== null || this.stopped) return;
    const step = Math.min(this.attempt, RETRY_DELAYS_MS.length - 1);
    const base = RETRY_DELAYS_MS[step] as number;
    this.attempt += 1;
    // Jitter, because a dock full of terminals loses its link at the same instant and
    // would otherwise reattach in one synchronised burst.
    const delay = base + Math.random() * base * 0.2;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.connect();
    }, delay);
  }

  private clearRetry(): void {
    if (this.retryTimer === null) return;
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private ping(): void {
    this.socket?.send(encodeFrame(TerminalOpcode.Ping, String(Date.now())));
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    const now = Date.now();
    this.lastSeenAt = now;
    this.lastTickAt = now;
    this.heartbeatTimer = setInterval(() => this.tick(), HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer === null) return;
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private tick(): void {
    const socket = this.socket;
    if (socket === null) return;
    const now = Date.now();
    const frozen = now - this.lastTickAt > FROZEN_TICK_MS;
    this.lastTickAt = now;
    if (frozen) {
      // Time the tab spent suspended is not silence on the wire; ask, do not judge.
      this.lastSeenAt = now;
      this.ping();
      return;
    }
    if (this.answersProbes && now - this.lastSeenAt > SILENCE_LIMIT_MS) {
      this.drop(socket);
      return;
    }
    this.ping();
  }
}
