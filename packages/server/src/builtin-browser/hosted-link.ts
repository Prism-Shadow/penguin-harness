/**
 * The hosted backend's link: a headless Chrome this server launches on its own machine and
 * drives over the CDP pipe (hosted-chrome.ts). Nothing sits on the far side to speak the link's
 * protocol, so the link answers the commands itself, by CDP:
 *
 * - `hello` is the launched Chrome's version, `tabs` the page targets it holds.
 * - `open-tab`, `cdp` and the tab events are the tabs' business (hosted-tabs.ts); `close-tab`
 *   and `activate-tab` are `Target.closeTarget` and `Target.activateTarget`.
 *
 * Chrome is a process with a lifetime of its own:
 *
 * - It starts with the first handshake that finds it not running — every command makes one, and
 *   nothing else does, so asking for the status never starts it.
 * - With no tab for `idleExitMs` it is stopped; the next command starts it again.
 * - When it exits, whatever waited fails `closed`, the tabs are gone, and the disconnect
 *   listeners hear it. A launch that fails is remembered with Chrome's own error line.
 */
import type { DesktopBrowserCommand, DesktopBrowserEvent } from "../api/types.js";
import { CdpConnection, launchFailureLine } from "./hosted-chrome.js";
import type { CdpPipe } from "./hosted-chrome.js";
import { HostedTabs } from "./hosted-tabs.js";
import type { TabSession } from "./hosted-tabs.js";
import { BrowserLinkError, HOSTED_CAPABILITIES } from "./link.js";
import type { BrowserLink, LinkUnavailability } from "./link.js";

export interface HostedLinkTiming {
  /** How long a launched Chrome has to answer its first command. */
  startTimeoutMs: number;
  /** Any request that names no timeout of its own. */
  defaultTimeoutMs: number;
  /** How long Chrome runs with no tab before it is stopped. */
  idleExitMs: number;
}

export const DEFAULT_HOSTED_LINK_TIMING: HostedLinkTiming = {
  startTimeoutMs: 20_000,
  defaultTimeoutMs: 30_000,
  idleExitMs: 10 * 60_000,
};

export interface HostedLinkDeps {
  /** The Chrome to launch now; null when none is installed on this machine. */
  chrome(): string | null;
  launch(chromePath: string): CdpPipe;
  log(line: string): void;
  timing?: Partial<HostedLinkTiming>;
}

/** A launch that did not happen, and the Chrome it was tried on. */
export type HostedLaunchFailure = LinkUnavailability & { chromePath: string | null };

