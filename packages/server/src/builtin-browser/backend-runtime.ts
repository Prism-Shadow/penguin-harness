/**
 * One backend of the agent browser as the facade (service.ts) drives it: a link, the tab
 * registry it reflects, the driver and actions over them, and the state that belongs to that
 * link — actions in flight, popups, the load measurements and the throttling (built-in only).
 * The desktop's built-in browser has one runtime; each user with a paired Chrome has their own.
 *
 * What a backend can do is its link's `capabilities`:
 *
 * - Built-in (`createsTabs: false`): tabs are created by the Web App — a <webview> is an element
 *   of its page — so opening one is a request published to the admins' windows, answered by a
 *   claim; closing one is the same. The shell measures its guests every ~10 s and throttles the
 *   ones nobody looks at or drives.
 * - Chrome (`createsTabs: true`): the extension opens, closes and focuses tabs itself, in its
 *   Penguin tab group. A tab the user takes back from the agent (Chrome's debugging bar Cancel,
 *   a restricted page) is `tab-released`: it leaves the registry, and an action on it answers
 *   409 `tab_released`. The registry outlives a disconnect and is replaced by the extension's
 *   tab list when it reconnects.
 *
 * Every agent action names a tab (`active` included), makes it the active one, and is
 * bracketed by `builtin_browser_activity` events so the window can show the agent at work.
 */
import os from "node:os";
import type {
  BrowserBackend,
  BuiltinBrowserAction,
  BuiltinBrowserExecResult,
  BuiltinBrowserMetrics,
  BuiltinBrowserScanResult,
  BuiltinBrowserScreenshot,
  BuiltinBrowserServerEvent,
  BuiltinBrowserTab,
  BuiltinBrowserTabsResponse,
  BuiltinBrowserUnavailableReason,
  DesktopBrowserCommand,
  DesktopBrowserEvent,
} from "../api/types.js";
import { HttpError } from "../http/errors.js";
import { BrowserActions, DEFAULT_ACTION_TIMING } from "./actions.js";
import type { ActionTiming } from "./actions.js";
import { BrowserDriver, mapLinkError, tabCrashedError } from "./driver.js";
import { isWebUrl } from "./history.js";
import type { HistoryStore } from "./history.js";
import {
  BrowserLinkError,
  BrowserUnavailableError,
  browserLabel,
  tabReleasedError,
} from "./link.js";
import type { BrowserLink } from "./link.js";
import { assessLoad, systemMemory } from "./load.js";
import { parseTab } from "./shell-link.js";
import type { ShellLinkTiming } from "./shell-link.js";
import { TabRegistry } from "./tabs.js";
import type { OpenRequest } from "./tabs.js";

export interface BrowserTiming extends ShellLinkTiming, ActionTiming {
  /** How long an opened tab has to be claimed by a window (built-in), or created by the extension (chrome). */
  openClaimMs: number;
  /** How long a closed tab has to disappear. */
  closeWaitMs: number;
  /** The far side's tab list after a handshake. */
  tabsTimeoutMs: number;
  /** Tab events within this window reach the windows as one `builtin_browser_tabs`. */
  publishDelayMs: number;
  /** After an agent's action in a tab (or a new tab opening), how long it runs unthrottled. */
  throttleGraceMs: number;
}

/**
 * The most tabs the browser holds; an agent's new tab beyond them is refused. Twenty busy
 * shopping and news sites held 3.3 GB between them (measured on Linux), which is already more
 * than an 8 GB laptop can spare; the load warning speaks up well before this.
 */
export const MAX_TABS = 20;
/** A page may open this many tabs (popups, target=_blank) in any POPUP_WINDOW_MS; more are dropped. */
const POPUP_LIMIT = 3;
const POPUP_WINDOW_MS = 5_000;
/** The released tabs remembered, so an action on one says why rather than "no such tab". */
const RELEASED_KEPT = 100;

export const DEFAULT_RUNTIME_TIMING: Pick<
  BrowserTiming,
  "openClaimMs" | "closeWaitMs" | "tabsTimeoutMs" | "publishDelayMs" | "throttleGraceMs"
