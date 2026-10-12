/**
 * Raw CDP on driven tabs through `chrome.debugger`, the way the desktop shell runs it on its
 * guests: attach (protocol 1.3) on the first command, relay only the events the server named,
 * attach again on the next command after a detach.
 *
 * - Attaches and detaches are queued per tab, so a command that arrives while an idle detach is
 *   running waits for it and attaches again, and concurrent commands share one attach.
 * - After 60 s without a command the tab is detached, which takes Chrome's "is debugging this
 *   browser" bar away once the agent is done. The relayed-event list survives; the server sends
 *   it again with its next command anyway.
 * - The bar's Cancel (`canceled_by_user`) is the user's kill switch: every driven tab is
 *   released at once, and none is attached again until the user hands it over again.
 * - A page Chrome does not let an extension debug (chrome://, the Web Store, file://) releases
 *   its tab (`restricted`) instead of being attached.
 * - The deny list and the URL rule in policy.ts are applied before anything reaches Chrome.
 */
import { isNavigableUrl, isRefusedCdpMethod, isRestrictedUrl } from "./policy.js";
import type { TabReleaseReason } from "./wire.js";

export const CDP_VERSION = "1.3";
export const IDLE_DETACH_MS = 60_000;

export interface DebuggeeOptions {
  /** One relayed CDP event of a tab. */
  event(tabId: number, method: string, params: Record<string, unknown>): void;
  /** The agent may no longer drive these tabs ("all": every driven tab). */
  release(tabIds: readonly number[] | "all", reason: TabReleaseReason): void;
  idleMs?: number;
  log?(line: string): void;
}

interface Session {
  attached: boolean;
  /** Our own detach is running: Chrome's detach event for it is not news. */
  detaching: boolean;
  relayed: Set<string>;
  inflight: number;
  idle: ReturnType<typeof setTimeout> | null;
  /** The tab's attach/detach queue. */
  queue: Promise<void>;
}

/** A refusal the server reads in `reply.error`. */
export class DebuggeeRefusal extends Error {
  constructor(readonly code: "no_such_tab" | "tab_released" | "cdp_refused" | "bad_url") {
    super(code);
    this.name = "DebuggeeRefusal";
  }
}

export class Debuggee {
  private readonly sessions = new Map<number, Session>();
  private readonly idleMs: number;
  private readonly log: (line: string) => void;

  constructor(private readonly options: DebuggeeOptions) {
    this.idleMs = options.idleMs ?? IDLE_DETACH_MS;
    this.log = options.log ?? (() => {});
  }

  /** Subscribes to Chrome's debugger events. Returns the unsubscribe. */
  listen(): () => void {
    const onEvent = (source: chrome.debugger.Debuggee, method: string, params?: object) =>
      this.handleEvent(source, method, params);
    const onDetach = (source: chrome.debugger.Debuggee, reason: string) =>
      void this.handleDetach(source, reason);
    chrome.debugger.onEvent.addListener(onEvent);
    chrome.debugger.onDetach.addListener(onDetach);
    return () => {
      chrome.debugger.onEvent.removeListener(onEvent);
      chrome.debugger.onDetach.removeListener(onDetach);
    };
  }

  /**
   * Runs one CDP command on a tab the caller already checked the server may drive. `events`
   * replaces the tab's relayed list before the command runs, so an event the command itself
   * causes is not missed; without it the list stays as it is.
   */
  async send(
    tabId: number,
    method: string,
    params?: Record<string, unknown>,
    events?: readonly string[],
  ): Promise<unknown> {
    if (isRefusedCdpMethod(method)) throw new DebuggeeRefusal("cdp_refused");
    if (method === "Page.navigate" && !isNavigableUrl(params?.url)) {
      throw new DebuggeeRefusal("bad_url");
    }
    const session = this.session(tabId);
    if (events !== undefined) session.relayed = new Set(events);
    session.inflight += 1;
    this.clearIdle(session);
    try {
      await this.ensureAttached(tabId, session);
      const result = await chrome.debugger.sendCommand({ tabId }, method, params ?? {});
      return result ?? {};
    } finally {
      session.inflight -= 1;
      if (session.inflight === 0 && session.attached) this.armIdle(tabId, session);
    }
  }

  /** Stops debugging a tab the agent no longer drives (released, closed, forgotten). */
  forget(tabId: number): void {
    const session = this.sessions.get(tabId);
    if (session === undefined) return;
    this.clearIdle(session);
    session.relayed = new Set();
    // The session (and its queue) stays until the detach has run, so a tab handed over again at
    // once attaches after it rather than racing it.
    void this.enqueueDetach(tabId, session).finally(() => {
      if (this.sessions.get(tabId) === session && !session.attached && session.inflight === 0) {
        this.sessions.delete(tabId);
      }
    });
  }

