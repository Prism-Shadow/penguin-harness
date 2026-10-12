/**
 * The chrome backend's link: one user's PenguinHarness Browser extension, over the WebSocket it
 * opened to `/api/builtin-browser/extension/ws` (extension-ws.ts authenticates it; the hub hands
 * it here). The frames are the shell's envelopes as JSON text — `desktop-browser-command` out,
 * `desktop-browser-reply` and `desktop-browser-event` in — validated by the same parsers.
 *
 * One link per user, outliving its sockets: the registry above it survives a reconnect, and a
 * second Chrome of the same user takes the link over (the first is closed 4001 `replaced`).
 *
 * The protocol on each socket:
 *
 * - The server speaks first: `hello`. The extension answers `{ version: 1, backend: "chrome",
 *   extension: { version, chrome, name } }`; another version or backend is closed 4005, and no
 *   answer within the hello timeout 4008. Until then the link is not `connected`.
 * - `ping` every 20 s, answered `{}`: Chrome keeps an extension's service worker alive while a
 *   WebSocket carries traffic. Any frame from the extension counts as a sign of life; two pings
 *   without one close the socket 4008.
 * - Request ids carry the link's prefix and a sequence; a request still waiting when its socket
 *   goes fails `closed`.
 *
 * Nothing the extension sends can take the server down: a frame that is not JSON, not text, or
 * not a reply or event of the protocol is dropped, and a listener that throws is logged.
 */
import { randomUUID } from "node:crypto";
import type {
  BrowserHello,
  DesktopBrowserCommand,
  DesktopBrowserCommandMessage,
  DesktopBrowserEvent,
  DesktopBrowserReplyMessage,
} from "../api/types.js";
import { BrowserLinkError, CHROME_CAPABILITIES } from "./link.js";
import type { BrowserLink } from "./link.js";
import { parseBrowserEvent, parseBrowserReply } from "./shell-link.js";

/** What the link needs of a socket: the `ws` server socket, or a test's fake extension. */
export interface ExtensionSocket {
  /** One JSON text frame. Throws when the socket cannot take it. */
  send(text: string): void;
  close(code: number, reason: string): void;
  onMessage(listener: (text: string) => void): void;
  onClose(listener: (code: number) => void): void;
}

export interface ExtensionLinkTiming {
  /** How long the extension has to answer `hello` once its socket opens. */
  helloTimeoutMs: number;
  /** How often the server pings; two intervals without a frame close the socket. */
  pingIntervalMs: number;
  /** Any other request that names no timeout of its own. */
  defaultTimeoutMs: number;
}

export const DEFAULT_EXTENSION_LINK_TIMING: ExtensionLinkTiming = {
  helloTimeoutMs: 10_000,
  pingIntervalMs: 20_000,
  defaultTimeoutMs: 30_000,
};

/** The close codes and their reasons; see BrowserExtensionCloseCode in api/types.ts. */
export const CLOSE = {
  replaced: 4001,
  revoked: 4003,
  protocolMismatch: 4005,
  pingTimeout: 4008,
  disabled: 4009,
  /** The server is restarting or hot-swapping: reconnect with the usual backoff. */
  restart: 1012,
} as const;

const PROTOCOL_VERSION = 1;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A short, printable piece of what the extension says about itself; null when it is not one. */
function label(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text !== "" && text.length <= max && /^[\x20-\x7e -￿]+$/.test(text) ? text : null;
}

/** The extension's hello, validated; null when it is not one this server speaks. */
export function parseChromeHello(value: unknown): BrowserHello | null {
  if (!isRecord(value) || value.version !== PROTOCOL_VERSION || value.backend !== "chrome") {
    return null;
  }
  const info = isRecord(value.extension) ? value.extension : {};
  return {
    version: PROTOCOL_VERSION,
    backend: "chrome",
    extension: {
      version: label(info.version, 40) ?? "unknown",
      chrome: label(info.chrome, 40) ?? "unknown",
      name: label(info.name, 80) ?? "Chrome",
    },
  };
}

interface Pending {
  resolve(result: unknown): void;
  reject(err: BrowserLinkError): void;
  timer: NodeJS.Timeout;
}

