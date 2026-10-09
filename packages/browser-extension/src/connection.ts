/**
 * One paired server's link: a WebSocket to `<origin>/api/builtin-browser/extension/ws` that
 * answers the server's commands and carries the extension's events.
 *
 * The token is offered as the subprotocol `token.<token>` beside `penguin-browser.1`, which the
 * server selects; it never appears in a URL. The server opens with `hello` and pings every 20 s;
 * the pings are also what keeps the MV3 worker alive (Chrome 116+ counts WebSocket traffic).
 *
 * After a drop the link redials on a 1 s → 60 s backoff, reset by the next successful `hello`.
 * The server's close codes say when not to: `4001` another Chrome of the same user took over
 * (wait for the user), `4003` the pairing was revoked (forget the server), `4005` the protocol
 * differs (wait for an update), `4009` the administrator turned extensions off (retry hourly).
 * A held link is not dialled again until the hold ends; the caller persists holds, since the
 * worker may be stopped and restarted in between.
 */
import type { ConnectionState, Hold } from "./storage.js";
import {
  CLOSE_DISABLED,
  CLOSE_PING_TIMEOUT,
  CLOSE_PROTOCOL_MISMATCH,
  CLOSE_REPLACED,
  CLOSE_REVOKED,
  SUBPROTOCOL,
  TOKEN_PROTOCOL_PREFIX,
  parseCommandMessage,
  socketUrl,
  type BrowserHello,
  type DesktopBrowserCommand,
  type DesktopBrowserEvent,
  type DesktopBrowserEventMessage,
  type DesktopBrowserReplyMessage,
} from "./wire.js";

/** The redial delays after the n-th consecutive failure; the last one repeats. */
export const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000] as const;
/** How long a `4009 disabled` keeps the link down before it asks again. */
export const DISABLED_RETRY_MS = 60 * 60_000;
/** Three missed 20-second server pings: the socket is dead even if the OS has not noticed. */
export const SILENCE_LIMIT_MS = 60_000;

/** The part of the DOM WebSocket the link uses, so a test can stand in for it. */
export interface SocketLike {
  readonly readyState: number;
  readonly protocol: string;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number; reason: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

const OPEN = 1;

export interface ServerConnectionOptions {
  origin: string;
  token: string;
  /** A hold read back from storage: the link starts held. */
  hold?: Hold;
  /** Runs one command (anything but `hello` and `ping`, which the link answers itself). */
  handle(command: DesktopBrowserCommand): Promise<unknown>;
  hello(): BrowserHello;
  onState(state: ConnectionState, hold: Hold | null): void;
  createSocket?(url: string, protocols: string[]): SocketLike;
  now?(): number;
  log?(line: string): void;
}

export class ServerConnection {
  readonly origin: string;
  private token: string;
  private socket: SocketLike | null = null;
  private helloed = false;
  private attempts = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private hold: Hold | null;
  private current: ConnectionState = { status: "stopped" };
  private stopped = true;
  private readonly createSocket: (url: string, protocols: string[]) => SocketLike;
  private readonly now: () => number;
  private readonly log: (line: string) => void;

  constructor(private readonly options: ServerConnectionOptions) {
    this.origin = options.origin;
    this.token = options.token;
    this.hold = options.hold ?? null;
    this.createSocket =
      options.createSocket ??
      ((url, protocols) => new WebSocket(url, protocols) as unknown as SocketLike);
    this.now = options.now ?? Date.now;
    this.log = options.log ?? (() => {});
  }

  get state(): ConnectionState {
    return this.current;
  }

  /** Whether `hello` has been answered on the live socket: events go out only then. */
  get connected(): boolean {
    return this.helloed && this.socket?.readyState === OPEN;
  }

  /** Starts dialling, unless a hold says to wait. */
  start(): void {
    this.stopped = false;
    if (this.hold === null) {
      this.connect();
      return;
    }
    if (this.hold.reason === "disabled") {
      const until = this.hold.until ?? 0;
      if (until <= this.now()) {
        this.connect();
        return;
      }
      this.setState({ status: "disabled", retryAt: until });
      this.schedule(until - this.now());
      return;
    }
    this.setState({ status: this.hold.reason });
  }

  /** The server was removed here: close for good. */
  stop(): void {
    this.stopped = true;
    this.clearTimers();
    this.drop(1000, "removed");
    this.setState({ status: "stopped" });
  }

  /** The user asked to reconnect (after a replacement, say): any hold ends, dial now. */
  reconnect(): void {
    if (this.stopped) return;
    this.hold = null;
    this.attempts = 0;
    this.drop(1000, "reconnect");
    this.connect();
  }

  /** The periodic alarm: dial now if a wait is due, since the worker's timers may have died. */
  kick(): void {
    if (this.stopped || this.socket !== null) return;
    const { status, retryAt } = this.current;
    if (status !== "waiting" && status !== "disabled") return;
    if (retryAt !== undefined && retryAt > this.now()) return;
    this.connect();
  }

  /** Re-pairing the same origin hands the link a new token: redial with it. */
  setToken(token: string): void {
    if (token === this.token) return;
    this.token = token;
    this.reconnect();
  }

  /** Sends one event; false (dropped) while not connected. The server re-reads tabs on reconnect. */
  emit(event: DesktopBrowserEvent): boolean {
    if (!this.connected || this.socket === null) return false;
    this.send(this.socket, { type: "desktop-browser-event", event });
    return true;
  }