  /** Detaches every tab now (Pause); the next command attaches again. */
  detachAll(): void {
    for (const [tabId, session] of this.sessions) {
      this.clearIdle(session);
      if (session.attached) void this.enqueueDetach(tabId, session);
    }
  }

  private session(tabId: number): Session {
    let session = this.sessions.get(tabId);
    if (session === undefined) {
      session = {
        attached: false,
        detaching: false,
        relayed: new Set(),
        inflight: 0,
        idle: null,
        queue: Promise.resolve(),
      };
      this.sessions.set(tabId, session);
    }
    return session;
  }

  private enqueue(session: Session, step: () => Promise<void>): Promise<void> {
    const next = session.queue.then(step);
    session.queue = next.catch(() => {});
    return next;
  }

  private ensureAttached(tabId: number, session: Session): Promise<void> {
    return this.enqueue(session, async () => {
      if (session.attached) return;
      await this.attach(tabId, session);
    });
  }

  private async attach(tabId: number, session: Session): Promise<void> {
    let tab: chrome.tabs.Tab;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch {
      throw new DebuggeeRefusal("no_such_tab");
    }
    if (isRestrictedUrl(tab.url || tab.pendingUrl)) {
      this.options.release([tabId], "restricted");
      throw new DebuggeeRefusal("tab_released");
    }
    try {
      await chrome.debugger.attach({ tabId }, CDP_VERSION);
    } catch (err) {
      const message = messageOf(err);
      if (/already attached/i.test(message)) {
        // Ours from before a worker restart: it is still attached, which is what we want.
      } else if (/cannot access|cannot attach/i.test(message)) {
        this.options.release([tabId], "restricted");
        throw new DebuggeeRefusal("tab_released");
      } else if (/no tab with/i.test(message)) {
        throw new DebuggeeRefusal("no_such_tab");
      } else {
        throw err;
      }
    }
    session.attached = true;
  }

  private enqueueDetach(tabId: number, session: Session): Promise<void> {
    return this.enqueue(session, async () => {
      if (!session.attached || session.inflight > 0) return;
      session.detaching = true;
      try {
        await chrome.debugger.detach({ tabId });
      } catch {
        // Already detached (the tab closed, or Chrome detached it first).
      } finally {
        session.detaching = false;
        session.attached = false;
      }
    });
  }

  private armIdle(tabId: number, session: Session): void {
    this.clearIdle(session);
    session.idle = setTimeout(() => {
      session.idle = null;
      void this.enqueueDetach(tabId, session);
    }, this.idleMs);
  }

  private clearIdle(session: Session): void {
    if (session.idle !== null) clearTimeout(session.idle);
    session.idle = null;
  }

  /** `chrome.debugger.onEvent`: relays the event when the tab's `events` list names it. */
  handleEvent(source: chrome.debugger.Debuggee, method: string, params?: object): void {
    // Child sessions (out-of-process frames) are not the tab's own; the shell relays none either.
    if (source.tabId === undefined || "sessionId" in source) return;
    const session = this.sessions.get(source.tabId);
    if (session === undefined || !session.relayed.has(method)) return;
    this.options.event(source.tabId, method, (params ?? {}) as Record<string, unknown>);
  }

  /** `chrome.debugger.onDetach`: Chrome ended a session we did not end ourselves. */
  async handleDetach(source: chrome.debugger.Debuggee, reason: string): Promise<void> {
    const tabId = source.tabId;
    if (tabId === undefined) return;
    const session = this.sessions.get(tabId);
    if (session?.detaching === true) return;
    if (session !== undefined) {
      session.attached = false;
      this.clearIdle(session);
    }
    if (reason === "canceled_by_user") {
      // Chrome detached every one of this extension's sessions; the user stopped them all.
      for (const other of this.sessions.values()) {
        other.attached = false;
        this.clearIdle(other);
      }
      this.options.release("all", "user");
      return;
    }
    if (reason === "target_closed") {
      // The tab closed (tabs.onRemoved reports that), or went to a page we may not debug.
      let url: string | undefined;
      try {
        const tab = await chrome.tabs.get(tabId);
        url = tab.url || tab.pendingUrl;
      } catch {
        this.sessions.delete(tabId);
        return;
      }
      if (isRestrictedUrl(url)) this.options.release([tabId], "restricted");
      return;
    }
    this.log(`tab ${tabId}: the debugger detached (${reason})`);
    this.options.release([tabId], "detached");
  }
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));