> = {
  openClaimMs: 15_000,
  closeWaitMs: 5_000,
  tabsTimeoutMs: 5_000,
  // A page announces itself in bursts (start, navigate, title, icon, stop), and a busy one never
  // stops (a ticking title); the windows get the tab list at most five times a second.
  publishDelayMs: 200,
  throttleGraceMs: 30_000,
};
/** How long the shell gets to apply a throttling change. */
const THROTTLE_TIMEOUT_MS = 5_000;

/** The page a tab opens or navigates to; see service.ts's browserUrl. */
export type UrlCheck = (raw: unknown, blankWhenEmpty: boolean) => string;

/**
 * Raw CDP methods the chrome backend refuses: other targets, the browser itself, every way to
 * read or write the user's cookies and stores or to intercept their traffic, the page's security
 * state, files from the user's disk and where downloads go. Chrome holds the user's real
 * sign-ins; the page scripts use none of these. The extension refuses the same list.
 */
const CHROME_REFUSED_DOMAINS = [
  "Target.",
  "Browser.",
  "Storage.",
  "Fetch.",
  "Extensions.",
  "Tethering.",
  "Security.",
];
const CHROME_REFUSED_METHODS = new Set([
  "Network.getAllCookies",
  "Network.getCookies",
  "Network.setCookie",
  "Network.setCookies",
  "Network.deleteCookies",
  "Network.clearBrowserCookies",
  "Network.clearBrowserCache",
  "Network.setRequestInterception",
  // Hands the page a file from the user's disk, or decides where downloads land.
  "DOM.setFileInputFiles",
  "Page.setDownloadBehavior",
]);

export interface BackendRuntimeDeps {
  link: BrowserLink;
  /** The events this backend's windows hear: every admin's (built-in), or its user's (chrome). */
  publish(event: BuiltinBrowserServerEvent): void;
  log(line: string): void;
  /** The homepage a new tab with no address opens; null for none (blank). */
  homepage(): Promise<string | null>;
  /** The address check the routes' URLs go through (service.ts's browserUrl). */
  url: UrlCheck;
  /** Built-in only: the history the browser's tab events feed. */
  history?: HistoryStore;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  timing?: Partial<BrowserTiming>;
  /** This computer's memory, for the load warning (os.freemem / os.totalmem by default). */
  systemMemory?: () => { freeBytes: number; totalBytes: number };
  /** process.platform by default. */
  platform?: string;
}

export class BrowserBackendRuntime {
  readonly tabs: TabRegistry;
  readonly backend: BrowserBackend;
  readonly link: BrowserLink;
  private readonly driver: BrowserDriver;
  private readonly actions: BrowserActions;
  private readonly timing: typeof DEFAULT_RUNTIME_TIMING;
  /** How long an opened web page gets to load before POST /tabs answers. */
  private readonly loadWaitMs: number;
  /** Agent actions in flight per tab, and the session the latest one came from. */
  private readonly inflight = new Map<number, { count: number; sessionId?: string }>();
  /** Per opener tab, when its recent popups were let through (see `openFromPage`). */
  private readonly popups = new Map<number, number[]>();
  /** Chrome: the tabs the user took back from the agent, with why, newest last. */
  private readonly released = new Map<number, string>();
  private readonly now: () => number;
  private publishTimer: NodeJS.Timeout | null = null;
  /** The last tab list the windows were sent, to skip sending the same one again. */
  private published: string | null = null;
  /** The shell's latest measurement with its verdict; null before the first. */
  private measured: BuiltinBrowserMetrics | null = null;
  /** Per tab, when an agent last acted in it (or it opened): it runs unthrottled for a while after. */
  private readonly actedAt = new Map<number, number>();
  /** The throttled tabs the shell was last told of, as a key; null when it must be told again. */
  private throttleSent: string | null = null;
  /** An older shell does not throttle: every tab runs at full speed, as it always did. */
  private throttleUnsupported = false;
  /** The tab a window shows on screen (POST /tabs/on-screen); never throttled while it is there. */
  private onScreen: number | null = null;
  private throttleTimer: NodeJS.Timeout | null = null;
  private disposed = false;

