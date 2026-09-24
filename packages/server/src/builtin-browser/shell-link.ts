/**
 * The built-in browser's link to the desktop shell: request/reply and events over the
 * utilityProcess port (`process.parentPort`), beside the updater and tray relay the HMR layer
 * wires on the same port (services/desktop-update-port.ts, left untouched).
 *
 * A link belongs to one platform generation. It adds its own listener to the port and takes
 * it off again on dispose, so a hot swap never leaves a dead App's listener answering frames.
 * Request ids carry a per-link prefix for the same reason: a late reply to the previous
 * generation's request can never be mistaken for one of this generation's.
 *
 * The handshake is `hello`. A shell older than the built-in browser ignores the frame, so
 * silence past the hello timeout means "this shell cannot host the browser"; the handshake is
 * tried again later rather than trusted forever, since the one pairing that produces it — a
 * platform pushed onto an older installation — cannot change without a new shell anyway.
 */
import { randomUUID } from "node:crypto";
import type {
  BuiltinBrowserTab,
  DesktopBrowserCommand,
  DesktopBrowserCommandMessage,
  DesktopBrowserEvent,
  DesktopBrowserReplyMessage,
} from "../api/types.js";
import type { ShellPort } from "../services/desktop-update-port.js";

type MessageListener = (e: { data: unknown }) => void;

/** The port as this link uses it: Electron's ParentPort is an EventEmitter, so a listener can come off again. */
export interface BrowserShellPort extends ShellPort {
  off?(event: "message", listener: MessageListener): void;
  removeListener?(event: "message", listener: MessageListener): void;
}

/**
 * Why a request did not produce a result: the shell refused it (`message` is the shell's own
 * error — a CDP error text, or `no_such_tab`), it did not answer in time, or the link was
 * disposed under it.
 */
export class ShellLinkError extends Error {
  constructor(
    readonly kind: "refused" | "timeout" | "closed",
    message: string,
  ) {
    super(message);
    this.name = "ShellLinkError";
  }
}

export interface ShellLinkTiming {
  /** How long `hello` may take before the shell counts as one that cannot host the browser. */
  helloTimeoutMs: number;
  /** After a failed hello, how long a non-forced handshake answers from that failure. */
  helloRetryMs: number;
  /** Any other request that names no timeout of its own. */
  defaultTimeoutMs: number;
}

