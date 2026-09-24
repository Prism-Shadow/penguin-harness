/**
 * The built-in browser's tab registry: what the shell reports (its `tab` / `tab-closed` events,
 * and the full list it answers after each handshake), which tab is active, and the tabs that
 * were asked for but do not exist yet.
 *
 * The shell is the truth about which guests exist; this is its reflection plus two facts the
 * shell does not have. The active tab is the last one the agent used or the user focused, and
 * falls back to the most recently created one. An open request is a tab the server asked the
 * Web App to create (POST /tabs, or a popup the shell turned into a request): the page creates
 * the <webview>, learns its webContents id, and claims the request with it — the first claim
 * wins, and a second window's claim is a duplicate it should remove.
 */
import { randomUUID } from "node:crypto";
import type { BuiltinBrowserTab } from "../api/types.js";

/** How long an unclaimed open request stays claimable. */
const OPEN_REQUEST_TTL_MS = 60_000;

export interface OpenRequest {
  requestId: string;
  url: string;
  /** Whether the tab becomes the active one once it exists. */
  activate: boolean;
  /** The tab whose popup (or "Open link in new tab") this is. */
  openerTabId?: number;
  createdAt: number;
  /** The tab that claimed it; null until then. */
  claimedTabId: number | null;
}

interface OpenState extends OpenRequest {
  waiters: Set<(tabId: number | null) => void>;
}

export type ClaimOutcome = "claimed" | "duplicate" | "unknown";

export class TabRegistry {
  /** In creation order: the last entry is the most recently created tab. */
  private tabs = new Map<number, BuiltinBrowserTab>();
  private active: number | null = null;
  /** A tab activated before the shell reported it. */
  private pendingActive: number | null = null;
  private readonly opens = new Map<string, OpenState>();
  private readonly closeWaiters = new Map<number, Set<() => void>>();
  private readonly timers = new Set<NodeJS.Timeout>();

  constructor(private readonly now: () => number = Date.now) {}

  list(): BuiltinBrowserTab[] {
    return [...this.tabs.values()];
  }

  ids(): number[] {
    return [...this.tabs.keys()];
  }

  get(id: number): BuiltinBrowserTab | undefined {
    return this.tabs.get(id);
  }

  has(id: number): boolean {
    return this.tabs.has(id);
  }

  /** The active tab: the last one used or focused while it is open, else the newest, else none. */
  get activeTabId(): number | null {
    if (this.active !== null && this.tabs.has(this.active)) return this.active;
    let newest: number | null = null;
    for (const id of this.tabs.keys()) newest = id;
    return newest;
  }

  /**
   * Makes a tab the active one; true when the active tab changed. A tab the shell has not
   * reported yet (a claim can overtake the tab's first event) becomes active once it is.
   */
  activate(id: number): boolean {
    if (!this.tabs.has(id)) {
      this.pendingActive = id;
      return false;
    }
    this.pendingActive = null;
    const before = this.activeTabId;
    this.active = id;
    return before !== id;
  }

  /** Applies one `tab` event; returns the tab as it was before (undefined for a new one). */
  upsert(tab: BuiltinBrowserTab): BuiltinBrowserTab | undefined {
    const previous = this.tabs.get(tab.id);
    this.tabs.set(tab.id, tab);
    if (this.pendingActive === tab.id) {
      this.active = tab.id;
      this.pendingActive = null;
    }
    return previous;
  }

  /** Applies a `tab-closed` event; true when the tab was known. */
  remove(id: number): boolean {
    const known = this.tabs.delete(id);
    if (this.active === id) this.active = null;
    this.settleClose(id);
    return known;
  }

  /**
   * Replaces the registry with the shell's full list, keeping the order tabs were first seen in
   * and the active tab while it is still open. Returns whether anything changed.
   */
  replaceAll(tabs: readonly BuiltinBrowserTab[]): boolean {
    const incoming = new Map(tabs.map((tab) => [tab.id, tab]));
    const next = new Map<number, BuiltinBrowserTab>();
    for (const id of this.tabs.keys()) {
      const tab = incoming.get(id);
      if (tab !== undefined) next.set(id, tab);
    }
    for (const [id, tab] of incoming) if (!next.has(id)) next.set(id, tab);
    const changed =
      next.size !== this.tabs.size ||
      [...next].some(([id, tab]) => JSON.stringify(this.tabs.get(id)) !== JSON.stringify(tab));
    const gone = [...this.tabs.keys()].filter((id) => !next.has(id));
    this.tabs = next;
    if (this.pendingActive !== null && next.has(this.pendingActive)) {
      this.active = this.pendingActive;
      this.pendingActive = null;
    }
    if (this.active !== null && !next.has(this.active)) this.active = null;
    for (const id of gone) this.settleClose(id);
    return changed;
  }