  private connect(): void {
    this.clearTimers();
    this.setState({ status: "connecting" });
    let socket: SocketLike;
    try {
      socket = this.createSocket(socketUrl(this.origin), [
        SUBPROTOCOL,
        TOKEN_PROTOCOL_PREFIX + this.token,
      ]);
    } catch (err) {
      this.log(`${this.origin}: cannot open a socket: ${messageOf(err)}`);
      this.retryLater();
      return;
    }
    this.socket = socket;
    this.helloed = false;
    socket.onopen = () => {
      if (socket !== this.socket) return;
      if (socket.protocol !== SUBPROTOCOL) {
        // Not a PenguinHarness link (or a proxy that dropped the header): do not talk to it.
        this.drop(CLOSE_PROTOCOL_MISMATCH, "protocol_mismatch");
        this.closed(CLOSE_PROTOCOL_MISMATCH, "protocol_mismatch");
        return;
      }
      this.watchSilence();
    };
    socket.onmessage = (ev) => {
      if (socket !== this.socket) return;
      this.watchSilence();
      this.receive(socket, ev.data);
    };
    socket.onclose = (ev) => {
      if (socket !== this.socket) return;
      this.socket = null;
      this.closed(ev.code, ev.reason);
    };
    socket.onerror = () => {
      // A close event follows; it is the one that decides what happens next.
    };
  }

  private receive(socket: SocketLike, data: unknown): void {
    if (typeof data !== "string") return;
    let frame: unknown;
    try {
      frame = JSON.parse(data);
    } catch {
      this.log(`${this.origin}: dropped a frame that is not JSON`);
      return;
    }
    const parsed = parseCommandMessage(frame);
    if (parsed === null) return;
    if ("error" in parsed) {
      this.send(socket, {
        type: "desktop-browser-reply",
        id: parsed.id,
        ok: false,
        error: parsed.error,
      });
      return;
    }
    const { id, command } = parsed;
    if (command.op === "hello") {
      this.send(socket, {
        type: "desktop-browser-reply",
        id,
        ok: true,
        result: this.options.hello(),
      });
      this.helloed = true;
      this.attempts = 0;
      this.hold = null;
      this.setState({ status: "connected" });
      return;
    }
    if (command.op === "ping") {
      this.send(socket, { type: "desktop-browser-reply", id, ok: true, result: {} });
      return;
    }
    this.options.handle(command).then(
      (result) =>
        this.send(socket, { type: "desktop-browser-reply", id, ok: true, result: result ?? {} }),
      (err: unknown) =>
        this.send(socket, { type: "desktop-browser-reply", id, ok: false, error: messageOf(err) }),
    );
  }

  private closed(code: number, reason: string): void {
    this.clearTimers();
    this.helloed = false;
    if (this.stopped) return;
    const last = { closeCode: code, ...(reason !== "" ? { closeReason: reason } : {}) };
    switch (code) {
      case CLOSE_REPLACED:
        this.hold = { reason: "replaced" };
        this.setState({ status: "replaced", ...last });
        return;
      case CLOSE_REVOKED:
        this.stopped = true;
        this.setState({ status: "revoked", ...last });
        return;
      case CLOSE_PROTOCOL_MISMATCH:
        this.hold = { reason: "protocol_mismatch" };
        this.setState({ status: "protocol_mismatch", ...last });
        return;
      case CLOSE_DISABLED: {
        const until = this.now() + DISABLED_RETRY_MS;
        this.hold = { reason: "disabled", until };
        this.setState({ status: "disabled", retryAt: until, ...last });
        this.schedule(DISABLED_RETRY_MS);
        return;
      }
      default:
        this.retryLater(last);
    }
  }

  private retryLater(last: Partial<ConnectionState> = {}): void {
    const delay = BACKOFF_MS[Math.min(this.attempts, BACKOFF_MS.length - 1)] as number;
    this.attempts += 1;
    this.setState({ status: "waiting", retryAt: this.now() + delay, ...last });
    this.schedule(delay);
  }

  private schedule(delay: number): void {
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (!this.stopped) this.connect();
    }, delay);
  }

  /** No frame for a minute: the server stopped pinging, so the socket is as good as gone. */
  private watchSilence(): void {
    if (this.silenceTimer !== null) clearTimeout(this.silenceTimer);
    this.silenceTimer = setTimeout(() => {
      this.silenceTimer = null;
      this.log(`${this.origin}: no frame for ${SILENCE_LIMIT_MS / 1000}s; redialling`);
      this.drop(CLOSE_PING_TIMEOUT, "ping_timeout");
      this.closed(CLOSE_PING_TIMEOUT, "ping_timeout");
    }, SILENCE_LIMIT_MS);
  }

  /** Closes the live socket, if any, and stops listening to it. */
  private drop(code: number, reason: string): void {
    const socket = this.socket;
    this.socket = null;
    this.helloed = false;
    if (socket === null) return;
    try {
      socket.close(code, reason);
    } catch {
      // Already closing.
    }
  }

  private send(
    socket: SocketLike,
    message: DesktopBrowserReplyMessage | DesktopBrowserEventMessage,
  ): void {
    // A reply to a command that came on an earlier socket has nowhere to go.
    if (socket !== this.socket || socket.readyState !== OPEN) return;
    try {
      socket.send(JSON.stringify(message));
    } catch (err) {
      this.log(`${this.origin}: a frame could not be sent: ${messageOf(err)}`);
    }
  }

  private clearTimers(): void {
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    if (this.silenceTimer !== null) clearTimeout(this.silenceTimer);
    this.retryTimer = null;
    this.silenceTimer = null;
  }

  private setState(state: ConnectionState): void {
    this.current = state;
    this.options.onState(state, this.hold);
  }
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));