  constructor(private readonly deps: BackendRuntimeDeps) {
    const now = deps.now ?? Date.now;
    this.now = now;
    this.link = deps.link;
    this.backend = deps.link.backend;
    this.timing = { ...DEFAULT_RUNTIME_TIMING, ...deps.timing };
    this.loadWaitMs = deps.timing?.loadWaitMs ?? DEFAULT_ACTION_TIMING.loadWaitMs;
    this.tabs = new TabRegistry(now);
    this.driver = new BrowserDriver(this.link, {
      now,
      ...(deps.sleep ? { sleep: deps.sleep } : {}),
    });
    this.actions = new BrowserActions({
      driver: this.driver,
      tabs: this.tabs,
      now,
      ...(deps.sleep ? { sleep: deps.sleep } : {}),
      ...(deps.timing ? { timing: deps.timing } : {}),
    });
    this.link.onEvent((event) => this.onLinkEvent(event));
    this.link.onConnect(() => this.refreshTabs());
  }

  /** The latest load measurement (built-in), for the status. */
  get metrics(): BuiltinBrowserMetrics | null {
    return this.measured;
  }

  /** Whether an agent action is running in any of this backend's tabs (a backend switch waits for it). */
  get busy(): boolean {
    return this.inflight.size > 0;
  }

  /** Why this backend cannot be driven now, or null. `force` retries a failed handshake. */
  async unavailability(force: boolean): Promise<BuiltinBrowserUnavailableReason | null> {
    if (await this.link.handshake(force)) return null;
    return this.backend === "builtin" ? "shell_unsupported" : "extension_disconnected";
  }

  // --- tabs ----------------------------------------------------------------------

  /** GET /tabs. */
  async listTabs(): Promise<BuiltinBrowserTabsResponse> {
    await this.ready();
    return { tabs: this.tabs.list(), activeTabId: this.tabs.activeTabId };
  }

  /**
   * POST /tabs: a tab at the address given, else at the homepage, else blank — asked of the
   * admins' windows (built-in) or of the extension (chrome) — and, for a web page, loaded.
   */
  async openTab(opts: {
    url?: unknown;
    sessionId?: string;
    activate?: boolean;
  }): Promise<BuiltinBrowserTab> {
    await this.ready();
    const url = await this.newTabUrl(opts.url);
    if (this.tabsHeld() >= MAX_TABS) {
      throw new HttpError(
        409,
        "too_many_tabs",
        `${capitalized(browserLabel(this.backend))} holds ${MAX_TABS} tabs, the most it keeps; close some first (penguin browser close <tab-id>).`,
      );
    }
    const activate = opts.activate !== false;
    const tabId = this.link.capabilities.createsTabs
      ? await this.createTab(url, activate)
      : await this.requestTab(url, activate, opts.sessionId);
    // The agent's (or the panel's) new tab: its grace runs from now, as after an action.
    this.actedAt.set(tabId, this.now());
    this.syncThrottle();
    if (isWebUrl(url)) {
      // A tab exists from its initial empty document, which reads as loaded: the page asked for
      // is waited for once it has committed.
      const deadline = this.now() + this.loadWaitMs;
      await this.tabs.waitForFirstPage(tabId, this.loadWaitMs);
      await this.driver.waitForLoad(tabId, Math.max(0, deadline - this.now()));
    }
    return this.tabOrThrow(tabId);
  }

  /** POST /tabs/claim (built-in): the window that created a requested tab names it. */
  async claim(requestId: string, tabId: number): Promise<void> {
    await this.ready();
    const outcome = this.tabs.claim(requestId, tabId);
    if (outcome === "duplicate") {
      throw new HttpError(
        409,
        "already_claimed",
        "Another window already created this tab; remove the duplicate.",
      );
    }
    if (outcome === "unknown") {
      throw new HttpError(
        409,
        "unknown_request",
        "No tab is waiting for this request any more; remove the tab.",
      );
    }
    if (this.tabs.openRequest(requestId)?.activate === true && this.tabs.activate(tabId)) {
      this.schedulePublish();
    }
  }

  /**
   * POST /tabs/:tab/activate: the user focused a tab, or the agent switched to one. On chrome
   * the tab is also shown in the user's Chrome, since that is where they look at it.
   */
  async activate(tab: string): Promise<BuiltinBrowserTab> {
    await this.ready();
    const tabId = this.resolve(tab);
    if (this.tabs.activate(tabId)) this.schedulePublish();
    if (this.link.capabilities.createsTabs) {
      await this.command({ op: "activate-tab", tabId }, tabId);
    }
    return this.tabOrThrow(tabId);
  }