export const DEFAULT_SHELL_LINK_TIMING: ShellLinkTiming = {
  helloTimeoutMs: 3_000,
  helloRetryMs: 10_000,
  defaultTimeoutMs: 30_000,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A tab as the shell reports it; null for anything that does not have the shape. */
export function parseTab(value: unknown): BuiltinBrowserTab | null {
  if (!isRecord(value)) return null;
  const { id, url, title, loading, canGoBack, canGoForward, favicon } = value;
  if (typeof id !== "number" || !Number.isSafeInteger(id)) return null;
  if (typeof url !== "string" || typeof title !== "string") return null;
  if (typeof loading !== "boolean") return null;
  if (typeof canGoBack !== "boolean" || typeof canGoForward !== "boolean") return null;
  return {
    id,
    url,
    title,
    loading,
    canGoBack,
    canGoForward,
    ...(typeof favicon === "string" && favicon !== "" ? { favicon } : {}),
  };
}

/** One shell push, validated; null when the frame is not a browser event or is malformed. */
export function parseBrowserEvent(data: unknown): DesktopBrowserEvent | null {
  if (!isRecord(data) || data.type !== "desktop-browser-event" || !isRecord(data.event)) {
    return null;
  }
  const event = data.event;
  switch (event.kind) {
    case "tab": {
      const tab = parseTab(event.tab);
      return tab === null ? null : { kind: "tab", tab };
    }
    case "tab-closed":
      return typeof event.tabId === "number" ? { kind: "tab-closed", tabId: event.tabId } : null;
    case "open-request":
      if (typeof event.url !== "string" || typeof event.openerTabId !== "number") return null;
      return {
        kind: "open-request",
        url: event.url,
        openerTabId: event.openerTabId,
        ...(event.background === true ? { background: true } : {}),
      };
    default:
      return null;
  }
}

/** One shell reply, validated; null when the frame is not one. */
export function parseBrowserReply(data: unknown): DesktopBrowserReplyMessage | null {
  if (!isRecord(data) || data.type !== "desktop-browser-reply") return null;
  if (typeof data.id !== "string" || typeof data.ok !== "boolean") return null;
  return {
    type: "desktop-browser-reply",
    id: data.id,
    ok: data.ok,
    ...("result" in data ? { result: data.result } : {}),
    ...(typeof data.error === "string" ? { error: data.error } : {}),
  };
}

interface Pending {
  resolve(result: unknown): void;
  reject(err: ShellLinkError): void;
  timer: NodeJS.Timeout;
}

export class ShellLink {
  private readonly timing: ShellLinkTiming;
  private readonly pending = new Map<string, Pending>();
  private readonly eventListeners = new Set<(event: DesktopBrowserEvent) => void>();
  private readonly connectListeners = new Set<() => Promise<void> | void>();
  private readonly prefix = randomUUID().slice(0, 8);
  private seq = 0;
  private state: "unknown" | "connected" | "unsupported" = "unknown";
  private failedAt = 0;
  private handshaking: Promise<boolean> | null = null;
  private disposed = false;
  private readonly onMessage: MessageListener = (e) => this.receive(e.data);

  constructor(
    private readonly port: BrowserShellPort,
    timing: Partial<ShellLinkTiming> = {},
    private readonly now: () => number = Date.now,
  ) {
    this.timing = { ...DEFAULT_SHELL_LINK_TIMING, ...timing };
    port.on("message", this.onMessage);
  }

  /** Whether the shell has answered `hello`. */
  get connected(): boolean {
    return this.state === "connected";
  }

  /** Sends one command and resolves with the shell's result. */
  request(
    command: DesktopBrowserCommand,
    timeoutMs = this.timing.defaultTimeoutMs,
  ): Promise<unknown> {
    if (this.disposed) return Promise.reject(new ShellLinkError("closed", "The link is closed."));
    this.seq += 1;
    const id = `${this.prefix}-${this.seq}`;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new ShellLinkError(
            "timeout",
            `The desktop shell did not answer '${command.op}' within ${Math.round(timeoutMs / 1000)}s.`,
          ),
        );
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.port.postMessage({
          type: "desktop-browser-command",
          id,
          command,
        } satisfies DesktopBrowserCommandMessage);
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new ShellLinkError("closed", err instanceof Error ? err.message : String(err)));
      }
    });
  }

  /**
   * The handshake, one at a time: true once the shell has answered `hello`. After a failure a
   * call answers from it for `helloRetryMs`, unless `force` (the status route) asks again now.
   * Connect listeners run before the first successful handshake resolves, so a caller that
   * awaited it sees their effect (the tab list refreshed).
   */
  handshake(force = false): Promise<boolean> {
    if (this.state === "connected") return Promise.resolve(true);
    if (this.handshaking !== null) return this.handshaking;
    if (
      this.state === "unsupported" &&
      !force &&
      this.now() - this.failedAt < this.timing.helloRetryMs
    ) {
      return Promise.resolve(false);
    }
    this.handshaking = (async () => {
      try {
        await this.request({ op: "hello" }, this.timing.helloTimeoutMs);
      } catch {
        if (!this.disposed) {
          this.state = "unsupported";
          this.failedAt = this.now();
        }
        return false;
      }
      this.state = "connected";
      for (const listener of this.connectListeners) {
        try {
          await listener();
        } catch {
          // A listener's failure (a refresh that timed out) does not undo the handshake.
        }
      }
      return true;
    })().finally(() => {
      this.handshaking = null;
    });
    return this.handshaking;
  }

  /** Every validated shell event, in order. Returns the unsubscribe. */
  onEvent(listener: (event: DesktopBrowserEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  /** Runs after each successful handshake (the registry refreshes its tabs here). */
  onConnect(listener: () => Promise<void> | void): () => void {
    this.connectListeners.add(listener);
    return () => this.connectListeners.delete(listener);
  }

  /** Takes the listener off the port and fails whatever is still waiting. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (typeof this.port.off === "function") this.port.off("message", this.onMessage);
    else this.port.removeListener?.("message", this.onMessage);
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new ShellLinkError("closed", "The link is closed."));
      this.pending.delete(id);
    }
    this.eventListeners.clear();
    this.connectListeners.clear();
  }

  private receive(data: unknown): void {
    if (this.disposed) return;
    const reply = parseBrowserReply(data);
    if (reply !== null) {
      const pending = this.pending.get(reply.id);
      if (pending === undefined) return;
      this.pending.delete(reply.id);
      clearTimeout(pending.timer);
      if (reply.ok) pending.resolve(reply.result);
      else
        pending.reject(
          new ShellLinkError("refused", reply.error ?? "The shell refused the command."),
        );
      return;
    }
    const event = parseBrowserEvent(data);
    if (event === null) return;
    for (const listener of this.eventListeners) listener(event);
  }
}
