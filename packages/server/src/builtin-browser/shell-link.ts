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
 *
 * Nothing the shell sends can take the server down: a frame is validated before anything reads
 * it, and a listener that throws on one is logged and skipped, since an exception escaping a
 * port listener is an uncaught exception, which ends the server process (index.ts).
 */
import { randomUUID } from "node:crypto";
import type {
  BuiltinBrowserTab,
  BuiltinBrowserTabMetrics,
  DesktopBrowserCommand,
  DesktopBrowserCommandMessage,
  DesktopBrowserEvent,
  DesktopBrowserReplyMessage,
} from "../api/types.js";
import type { ShellPort } from "../services/desktop-update-port.js";
import { BUILTIN_CAPABILITIES, BrowserLinkError } from "./link.js";
import type { BrowserLink } from "./link.js";

type MessageListener = (e: { data: unknown }) => void;

/** The port as this link uses it: Electron's ParentPort is an EventEmitter, so a listener can come off again. */
export interface BrowserShellPort extends ShellPort {
  off?(event: "message", listener: MessageListener): void;
  removeListener?(event: "message", listener: MessageListener): void;
}

/** The link error under its first name (see link.ts); the shell's errors are the same kinds. */
export { BrowserLinkError as ShellLinkError };

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

/**
 * The longest favicons a tab keeps: a `data:` icon rides every tab event and every tab list the
 * windows hear, so one a page inlines at any size (or swaps on a timer) is dropped past a
 * 32-pixel icon's worth, as the shell does; an address longer than this is not one worth sending.
 */
export const MAX_DATA_FAVICON_CHARS = 4 * 1024;
export const MAX_FAVICON_URL_CHARS = 2 * 1024;

function faviconOf(value: unknown): string | undefined {
  if (typeof value !== "string" || value === "") return undefined;
  const limit = /^data:/i.test(value) ? MAX_DATA_FAVICON_CHARS : MAX_FAVICON_URL_CHARS;
  return value.length <= limit ? value : undefined;
}

/** Why a renderer went away, as Electron names it: a short lowercase word. */
function crashReasonOf(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-z][a-z-]{0,39}$/.test(value) ? value : undefined;
}

/** A tab as the shell reports it; null for anything that does not have the shape. */
export function parseTab(value: unknown): BuiltinBrowserTab | null {
  if (!isRecord(value)) return null;
  const { id, url, title, loading, canGoBack, canGoForward } = value;
  if (typeof id !== "number" || !Number.isSafeInteger(id)) return null;
  if (typeof url !== "string" || typeof title !== "string") return null;
  if (typeof loading !== "boolean") return null;
  if (typeof canGoBack !== "boolean" || typeof canGoForward !== "boolean") return null;
  const favicon = faviconOf(value.favicon);
  const crashed = crashReasonOf(value.crashed);
  return {
    id,
    url,
    title,
    loading,
    canGoBack,
    canGoForward,
    ...(favicon !== undefined ? { favicon } : {}),
    ...(crashed !== undefined ? { crashed } : {}),
  };
}

/** The most tabs one measurement may name. */
const MAX_MEASURED_TABS = 1_000;

const isAmount = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

/** A `metrics` event's tab list; null when any entry is not a tab's measurement. */
function parseTabMetrics(value: unknown): BuiltinBrowserTabMetrics[] | null {
  if (!Array.isArray(value) || value.length > MAX_MEASURED_TABS) return null;
  const tabs: BuiltinBrowserTabMetrics[] = [];
  for (const entry of value as unknown[]) {
    if (!isRecord(entry)) return null;
    const { tabId, memoryKB, cpuPercent } = entry;
    if (typeof tabId !== "number" || !Number.isSafeInteger(tabId)) return null;
    if (!isAmount(memoryKB) || !isAmount(cpuPercent)) return null;
    tabs.push({ tabId, memoryKB, cpuPercent });
  }
  return tabs;
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
    case "cdp-event":
      if (typeof event.tabId !== "number" || typeof event.method !== "string") return null;
      return {
        kind: "cdp-event",
        tabId: event.tabId,
        method: event.method,
        params: isRecord(event.params) ? event.params : {},
      };
    case "tab-crashed": {
      const reason = crashReasonOf(event.reason) ?? "crashed";
      if (typeof event.tabId !== "number" || !Number.isSafeInteger(event.tabId)) return null;
      const exitCode = typeof event.exitCode === "number" ? event.exitCode : 0;
      return { kind: "tab-crashed", tabId: event.tabId, reason, exitCode };
    }
    case "metrics": {
      const tabs = parseTabMetrics(event.tabs);
      if (tabs === null || !isAmount(event.totalKB)) return null;
      return { kind: "metrics", tabs, totalKB: event.totalKB };
    }
    case "tab-released": {
      if (typeof event.tabId !== "number" || !Number.isSafeInteger(event.tabId)) return null;
      const reason =
        event.reason === "user" || event.reason === "restricted" ? event.reason : "detached";
      return { kind: "tab-released", tabId: event.tabId, reason };
    }
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
  reject(err: BrowserLinkError): void;
  timer: NodeJS.Timeout;
}

export class ShellLink implements BrowserLink {
  readonly backend = "builtin" as const;
  readonly capabilities = BUILTIN_CAPABILITIES;
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
    private readonly log: (line: string) => void = () => {},
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
    if (this.disposed) {
      return Promise.reject(new BrowserLinkError("closed", "The link is closed."));
    }
    this.seq += 1;
    const id = `${this.prefix}-${this.seq}`;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new BrowserLinkError(
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
        reject(new BrowserLinkError("closed", err instanceof Error ? err.message : String(err)));
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

  /** The shell's port does not go away under a running server: nothing to hear. */
  onDisconnect(_listener: () => void): () => void {
    return () => {};
  }

  /** Takes the listener off the port and fails whatever is still waiting. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (typeof this.port.off === "function") this.port.off("message", this.onMessage);
    else this.port.removeListener?.("message", this.onMessage);
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new BrowserLinkError("closed", "The link is closed."));
      this.pending.delete(id);
    }
    this.eventListeners.clear();
    this.connectListeners.clear();
  }

  /** One frame off the port. Never throws: what fails here is logged, and the frame dropped. */
  private receive(data: unknown): void {
    if (this.disposed) return;
    let event: DesktopBrowserEvent | null;
    try {
      const reply = parseBrowserReply(data);
      if (reply !== null) {
        this.settle(reply);
        return;
      }
      event = parseBrowserEvent(data);
    } catch (err) {
      this.log(`builtin browser: dropped a frame from the shell: ${messageOf(err)}`);
      return;
    }
    if (event === null) return;
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (err) {
        this.log(
          `builtin browser: a '${event.kind}' event from the shell failed: ${messageOf(err)}`,
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
    else
      pending.reject(
        new BrowserLinkError("refused", reply.error ?? "The shell refused the command."),
      );
  }
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));