  /**
   * POST /tabs/on-screen: the tab a window shows now, or none (its panel closed, the window
   * hidden). That tab is left at full speed; the one it replaces may be throttled.
   */
  setOnScreen(tabId: number | null): void {
    this.onScreen = tabId;
    this.syncThrottle();
  }

  /** DELETE /tabs/:tab: closed by the extension (chrome), or by the window holding it (built-in). */
  async close(tab: string): Promise<void> {
    await this.ready();
    const tabId = this.resolve(tab);
    if (this.link.capabilities.createsTabs) {
      await this.command({ op: "close-tab", tabId }, tabId, this.timing.closeWaitMs);
      // The extension reports it closed as well; the registry need not wait for that.
      if (this.tabs.remove(tabId)) this.schedulePublish();
      this.forget(tabId);
      return;
    }
    this.deps.publish({ type: "builtin_browser_close", tabId });
    if (!(await this.tabs.waitForClose(tabId, this.timing.closeWaitMs))) {
      throw new BrowserUnavailableError("no_window");
    }
  }

  // --- agent actions ----------------------------------------------------------

  /** POST /tabs/:tab/navigate. `active` with no tab open opens one. */
  async navigate(tab: string, rawUrl: unknown, sessionId?: string): Promise<BuiltinBrowserTab> {
    const url = this.deps.url(rawUrl, false);
    await this.ready();
    if (tab === "active" && this.tabs.activeTabId === null) {
      return this.openTab({
        url,
        activate: true,
        ...(sessionId !== undefined ? { sessionId } : {}),
      });
    }
    return this.act(tab, "navigate", sessionId, async (tabId, actions) => {
      await actions.navigate(tabId, url);
      return this.tabOrThrow(tabId);
    });
  }

  scan(
    tab: string,
    opts: { textOnly?: boolean; maxChars?: number; instruction?: string },
    sessionId?: string,
  ): Promise<BuiltinBrowserScanResult> {
    return this.act(tab, "scan", sessionId, async (tabId, actions) => {
      const { content, truncated } = await actions.scan(tabId, opts);
      return {
        tab: this.tabOrThrow(tabId),
        tabs: this.tabs.list(),
        activeTabId: this.tabs.activeTabId,
        content,
        ...(truncated ? { truncated } : {}),
      };
    });
  }

  exec(
    tab: string,
    script: string,
    opts: { noMonitor?: boolean; timeoutMs?: number; acceptDialogs?: boolean },
    sessionId?: string,
  ): Promise<BuiltinBrowserExecResult> {
    return this.act(tab, "exec", sessionId, (tabId, actions) => actions.exec(tabId, script, opts));
  }

  click(
    tab: string,
    target: { selector: string; index?: number } | { x: number; y: number },
    opts: { acceptDialogs?: boolean },
    sessionId?: string,
  ): Promise<BuiltinBrowserExecResult> {
    return this.act(tab, "click", sessionId, (tabId, actions) =>
      actions.click(tabId, target, opts),
    );
  }

  type(
    tab: string,
    opts: { text: string; selector?: string; submit?: boolean; acceptDialogs?: boolean },
    sessionId?: string,
  ): Promise<BuiltinBrowserExecResult> {
    return this.act(tab, "type", sessionId, (tabId, actions) => actions.type(tabId, opts));
  }

  screenshot(
    tab: string,
    opts: { fullPage?: boolean },
    sessionId?: string,
  ): Promise<BuiltinBrowserScreenshot> {
    return this.act(tab, "screenshot", sessionId, (tabId, actions) =>
      actions.screenshot(tabId, opts),
    );
  }

  cdp(
    tab: string,
    method: string,
    params: Record<string, unknown> | undefined,
    sessionId?: string,
  ): Promise<unknown> {
    this.checkRawCdp(method, params);
    return this.act(tab, "cdp", sessionId, (tabId, actions) => actions.cdp(tabId, method, params));
  }

