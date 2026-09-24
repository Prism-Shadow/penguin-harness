/**
 * The built-in browser as the routes drive it: one object per platform generation that owns
 * the shell link, the tab registry, the driver and actions over them, the history, and the
 * events the admins' windows hear.
 *
 * Availability comes first on every call that needs the shell: no port means this server is
 * not the desktop shell's child (`not_desktop`), an unanswered hello a shell too old to host
 * the browser (`shell_unsupported`), and an open nobody claims no window to put the tab in
 * (`no_window`). Tabs themselves are created by the Web App — a <webview> is an element of its
 * page — so opening one is a request published to the admins' windows, answered by a claim.
 *
 * Every agent action names a tab (`active` included), makes it the active one, and is
 * bracketed by `builtin_browser_activity` events so the window can show the agent at work.
 */
import type {
  BuiltinBrowserAction,
  BuiltinBrowserExecResult,
  BuiltinBrowserHistoryEntry,
  BuiltinBrowserImportRequest,
  BuiltinBrowserImportResult,
  BuiltinBrowserImportSource,
  BuiltinBrowserScanResult,
  BuiltinBrowserScreenshot,
  BuiltinBrowserServerEvent,
  BuiltinBrowserStatus,
  BuiltinBrowserTab,
  BuiltinBrowserTabsResponse,
  BuiltinBrowserUnavailableReason,
  DesktopBrowserEvent,
} from "../api/types.js";
import { HttpError } from "../http/errors.js";
import { BrowserActions, DEFAULT_ACTION_TIMING } from "./actions.js";
import type { ActionTiming } from "./actions.js";
import { BrowserDriver, mapLinkError } from "./driver.js";
import { HistoryStore, historyFile, isWebUrl } from "./history.js";
import { listImportSources, readCookies, readHistory } from "./import/index.js";
import { ShellLink, parseTab } from "./shell-link.js";
import type { BrowserShellPort, ShellLinkTiming } from "./shell-link.js";
import { TabRegistry } from "./tabs.js";
import type { OpenRequest } from "./tabs.js";

export interface BrowserTiming extends ShellLinkTiming, ActionTiming {
  /** How long an opened tab has to be claimed by a window. */
  openClaimMs: number;
  /** How long a closed tab has to disappear. */
  closeWaitMs: number;
  /** The shell's tab list after a handshake. */
  tabsTimeoutMs: number;
  /** Tab events within this window reach the admins as one `builtin_browser_tabs`. */
  publishDelayMs: number;
}

/** The most tabs the browser holds; an agent's new tab beyond them is refused. */
export const MAX_TABS = 30;
/** A page may open this many tabs (popups, target=_blank) in any POPUP_WINDOW_MS; more are dropped. */
const POPUP_LIMIT = 3;
const POPUP_WINDOW_MS = 5_000;

const DEFAULT_TIMING: Pick<
  BrowserTiming,
  "openClaimMs" | "closeWaitMs" | "tabsTimeoutMs" | "publishDelayMs"
> = {
  openClaimMs: 15_000,
  closeWaitMs: 5_000,
  tabsTimeoutMs: 5_000,
  publishDelayMs: 30,
};

/** The system-browser importer (./import), injectable for tests. */
export interface Importer {
  listImportSources: typeof listImportSources;
  readCookies: typeof readCookies;
  readHistory: typeof readHistory;
}

const UNAVAILABLE: Record<BuiltinBrowserUnavailableReason, string> = {
  not_desktop:
    "The built-in browser needs the PenguinHarness desktop app, and this server is not running inside it.",
  shell_unsupported:
    "This installation of the desktop app is too old to host the built-in browser; update the app.",
  no_window: "No PenguinHarness window took the tab; open the app window and try again.",
};

/** 503 `browser_unavailable`, with the reason the routes put beside the code. */
export class BrowserUnavailableError extends HttpError {
  constructor(readonly reason: BuiltinBrowserUnavailableReason) {
    super(503, "browser_unavailable", UNAVAILABLE[reason]);
  }
}

function invalidUrl(url: unknown): HttpError {
  return new HttpError(
    400,
    "invalid_url",
    `${JSON.stringify(url)} is not a web address the browser can open (http, https, or about:blank).`,
  );
}

/**
 * The page a tab opens or navigates to: a web URL or about:blank. A bare host gets a scheme —
 * https, or http for this machine's own servers — as an address bar would give it.
 */