/** One socket the link holds, from attach until it closes or is replaced. */
interface Attachment {
  socket: ExtensionSocket;
  hello: BrowserHello | null;
  handshake: Promise<boolean>;
  pingTimer: NodeJS.Timeout | null;
  /** Pings in a row that went unanswered with no other frame in between. */
  missed: number;
}

export class ExtensionLink implements BrowserLink {
  readonly backend = "chrome" as const;
  readonly capabilities = CHROME_CAPABILITIES;
  private readonly timing: ExtensionLinkTiming;
  private readonly pending = new Map<string, Pending>();
  private readonly eventListeners = new Set<(event: DesktopBrowserEvent) => void>();
  private readonly connectListeners = new Set<() => Promise<void> | void>();
  private readonly disconnectListeners = new Set<(code: number) => void>();
  private readonly prefix = randomUUID().slice(0, 8);
  private seq = 0;
  private current: Attachment | null = null;
  private disposed = false;

  constructor(
    timing: Partial<ExtensionLinkTiming> = {},
    private readonly log: (line: string) => void = () => {},
  ) {
    this.timing = { ...DEFAULT_EXTENSION_LINK_TIMING, ...timing };
  }

  /** Whether an extension is connected and has answered `hello`. */
  get connected(): boolean {
    return this.current?.hello != null;
  }

  /** The connected extension's hello; null while none is. */
  get hello(): BrowserHello | null {
    return this.current?.hello ?? null;
  }

  /** Whether a socket is attached (its hello may still be on its way). */
  get attached(): boolean {
    return this.current !== null;
  }

  /**
   * Takes over `socket`: a socket already held is closed 4001 `replaced` (its waiting requests
   * fail `closed`), and the handshake starts on the new one.
   */
  attach(socket: ExtensionSocket): void {
    if (this.disposed) {
      closeQuietly(socket, CLOSE.restart, "server_restart");
      return;
    }
    if (this.current !== null) this.detach(CLOSE.replaced, "replaced", false);
    const attachment: Attachment = {
      socket,
      hello: null,
      handshake: Promise.resolve(false),
      pingTimer: null,
      missed: 0,
    };
    this.current = attachment;
    socket.onMessage((text) => this.receive(attachment, text));
    socket.onClose((code) => {
      if (this.current === attachment) this.teardown(code, true);
    });
    attachment.handshake = this.greet(attachment);
    attachment.pingTimer = setInterval(() => this.ping(attachment), this.timing.pingIntervalMs);
    attachment.pingTimer.unref?.();
  }

  /** Closes the socket held now with `code`; the link stays, waiting for the next one. */
  close(code: number, reason: string): void {
    if (this.current !== null) this.detach(code, reason, true);
  }