  /** A command for the link itself (the built-in browser's cookies and data), past the availability check. */
  async request(command: DesktopBrowserCommand, timeoutMs: number): Promise<unknown> {
    await this.ready();
    try {
      return await this.link.request(command, timeoutMs);
    } catch (err) {
      throw mapLinkError(err, -1, this.backend);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.publishTimer !== null) clearTimeout(this.publishTimer);
    this.publishTimer = null;
    if (this.throttleTimer !== null) clearTimeout(this.throttleTimer);
    this.throttleTimer = null;
    this.link.dispose();
    this.tabs.dispose();
  }

  // --- internals ---------------------------------------------------------------

  /** Throws `browser_unavailable` with the reason unless this backend can be driven now. */
  async ready(): Promise<void> {
    const reason = await this.unavailability(false);
    if (reason !== null) throw new BrowserUnavailableError(reason);
  }

  /**
   * What raw CDP may not do. Both backends: reach other targets (`Target.*`: open, attach to or
   * close pages the browser does not know), or navigate where the address bar would not go
   * (`Page.navigate` gets its rule: a web page or about:blank). Chrome also refuses the browser,
   * its cookies and stores and request interception: those are the user's real ones.
   */
  private checkRawCdp(method: string, params: Record<string, unknown> | undefined): void {
    if (this.backend === "chrome") {
      if (
        CHROME_REFUSED_METHODS.has(method) ||
        CHROME_REFUSED_DOMAINS.some((domain) => method.startsWith(domain))
      ) {
        throw new HttpError(
          403,
          "cdp_refused",
          `${method} is not available on your own Chrome: its cookies, stores and other tabs stay in Chrome. Open, switch and close tabs with penguin browser open, switch and close.`,
        );
      }
    } else if (method.startsWith("Target.")) {
      throw new HttpError(
        403,
        "cdp_refused",
        `${method} is not available through the built-in browser; open, switch and close tabs with penguin browser open, switch and close.`,
      );
    }
    if (method === "Page.navigate") this.deps.url(params?.url, false);
  }

  /** A command about one tab, its failure mapped to what the route answers. */
  private async command(
    command: DesktopBrowserCommand,
    tabId: number,
    timeoutMs?: number,
  ): Promise<unknown> {
    try {
      return await this.link.request(command, timeoutMs);
    } catch (err) {
      throw mapLinkError(err, tabId, this.backend);
    }
  }

  /** Chrome: the extension creates the tab in its group and answers with it. */
  private async createTab(url: string, activate: boolean): Promise<number> {
    const answer = (await this.command(
      { op: "open-tab", url, activate },
      -1,
      this.timing.openClaimMs,
    )) as { tab?: unknown } | null;
    const tab = parseTab(answer?.tab);
    if (tab === null) {
      throw new HttpError(502, "bad_reply", "The extension answered open-tab without a tab.");
    }
    // Its `tab` event may come after the reply: the registry learns it from the answer.
    const previous = this.tabs.upsert(tab);
    this.released.delete(tab.id);
    if (previous === undefined) this.schedulePublish();
    if (activate && this.tabs.activate(tab.id)) this.schedulePublish();
    return tab.id;
  }

  /** Built-in: a window creates the <webview> and claims the request. */
  private async requestTab(
    url: string,
    activate: boolean,
    sessionId: string | undefined,
  ): Promise<number> {
    const request = this.requestOpen({
      url,
      activate,
      ...(sessionId !== undefined ? { sessionId } : {}),
    });
    const tabId = await this.tabs.waitForClaim(request.requestId, this.timing.openClaimMs);
    if (tabId === null) throw new BrowserUnavailableError("no_window");
    if (!this.tabs.has(tabId)) await this.refreshTabs().catch(() => undefined);
    return tabId;
  }

  /** `active` or a tab id, to an open tab. */
  private resolve(tab: string): number {
    if (tab === "active") {
      const id = this.tabs.activeTabId;
      if (id === null) {
        throw new HttpError(404, "no_tab", `No tab is open in ${browserLabel(this.backend)}.`);
      }
      return id;
    }
    const id = /^\d{1,15}$/.test(tab) ? Number(tab) : Number.NaN;
    if (!this.tabs.has(id)) {
      if (this.released.has(id)) throw tabReleasedError(id);
      throw new HttpError(
        404,
        "no_such_tab",
        `Tab ${tab} is not open in ${browserLabel(this.backend)}.`,
      );
    }
    return id;
  }