export function browserUrl(raw: unknown, blankWhenEmpty: boolean): string {
  if (raw === undefined || raw === null || raw === "") {
    if (blankWhenEmpty) return "about:blank";
    throw invalidUrl(raw);
  }
  if (typeof raw !== "string") throw invalidUrl(raw);
  const text = raw.trim();
  if (text.toLowerCase() === "about:blank") return "about:blank";
  // `name:` followed by a digit is a host and port (`localhost:5173`), anything else a scheme.
  const scheme = /^([a-z][a-z0-9+.-]*):(?!\d)/i.exec(text)?.[1]?.toLowerCase();
  if (scheme !== undefined && scheme !== "http" && scheme !== "https") throw invalidUrl(raw);
  const withScheme =
    scheme !== undefined
      ? text
      : /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(text)
        ? `http://${text}`
        : `https://${text}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw invalidUrl(raw);
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.hostname === "") {
    throw invalidUrl(raw);
  }
  return url.toString();
}

export interface BuiltinBrowserDeps {
  /** The shell's message port; null when this server is not the desktop shell's child. */
  port: BrowserShellPort | null;
  /** The data root; the history lives under it. */
  root: string;
  /** Sends one event to every admin's user channel. */
  publish(event: BuiltinBrowserServerEvent): void;
  log(line: string): void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  importer?: Importer;
  timing?: Partial<BrowserTiming>;
}

interface Connected {
  link: ShellLink;
  driver: BrowserDriver;
  actions: BrowserActions;
}

export class BuiltinBrowser {
  readonly tabs: TabRegistry;
  readonly history: HistoryStore;
  private readonly connected: Connected | null;
  private readonly timing: typeof DEFAULT_TIMING;
  /** How long an opened web page gets to load before POST /tabs answers. */
  private readonly loadWaitMs: number;
  private readonly importer: Importer;
  /** Agent actions in flight per tab, and the session the latest one came from. */
  private readonly inflight = new Map<number, { count: number; sessionId?: string }>();
  /** Per opener tab, when its recent popups were let through (see `openFromPage`). */
  private readonly popups = new Map<number, number[]>();
  private readonly now: () => number;
  private publishTimer: NodeJS.Timeout | null = null;
  private disposed = false;

  constructor(private readonly deps: BuiltinBrowserDeps) {
    const now = deps.now ?? Date.now;
    this.now = now;
    this.timing = { ...DEFAULT_TIMING, ...deps.timing };
    this.loadWaitMs = deps.timing?.loadWaitMs ?? DEFAULT_ACTION_TIMING.loadWaitMs;
    this.importer = deps.importer ?? { listImportSources, readCookies, readHistory };
    this.tabs = new TabRegistry(now);
    this.history = new HistoryStore(historyFile(deps.root), { now, log: deps.log });
    if (deps.port === null) {
      this.connected = null;
      return;
    }
    const link = new ShellLink(deps.port, deps.timing, now);
    const driver = new BrowserDriver(link, { now, ...(deps.sleep ? { sleep: deps.sleep } : {}) });
    const actions = new BrowserActions({
      driver,
      tabs: this.tabs,
      now,
      ...(deps.sleep ? { sleep: deps.sleep } : {}),
      ...(deps.timing ? { timing: deps.timing } : {}),
    });
    this.connected = { link, driver, actions };
    link.onEvent((event) => this.onShellEvent(event));
    link.onConnect(() => this.refreshTabs());
  }

  // --- availability and tabs ------------------------------------------------

  /** GET /status: never an error — an unavailable browser says why. Retries a failed handshake. */
  async status(): Promise<BuiltinBrowserStatus> {
    const reason = await this.unavailability(true);
    return {
      available: reason === null,
      ...(reason !== null ? { reason } : {}),
      tabs: this.tabs.list(),
      activeTabId: this.tabs.activeTabId,
    };
  }

  /** GET /tabs. */
  async listTabs(): Promise<BuiltinBrowserTabsResponse> {
    await this.ready();
    return { tabs: this.tabs.list(), activeTabId: this.tabs.activeTabId };
  }

  /**
   * POST /tabs: asks the admins' windows for a tab, waits for one to claim it, and — for a web
   * page — for the page to load.
   */
  async openTab(opts: {
    url?: unknown;
    sessionId?: string;
    activate?: boolean;
  }): Promise<BuiltinBrowserTab> {
    const { driver } = await this.ready();
    const url = browserUrl(opts.url, true);
    if (this.tabsHeld() >= MAX_TABS) {
      throw new HttpError(
        409,
        "too_many_tabs",
        `The built-in browser holds ${MAX_TABS} tabs, the most it keeps; close some first (penguin browser close <tab-id>).`,
      );
    }
    const request = this.requestOpen({
      url,
      activate: opts.activate !== false,
      ...(opts.sessionId !== undefined ? { sessionId: opts.sessionId } : {}),
    });
    const tabId = await this.tabs.waitForClaim(request.requestId, this.timing.openClaimMs);
    if (tabId === null) throw new BrowserUnavailableError("no_window");
    if (!this.tabs.has(tabId)) await this.refreshTabs().catch(() => undefined);
    if (isWebUrl(url)) await driver.waitForLoad(tabId, this.loadWaitMs);
    return this.tabOrThrow(tabId);
  }

  /** POST /tabs/claim: the window that created a requested tab names it. */
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

  /** POST /tabs/:tab/activate: the user focused a tab, or the agent switched to one. */
  async activate(tab: string): Promise<BuiltinBrowserTab> {
    await this.ready();
    const tabId = this.resolve(tab);
    if (this.tabs.activate(tabId)) this.schedulePublish();
    return this.tabOrThrow(tabId);
  }

  /** DELETE /tabs/:tab: the window holding the tab removes it; this waits until it is gone. */
  async close(tab: string): Promise<void> {
    await this.ready();
    const tabId = this.resolve(tab);
    this.deps.publish({ type: "builtin_browser_close", tabId });
    if (!(await this.tabs.waitForClose(tabId, this.timing.closeWaitMs))) {
      throw new BrowserUnavailableError("no_window");
    }
  }

  // --- agent actions ----------------------------------------------------------

  /** POST /tabs/:tab/navigate. `active` with no tab open opens one. */
  async navigate(tab: string, rawUrl: unknown, sessionId?: string): Promise<BuiltinBrowserTab> {
    const url = browserUrl(rawUrl, false);
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
    return this.act(tab, "cdp", sessionId, (tabId, actions) => actions.cdp(tabId, method, params));
  }

  // --- import, history, data --------------------------------------------------

  listImportSources(): BuiltinBrowserImportSource[] {
    return this.importer.listImportSources();
  }

  /**
   * POST /import: cookies go into the browser's session through the shell, history into the
   * history file. With neither flag both are imported. `sourceId` may also name just a
   * browser (`chrome`), meaning its first profile.
   */
  async importFrom(req: BuiltinBrowserImportRequest): Promise<BuiltinBrowserImportResult> {
    const sources = this.importer.listImportSources();
    const source =
      sources.find((s) => s.id === req.sourceId) ?? sources.find((s) => s.browser === req.sourceId);
    if (source === undefined) {
      throw new HttpError(
        404,
        "source_not_found",
        `No browser profile '${req.sourceId}' was found on this machine.`,
      );
    }
    const both = req.cookies === undefined && req.history === undefined;
    const result: BuiltinBrowserImportResult = { sourceId: source.id, warnings: [] };
    if (both || req.cookies === true) {
      const { link } = await this.ready();
      let read: Awaited<ReturnType<Importer["readCookies"]>>;
      try {
        read = await this.importer.readCookies(source, {
          ...(req.domains !== undefined ? { domains: req.domains } : {}),
        });
      } catch (err) {
        throw new HttpError(
          422,
          "import_failed",
          `The cookies could not be read: ${messageOf(err)}`,
        );
      }
      let written = { set: 0, failed: 0, errors: [] as string[] };
      if (read.cookies.length > 0) {
        try {
          written = (await link.request(
            { op: "set-cookies", cookies: read.cookies },
            30_000 + read.cookies.length * 20,
          )) as typeof written;
        } catch (err) {
          throw mapLinkError(err, -1);
        }
      }
      result.cookies = {
        found: read.found,
        imported: written.set,
        skipped: read.skipped,
        failed: written.failed,
      };
      result.warnings.push(...read.warnings);
      if (written.failed > 0) {
        const named = written.errors.slice(0, 3).join("; ");
        result.warnings.push(
          `${written.failed} cookies could not be set in the browser${named !== "" ? `: ${named}` : "."}`,
        );
      }
    }
    if (both || req.history === true) {
      let read: Awaited<ReturnType<Importer["readHistory"]>>;
      try {
        read = await this.importer.readHistory(source);
      } catch (err) {
        throw new HttpError(
          422,
          "import_failed",
          `The history could not be read: ${messageOf(err)}`,
        );
      }
      result.history = { found: read.entries.length, imported: this.history.merge(read.entries) };
      result.warnings.push(...read.warnings);
    }
    return result;
  }

  searchHistory(query: string, limit: number): BuiltinBrowserHistoryEntry[] {
    return this.history.search(query, limit);
  }

  clearHistory(): void {
    this.history.clear();
  }

  /** POST /clear-data: the browser's cookies, cache or site storage. */
  async clearData(storages: ("cookies" | "cache" | "storage")[]): Promise<void> {
    const { link } = await this.ready();
    try {
      await link.request({ op: "clear-data", storages }, 60_000);
    } catch (err) {
      throw mapLinkError(err, -1);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.publishTimer !== null) clearTimeout(this.publishTimer);
    this.publishTimer = null;
    this.connected?.link.dispose();
    this.tabs.dispose();
    void this.history.dispose();
  }

  // --- internals ---------------------------------------------------------------

  private async unavailability(force: boolean): Promise<BuiltinBrowserUnavailableReason | null> {
    if (this.connected === null) return "not_desktop";
    return (await this.connected.link.handshake(force)) ? null : "shell_unsupported";
  }

  private async ready(): Promise<Connected> {
    const reason = await this.unavailability(false);
    if (reason !== null) throw new BrowserUnavailableError(reason);
    return this.connected!;
  }

  /** `active` or a tab id, to an open tab. */
  private resolve(tab: string): number {
    if (tab === "active") {
      const id = this.tabs.activeTabId;
      if (id === null)
        throw new HttpError(404, "no_tab", "No tab is open in the built-in browser.");
      return id;
    }
    const id = /^\d{1,15}$/.test(tab) ? Number(tab) : Number.NaN;
    if (!this.tabs.has(id)) {
      throw new HttpError(404, "no_such_tab", `Tab ${tab} is not open in the built-in browser.`);
    }
    return id;
  }

  private tabOrThrow(tabId: number): BuiltinBrowserTab {
    const tab = this.tabs.get(tabId);
    if (tab === undefined) {
      throw new HttpError(404, "no_such_tab", `Tab ${tabId} is not open in the built-in browser.`);
    }
    return tab;
  }

  /** One agent action on one tab: made active, announced busy while it runs. */
  private async act<T>(
    tab: string,
    action: BuiltinBrowserAction,
    sessionId: string | undefined,
    run: (tabId: number, actions: BrowserActions) => Promise<T>,
  ): Promise<T> {
    const { actions } = await this.ready();
    const tabId = this.resolve(tab);
    if (this.tabs.activate(tabId)) this.schedulePublish();
    this.activity(tabId, action, sessionId, 1);
    try {
      return await run(tabId, actions);
    } catch (err) {
      // The shell no longer has it: the registry catches up rather than waiting for the event.
      if (err instanceof HttpError && err.code === "no_such_tab" && this.tabs.remove(tabId)) {
        this.schedulePublish();
      }
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
   * A popup, or "Open link in new tab". The session of an action running in the opener is the
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

  private onShellEvent(event: DesktopBrowserEvent): void {
    switch (event.kind) {
      case "tab":
        this.history.observe(this.tabs.upsert(event.tab), event.tab);
        this.schedulePublish();
        break;
      case "tab-closed":
        if (this.tabs.remove(event.tabId)) this.schedulePublish();
        this.inflight.delete(event.tabId);
        this.popups.delete(event.tabId);
        break;
      case "open-request":
        if (isWebUrl(event.url)) this.openFromPage(event);
        break;
      case "cdp-event":
        // An action's own subscription (driver.onCdpEvent); nothing for the registry.
        break;
    }
    // An event proves the shell speaks the protocol. A link that has not shaken hands yet (a
    // server that started under a running window) does it now, and learns the other tabs.
    if (this.connected !== null && !this.connected.link.connected) {
      void this.connected.link.handshake(true);
    }
  }

  private async refreshTabs(): Promise<void> {
    if (this.connected === null) return;
    const answer = (await this.connected.link.request(
      { op: "tabs" },
      this.timing.tabsTimeoutMs,
    )) as {
      tabs?: unknown;
    } | null;
    const tabs = Array.isArray(answer?.tabs)
      ? answer.tabs.map(parseTab).filter((tab): tab is BuiltinBrowserTab => tab !== null)
      : [];
    if (this.tabs.replaceAll(tabs)) this.schedulePublish();
  }

  private schedulePublish(): void {
    if (this.publishTimer !== null || this.disposed) return;
    this.publishTimer = setTimeout(() => {
      this.publishTimer = null;
      if (this.disposed) return;
      this.deps.publish({
        type: "builtin_browser_tabs",
        tabs: this.tabs.list(),
        activeTabId: this.tabs.activeTabId,
      });
    }, this.timing.publishDelayMs);
  }
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));