/** One launched Chrome. */
interface Launched {
  pipe: CdpPipe;
  cdp: CdpConnection;
  tabs: HostedTabs;
  /** Its version; null until it has answered. */
  version: string | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export class HostedLink implements BrowserLink {
  readonly backend = "hosted" as const;
  readonly capabilities = HOSTED_CAPABILITIES;
  private readonly timing: HostedLinkTiming;
  private readonly eventListeners = new Set<(event: DesktopBrowserEvent) => void>();
  private readonly connectListeners = new Set<() => Promise<void> | void>();
  private readonly disconnectListeners = new Set<() => void>();
  /** Never reused, across launches too: a tab id of a Chrome that exited names nothing. */
  private nextTabId = 1;
  private chrome: Launched | null = null;
  private starting: Promise<boolean> | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private lastVersion: string | null = null;
  private lastFailure: HostedLaunchFailure | null = null;
  private disposed = false;

  constructor(private readonly deps: HostedLinkDeps) {
    this.timing = { ...DEFAULT_HOSTED_LINK_TIMING, ...deps.timing };
  }

  /** Whether Chrome is running and has answered. */
  get connected(): boolean {
    return this.running() !== null;
  }

  /** The version of the Chrome last started during this link's life; null before the first. */
  get version(): string | null {
    return this.lastVersion;
  }

  /** Why the last launch did not happen; null after a good one. */
  get failure(): HostedLaunchFailure | null {
    return this.lastFailure;
  }

  /** True once Chrome runs: launched now when it is not (see the module doc). */
  handshake(_force = false): Promise<boolean> {
    if (this.disposed) return Promise.resolve(false);
    if (this.connected) return Promise.resolve(true);
    this.starting ??= this.start().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  unavailability(): LinkUnavailability {
    const failure = this.lastFailure;
    if (failure === null) return { reason: "hosted_launch_failed" };
    return {
      reason: failure.reason,
      ...(failure.detail !== undefined ? { detail: failure.detail } : {}),
    };
  }

  async request(
    command: DesktopBrowserCommand,
    timeoutMs = this.timing.defaultTimeoutMs,
  ): Promise<unknown> {
    const chrome = (await this.handshake()) ? this.running() : null;
    if (chrome === null) {
      throw new BrowserLinkError("closed", "The Chrome on this machine is not running.");
    }
    const { cdp, tabs } = chrome;
    switch (command.op) {
      case "hello":
        return { version: 1, backend: "hosted", chrome: chrome.version };
      case "tabs":
        return { tabs: tabs.list() };
      case "ping":
        return {};
      case "open-tab":
        return { tab: await tabs.open(command.url, timeoutMs) };
      case "close-tab": {
        const targetId = tabs.targetOf(command.tabId);
        await cdp.call("Target.closeTarget", { targetId }, undefined, timeoutMs);
        return {};
      }
      case "activate-tab": {
        const targetId = tabs.targetOf(command.tabId);
        await cdp.call("Target.activateTarget", { targetId }, undefined, timeoutMs);
        return {};
      }
      case "cdp":
        return tabs.command(
          command.tabId,
          command.method,
          command.params ?? {},
          command.events,
          timeoutMs,
        );
      default:
        throw new BrowserLinkError("refused", "unknown_op");
    }
  }

  /** The CDP session of an open tab, or null when the tab is not one (Chrome not running included). */
  session(tabId: number): TabSession | null {
    return this.running()?.tabs.session(tabId) ?? null;
  }

  onEvent(listener: (event: DesktopBrowserEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onConnect(listener: () => Promise<void> | void): () => void {
    this.connectListeners.add(listener);
    return () => this.connectListeners.delete(listener);
  }

  /** Chrome exited or was stopped; its tabs are gone. */
  onDisconnect(listener: () => void): () => void {
    this.disconnectListeners.add(listener);
    return () => this.disconnectListeners.delete(listener);
  }

  /** Stops Chrome and fails whatever waits. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop(false);
    this.eventListeners.clear();
    this.connectListeners.clear();
    this.disconnectListeners.clear();
  }

  // --- Chrome's lifetime ---------------------------------------------------------

  /** The Chrome launched and answering now, or null. */
  private running(): Launched | null {
    return this.chrome !== null && this.chrome.version !== null ? this.chrome : null;
  }

  private async start(): Promise<boolean> {
    const chromePath = this.deps.chrome();
    if (chromePath === null) {
      this.lastFailure = { reason: "hosted_no_chrome", chromePath: null };
      return false;
    }
    const failed = (detail: string): false => {
      this.lastFailure = { reason: "hosted_launch_failed", detail, chromePath };
      this.deps.log(`hosted browser: ${chromePath} did not start: ${detail}`);
      return false;
    };
    let pipe: CdpPipe;
    try {
      pipe = this.deps.launch(chromePath);
    } catch (err) {
      return failed(messageOf(err));
    }
    const cdp = new CdpConnection(
      pipe,
      (method, params, sessionId) => tabs.onEvent(method, params, sessionId),
      this.deps.log,
    );
    const tabs = new HostedTabs({
      cdp,
      emit: (event) => this.emit(event),
      nextId: () => this.nextTabId++,
      changed: () => this.armIdle(),
      log: this.deps.log,
      timeoutMs: this.timing.defaultTimeoutMs,
    });
    const chrome: Launched = { pipe, cdp, tabs, version: null };
    this.chrome = chrome;
    pipe.onClose((exit) => {
      if (this.chrome !== chrome) return;
      if (chrome.version !== null) {
        this.deps.log(
          `hosted browser: Chrome exited (${exit.signal ?? `code ${exit.code ?? "unknown"}`})`,
        );
      }
      this.gone(true);
    });
    try {
      const timeoutMs = this.timing.startTimeoutMs;
      const answer = await cdp.call("Browser.getVersion", {}, undefined, timeoutMs);
      const product = isRecord(answer) && typeof answer.product === "string" ? answer.product : "";
      await cdp.call("Target.setDiscoverTargets", { discover: true }, undefined, timeoutMs);
      chrome.version = product.replace(/^.*\//, "") || "unknown";
    } catch (err) {
      const said = launchFailureLine(pipe.stderr(), messageOf(err));
      if (this.chrome === chrome) this.stop(false);
      else pipe.kill();
      return this.disposed ? false : failed(said);
    }
    if (this.chrome !== chrome) return false;
    this.lastVersion = chrome.version;
    this.lastFailure = null;
    this.armIdle();
    for (const listener of this.connectListeners) {
      try {
        await listener();
      } catch {
        // A listener's failure (a tab refresh that timed out) does not undo the launch.
      }
    }
    return this.chrome === chrome;
  }

  /** Stops the Chrome held now; `announce` tells the disconnect listeners. */
  private stop(announce: boolean): void {
    const chrome = this.chrome;
    if (chrome === null) return;
    this.gone(announce);
    chrome.pipe.kill();
  }

  /** Forgets the Chrome held now: its tabs, its timer, and whatever waited on it. */
  private gone(announce: boolean): void {
    const chrome = this.chrome;
    if (chrome === null) return;
    this.chrome = null;
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    chrome.tabs.clear();
    chrome.cdp.close();
    if (!announce || chrome.version === null) return;
    for (const listener of this.disconnectListeners) {
      try {
        listener();
      } catch (err) {
        this.deps.log(`hosted browser: a disconnect listener failed: ${messageOf(err)}`);
      }
    }
  }

  /** (Re)starts the idle countdown while Chrome holds no tab; a tab stops it. */
  private armIdle(): void {
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    const chrome = this.running();
    if (chrome === null || chrome.tabs.size > 0) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      // A command under way (a tab being opened) is about to give it one.
      if (chrome.cdp.waiting > 0) {
        this.armIdle();
        return;
      }
      this.deps.log("hosted browser: Chrome stopped after holding no tab for a while");
      this.stop(true);
    }, this.timing.idleExitMs);
    this.idleTimer.unref?.();
  }

  private emit(event: DesktopBrowserEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (err) {
        this.deps.log(`hosted browser: a '${event.kind}' event failed: ${messageOf(err)}`);
      }
    }
  }
}