  private tabOrThrow(tabId: number): BuiltinBrowserTab {
    const tab = this.tabs.get(tabId);
    if (tab === undefined) {
      if (this.released.has(tabId)) throw tabReleasedError(tabId);
      throw new HttpError(
        404,
        "no_such_tab",
        `Tab ${tabId} is not open in ${browserLabel(this.backend)}.`,
      );
    }
    return tab;
  }

  /** The page a new tab opens: the address it was given, else the homepage, else the blank page. */
  private async newTabUrl(raw: unknown): Promise<string> {
    if (raw !== undefined && raw !== null && raw !== "") return this.deps.url(raw, false);
    return (await this.deps.homepage()) ?? "about:blank";
  }

  /**
   * One agent action on one tab: made active, running unthrottled and announced busy while it
   * runs. A tab whose page crashed answers `tab_crashed` at once, and so does an action whose
   * page crashed under it, whatever error that left behind; one the user took back while it ran
   * answers `tab_released`.
   */
  private async act<T>(
    tab: string,
    action: BuiltinBrowserAction,
    sessionId: string | undefined,
    run: (tabId: number, actions: BrowserActions) => Promise<T>,
  ): Promise<T> {
    await this.ready();
    const tabId = this.resolve(tab);
    const crashed = this.tabs.get(tabId)?.crashed;
    if (crashed !== undefined) throw tabCrashedError(tabId, crashed);
    if (this.tabs.activate(tabId)) this.schedulePublish();
    this.activity(tabId, action, sessionId, 1);
    try {
      return await run(tabId, this.actions);
    } catch (err) {
      if (this.released.has(tabId)) throw tabReleasedError(tabId);
      // The far side no longer has it: the registry catches up rather than waiting for the event.
      if (err instanceof HttpError && err.code === "no_such_tab" && this.tabs.remove(tabId)) {
        this.schedulePublish();
      }
      const crashedNow = this.tabs.get(tabId)?.crashed;
      if (crashedNow !== undefined) throw tabCrashedError(tabId, crashedNow);
      throw err;
    } finally {
      this.activity(tabId, action, sessionId, -1);
    }
  }

  private activity(
    tabId: number,
    action: BuiltinBrowserAction,
    sessionId: string | undefined,
    delta: 1 | -1,
  ): void {
    const entry = this.inflight.get(tabId) ?? { count: 0 };
    entry.count += delta;
    if (delta > 0 && sessionId !== undefined) entry.sessionId = sessionId;
    if (entry.count > 0) this.inflight.set(tabId, entry);
    else this.inflight.delete(tabId);
    if (delta < 0) this.actedAt.set(tabId, this.now());
    // Before the action's first command: the port keeps order, so the page is at full speed
    // by the time the action reaches it.
    this.syncThrottle();
    this.deps.publish({
      type: "builtin_browser_activity",
      tabId,
      busy: entry.count > 0,
      action,
      ...(sessionId !== undefined ? { sessionId } : {}),
    });
  }

  private requestOpen(opts: {
    url: string;
    activate: boolean;
    openerTabId?: number;
    sessionId?: string;
  }): OpenRequest {
    const request = this.tabs.createOpen({
      url: opts.url,
      activate: opts.activate,
      ...(opts.openerTabId !== undefined ? { openerTabId: opts.openerTabId } : {}),
    });
    this.deps.publish({
      type: "builtin_browser_open",
      requestId: request.requestId,
      url: opts.url,
      activate: opts.activate,
      ...(opts.openerTabId !== undefined ? { openerTabId: opts.openerTabId } : {}),
      ...(opts.sessionId !== undefined ? { sessionId: opts.sessionId } : {}),
    });
    return request;
  }