  /** Resolves true once the tab is gone (at once when it already is), false after `timeoutMs`. */
  waitForClose(id: number, timeoutMs: number): Promise<boolean> {
    if (!this.tabs.has(id)) return Promise.resolve(true);
    return new Promise((resolve) => {
      const waiters = this.closeWaiters.get(id) ?? new Set<() => void>();
      this.closeWaiters.set(id, waiters);
      const timer = this.timer(() => {
        waiters.delete(done);
        resolve(false);
      }, timeoutMs);
      const done = () => {
        this.clearTimer(timer);
        resolve(true);
      };
      waiters.add(done);
    });
  }

  // --- open requests ---------------------------------------------------------

  /** Records a tab the Web App is about to be asked to create. */
  createOpen(opts: { url: string; activate: boolean; openerTabId?: number }): OpenRequest {
    this.prune();
    const state: OpenState = {
      requestId: randomUUID(),
      url: opts.url,
      activate: opts.activate,
      ...(opts.openerTabId !== undefined ? { openerTabId: opts.openerTabId } : {}),
      createdAt: this.now(),
      claimedTabId: null,
      waiters: new Set(),
    };
    this.opens.set(state.requestId, state);
    return this.snapshot(state);
  }

  /**
   * Correlates a created <webview> with the request it was created for. The first claim wins;
   * the same claim again is harmless; another tab's claim of a taken request is a duplicate,
   * and so is a claim of a request that expired or never existed.
   */
  claim(requestId: string, tabId: number): ClaimOutcome {
    this.prune();
    const state = this.opens.get(requestId);
    if (state === undefined) return "unknown";
    if (state.claimedTabId !== null) return state.claimedTabId === tabId ? "claimed" : "duplicate";
    state.claimedTabId = tabId;
    for (const waiter of state.waiters) waiter(tabId);
    state.waiters.clear();
    return "claimed";
  }

  /** The claiming tab's id, or null when nobody claims the request within `timeoutMs`. */
  waitForClaim(requestId: string, timeoutMs: number): Promise<number | null> {
    const state = this.opens.get(requestId);
    if (state === undefined) return Promise.resolve(null);
    if (state.claimedTabId !== null) return Promise.resolve(state.claimedTabId);
    return new Promise((resolve) => {
      const timer = this.timer(() => {
        state.waiters.delete(done);
        resolve(null);
      }, timeoutMs);
      const done = (tabId: number | null) => {
        this.clearTimer(timer);
        resolve(tabId);
      };
      state.waiters.add(done);
    });
  }

  /** The open requests no window has claimed yet: tabs on their way. */
  pendingOpens(): number {
    this.prune();
    let pending = 0;
    for (const state of this.opens.values()) if (state.claimedTabId === null) pending += 1;
    return pending;
  }

  /** One open request as it stands, or undefined once it expired. */
  openRequest(requestId: string): OpenRequest | undefined {
    const state = this.opens.get(requestId);
    return state === undefined ? undefined : this.snapshot(state);
  }

  /** The requests `openerTabId` made since `since` (its popups during one call). */
  opensFrom(openerTabId: number, since: number): OpenRequest[] {
    return [...this.opens.values()]
      .filter((state) => state.openerTabId === openerTabId && state.createdAt >= since)
      .map((state) => this.snapshot(state));
  }

  /** Settles every waiter (claims with null, closes with false) and stops the timers. */
  dispose(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    for (const state of this.opens.values()) {
      for (const waiter of state.waiters) waiter(null);
      state.waiters.clear();
    }
    this.closeWaiters.clear();
  }

  private settleClose(id: number): void {
    const waiters = this.closeWaiters.get(id);
    if (waiters === undefined) return;
    this.closeWaiters.delete(id);
    for (const waiter of waiters) waiter();
  }

  private prune(): void {
    const cutoff = this.now() - OPEN_REQUEST_TTL_MS;
    for (const [id, state] of this.opens) {
      if (state.createdAt < cutoff && state.waiters.size === 0) this.opens.delete(id);
    }
  }

  private snapshot(state: OpenState): OpenRequest {
    const { waiters: _waiters, ...request } = state;
    return request;
  }

  private timer(fn: () => void, ms: number): NodeJS.Timeout {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      fn();
    }, ms);
    this.timers.add(timer);
    return timer;
  }

  private clearTimer(timer: NodeJS.Timeout): void {
    clearTimeout(timer);
    this.timers.delete(timer);
  }
}