  request(
    command: DesktopBrowserCommand,
    timeoutMs = this.timing.defaultTimeoutMs,
  ): Promise<unknown> {
    const attachment = this.current;
    if (this.disposed || attachment === null) {
      return Promise.reject(new BrowserLinkError("closed", "Chrome's extension is not connected."));
    }
    this.seq += 1;
    const id = `${this.prefix}-${this.seq}`;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new BrowserLinkError(
            "timeout",
            `Chrome's extension did not answer '${command.op}' within ${Math.round(timeoutMs / 1000)}s.`,
          ),
        );
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        attachment.socket.send(
          JSON.stringify({
            type: "desktop-browser-command",
            id,
            command,
          } satisfies DesktopBrowserCommandMessage),
        );
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new BrowserLinkError("closed", err instanceof Error ? err.message : String(err)));
      }
    });
  }

  /** True once the attached extension has answered `hello`; false while no socket is attached. */
  handshake(_force = false): Promise<boolean> {
    if (this.current === null) return Promise.resolve(false);
    if (this.current.hello !== null) return Promise.resolve(true);
    return this.current.handshake;
  }

  onEvent(listener: (event: DesktopBrowserEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onConnect(listener: () => Promise<void> | void): () => void {
    this.connectListeners.add(listener);
    return () => this.connectListeners.delete(listener);
  }

  /** The socket went away (closed by either side), with its close code; not when it was replaced. */
  onDisconnect(listener: (code: number) => void): () => void {
    this.disconnectListeners.add(listener);
    return () => this.disconnectListeners.delete(listener);
  }

  /** Closes the socket 1012 (the extension reconnects to the next generation) and fails what waits. */
  dispose(): void {
    if (this.disposed) return;
    if (this.current !== null) this.detach(CLOSE.restart, "server_restart", false);
    this.disposed = true;
    this.eventListeners.clear();
    this.connectListeners.clear();
    this.disconnectListeners.clear();
  }

  /** `hello` on a fresh socket; the connect listeners run before it counts as done. */
  private async greet(attachment: Attachment): Promise<boolean> {
    let answer: unknown;
    try {
      answer = await this.request({ op: "hello" }, this.timing.helloTimeoutMs);
    } catch (err) {
      if (this.current === attachment && err instanceof BrowserLinkError) {
        if (err.kind === "timeout") this.detach(CLOSE.pingTimeout, "hello_timeout", true);
        else if (err.kind === "refused")
          this.detach(CLOSE.protocolMismatch, "protocol_mismatch", true);
      }
      return false;
    }
    if (this.current !== attachment) return false;
    const hello = parseChromeHello(answer);
    if (hello === null) {
      this.detach(CLOSE.protocolMismatch, "protocol_mismatch", true);
      return false;
    }
    attachment.hello = hello;
    for (const listener of this.connectListeners) {
      try {
        await listener();
      } catch {
        // A listener's failure (a tab refresh that timed out) does not undo the handshake.
      }
    }
    return this.current === attachment;
  }

  private ping(attachment: Attachment): void {
    if (this.current !== attachment) return;
    this.request({ op: "ping" }, this.timing.pingIntervalMs).catch((err: unknown) => {
      if (this.current !== attachment) return;
      if (err instanceof BrowserLinkError && err.kind === "timeout") {
        attachment.missed += 1;
        if (attachment.missed >= 2) this.detach(CLOSE.pingTimeout, "ping_timeout", true);
      }
    });
  }

  /** One frame from the extension. Never throws: what fails here is logged, and the frame dropped. */
  private receive(attachment: Attachment, text: string): void {
    if (this.current !== attachment || this.disposed) return;
    attachment.missed = 0;
    let event: DesktopBrowserEvent | null;
    try {
      const data: unknown = JSON.parse(text);
      const reply = parseBrowserReply(data);
      if (reply !== null) {
        this.settle(reply);
        return;
      }
      event = parseBrowserEvent(data);
    } catch (err) {
      this.log(`chrome browser: dropped a frame from the extension: ${messageOf(err)}`);
      return;
    }
    if (event === null) return;
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (err) {
        this.log(
          `chrome browser: a '${event.kind}' event from the extension failed: ${messageOf(err)}`,
        );
      }
    }
  }

  private settle(reply: DesktopBrowserReplyMessage): void {
    const pending = this.pending.get(reply.id);
    if (pending === undefined) return;
    this.pending.delete(reply.id);
    clearTimeout(pending.timer);
    if (reply.ok) pending.resolve(reply.result);
    else {
      pending.reject(
        new BrowserLinkError("refused", reply.error ?? "The extension refused the command."),
      );
    }
  }

  /** Closes the socket held now and lets it go; `announce` tells the disconnect listeners. */
  private detach(code: number, reason: string, announce: boolean): void {
    const attachment = this.current;
    if (attachment === null) return;
    this.teardown(code, announce);
    closeQuietly(attachment.socket, code, reason);
  }

  /** Forgets the socket held now: its timers stop and its waiting requests fail `closed`. */
  private teardown(code: number, announce: boolean): void {
    const attachment = this.current;
    if (attachment === null) return;
    this.current = null;
    if (attachment.pingTimer !== null) clearInterval(attachment.pingTimer);
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new BrowserLinkError("closed", "Chrome's extension disconnected."));
      this.pending.delete(id);
    }
    if (!announce) return;
    for (const listener of this.disconnectListeners) {
      try {
        listener(code);
      } catch (err) {
        this.log(`chrome browser: a disconnect listener failed: ${messageOf(err)}`);
      }
    }
  }
}

function closeQuietly(socket: ExtensionSocket, code: number, reason: string): void {
  try {
    socket.close(code, reason);
  } catch {
    // Already closing or closed: nothing left to tell it.
  }
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));