  /**
   * A popup, or "Open link in new tab" (built-in: the extension adopts a driven tab's popups
   * itself and announces them as tabs). The session of an action running in the opener is the
   * one that caused it. A page gets at most POPUP_LIMIT tabs in any POPUP_WINDOW_MS, and none
   * while the browser holds MAX_TABS: one looping on window.open would otherwise open tabs
   * without end. What goes over is dropped, with a log line.
   */
  private openFromPage(event: { url: string; openerTabId: number; background?: boolean }): void {
    const now = this.now();
    const recent = (this.popups.get(event.openerTabId) ?? []).filter(
      (at) => now - at < POPUP_WINDOW_MS,
    );
    const full = this.tabsHeld() >= MAX_TABS;
    if (full || recent.length >= POPUP_LIMIT) {
      this.popups.set(event.openerTabId, recent);
      this.deps.log(
        `builtin browser: dropped a popup of tab ${event.openerTabId}: ${
          full ? `the browser holds ${MAX_TABS} tabs` : `more than ${POPUP_LIMIT} in 5 s`
        }`,
      );
      return;
    }
    this.popups.set(event.openerTabId, [...recent, now]);
    const sessionId = this.inflight.get(event.openerTabId)?.sessionId;
    this.requestOpen({
      url: event.url,
      activate: event.background !== true,
      openerTabId: event.openerTabId,
      ...(sessionId !== undefined ? { sessionId } : {}),
    });
  }

  /** The tabs open, and those on their way (asked of a window, not yet claimed). */
  private tabsHeld(): number {
    return this.tabs.list().length + this.tabs.pendingOpens();
  }

  /** The per-tab state of a tab that is gone. */
  private forget(tabId: number): void {
    this.inflight.delete(tabId);
    this.popups.delete(tabId);
    this.actedAt.delete(tabId);
  }

  /** One link event. Never throws: a failure is logged, and the next event starts clean. */
  private onLinkEvent(event: DesktopBrowserEvent): void {
    try {
      this.applyLinkEvent(event);
    } catch (err) {
      const side =
        this.backend === "builtin"
          ? "builtin browser: the shell's"
          : "chrome browser: the extension's";
      this.deps.log(`${side} '${event.kind}' event failed: ${messageOf(err)}`);
    }
  }

  private applyLinkEvent(event: DesktopBrowserEvent): void {
    switch (event.kind) {
      case "tab": {
        const previous = this.tabs.upsert(event.tab);
        this.released.delete(event.tab.id);
        if (previous === undefined) {
          // A new tab loads at full speed for the grace period, whoever opened it.
          if (!this.actedAt.has(event.tab.id)) this.actedAt.set(event.tab.id, this.now());
          this.syncThrottle();
        }
        this.deps.history?.observe(previous, event.tab);
        this.schedulePublish();
        break;
      }
      case "tab-closed":
        if (this.tabs.remove(event.tabId)) this.schedulePublish();
        this.released.delete(event.tabId);
        this.forget(event.tabId);
        this.syncThrottle();
        break;
      case "tab-released":
        this.deps.log(`chrome browser: tab ${event.tabId} was released (${event.reason})`);
        this.released.delete(event.tabId);
        this.released.set(event.tabId, event.reason);
        for (const id of this.released.keys()) {
          if (this.released.size <= RELEASED_KEPT) break;
          this.released.delete(id);
        }
        if (this.tabs.remove(event.tabId)) this.schedulePublish();
        this.popups.delete(event.tabId);
        this.actedAt.delete(event.tabId);
        break;
      case "tab-crashed":
        this.deps.log(
          `builtin browser: tab ${event.tabId}'s page crashed (${event.reason}, exit code ${event.exitCode})`,
        );
        if (this.tabs.markCrashed(event.tabId, event.reason)) this.schedulePublish();
        break;
      case "metrics":
        if (this.link.capabilities.throttles) this.measure(event.tabs, event.totalKB);
        break;
      case "open-request":
        if (!this.link.capabilities.createsTabs && isWebUrl(event.url)) this.openFromPage(event);
        break;
      case "cdp-event":
        // An action's own subscription (driver.onCdpEvent); nothing for the registry.
        break;
    }
    // An event proves the shell speaks the protocol. A link that has not shaken hands yet (a
    // server that started under a running window) does it now, and learns the other tabs.
    if (this.backend === "builtin" && !this.link.connected) void this.link.handshake(true);
  }

  private async refreshTabs(): Promise<void> {
    const answer = (await this.link.request({ op: "tabs" }, this.timing.tabsTimeoutMs)) as {
      tabs?: unknown;
    } | null;
    const tabs = Array.isArray(answer?.tabs)
      ? answer.tabs.map(parseTab).filter((tab): tab is BuiltinBrowserTab => tab !== null)
      : [];
    if (this.tabs.replaceAll(tabs)) this.schedulePublish();
    // A shell met again (a new generation, a restarted server) is told afresh which tabs to throttle.
    this.throttleSent = null;
    this.syncThrottle();
  }

  /** A measurement from the shell: judged (load.ts), kept for the status, and sent to the windows. */
  private measure(
    measured: { tabId: number; memoryKB: number; cpuPercent: number }[],
    totalKB: number,
  ) {
    const open = new Set(this.tabs.ids());
    const read =
      this.deps.systemMemory ?? (() => ({ freeBytes: os.freemem(), totalBytes: os.totalmem() }));
    const { freeBytes, totalBytes } = read();
    const system = systemMemory(this.deps.platform ?? process.platform, freeBytes, totalBytes);
    this.measured = assessLoad(
      {
        at: this.now(),
        tabs: measured.filter((tab) => open.has(tab.tabId)),
        totalKB,
        ...(system !== undefined ? { system } : {}),
        tabCount: open.size,
      },
      this.measured?.warnings ?? [],
    );
    this.deps.publish({ type: "builtin_browser_metrics", metrics: this.measured });
  }

  /**
   * Tells the shell which tabs may be throttled while out of sight: every open tab but the one on
   * screen and those an agent is acting in or acted in within the grace period (new tabs
   * included). Sent only when the list changes, and re-checked when the earliest grace runs out.
   * A shell too old for the command leaves every tab at full speed, as before; a link that does
   * not throttle (chrome) is never told.
   */
  private syncThrottle(): void {
    const link = this.link;
    if (!link.capabilities.throttles) return;
    if (!link.connected || this.throttleUnsupported || this.disposed) return;
    const now = this.now();
    const grace = this.timing.throttleGraceMs;
    let recheckAt = Number.POSITIVE_INFINITY;
    const throttled: number[] = [];
    for (const id of this.tabs.ids()) {
      if (id === this.onScreen || this.inflight.has(id)) continue;
      const acted = this.actedAt.get(id);
      if (acted !== undefined && now - acted < grace) {
        recheckAt = Math.min(recheckAt, acted + grace);
        continue;
      }
      throttled.push(id);
    }
    if (this.throttleTimer !== null) clearTimeout(this.throttleTimer);
    this.throttleTimer = null;
    if (recheckAt !== Number.POSITIVE_INFINITY) {
      this.throttleTimer = setTimeout(() => {
        this.throttleTimer = null;
        this.syncThrottle();
      }, recheckAt - now);
      this.throttleTimer.unref?.();
    }
    throttled.sort((a, b) => a - b);
    const key = throttled.join(",");
    if (key === this.throttleSent) return;
    this.throttleSent = key;
    link
      .request({ op: "throttle", tabIds: throttled }, THROTTLE_TIMEOUT_MS)
      .catch((err: unknown) => {
        if (
          err instanceof BrowserLinkError &&
          err.kind === "refused" &&
          err.message === "unknown_op"
        ) {
          this.throttleUnsupported = true;
          return;
        }
        // Told again with the next change.
        if (this.throttleSent === key) this.throttleSent = null;
      });
  }

  /** The tab list to the windows, once per burst of changes, and only when it differs from the last one sent. */
  private schedulePublish(): void {
    if (this.publishTimer !== null || this.disposed) return;
    this.publishTimer = setTimeout(() => {
      this.publishTimer = null;
      if (this.disposed) return;
      const tabs = this.tabs.list();
      const activeTabId = this.tabs.activeTabId;
      const snapshot = JSON.stringify({ tabs, activeTabId });
      if (snapshot === this.published) return;
      this.published = snapshot;
      try {
        this.deps.publish({ type: "builtin_browser_tabs", tabs, activeTabId });
      } catch (err) {
        this.published = null;
        this.deps.log(`${this.backend} browser: the tab list could not be sent: ${messageOf(err)}`);
      }
    }, this.timing.publishDelayMs);
  }
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));
const capitalized = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);
