/**
 * The built-in browser as the routes drive it: one object per platform generation that owns
 * the shell link, the tab registry, the driver and actions over them, the history, the
 * settings, and the events the admins' windows hear.
 *
 * Availability comes first on every call that needs the shell: no port means this server is
 * not the desktop shell's child (`not_desktop`), an unanswered hello a shell too old to host
 * the browser (`shell_unsupported`), and an open nobody claims no window to put the tab in
 * (`no_window`). Tabs themselves are created by the Web App — a <webview> is an element of its
 * page — so opening one is a request published to the admins' windows, answered by a claim.
 *
 * Every agent action names a tab (`active` included), makes it the active one, and is
 * bracketed by `builtin_browser_activity` events so the window can show the agent at work.
 *
 * Load: the shell measures its guests every ~10 s, and this turns each measurement into the
 * browser's `metrics` — the tabs' memory with the verdict of load.ts — for the status and the
 * windows. And it keeps the tabs nobody is looking at or driving cheap: every tab but the one a
 * window shows and those an agent acts in (and for a grace period after) may be throttled by the
 * shell while it is out of sight.
 */
import os from "node:os";
import type {
  BuiltinBrowserAction,
  BuiltinBrowserExecResult,
  BuiltinBrowserHistoryEntry,
  BuiltinBrowserImportRequest,
  BuiltinBrowserImportResult,
  BuiltinBrowserImportSource,
  BuiltinBrowserMetrics,
  BuiltinBrowserScanResult,
  BuiltinBrowserScreenshot,
  BuiltinBrowserServerEvent,
  BuiltinBrowserSettings,
  BuiltinBrowserStatus,
  BuiltinBrowserTab,
  BuiltinBrowserTabsResponse,
  BuiltinBrowserUnavailableReason,
  DesktopBrowserEvent,
} from "../api/types.js";
import { HttpError } from "../http/errors.js";
import { BrowserActions, DEFAULT_ACTION_TIMING } from "./actions.js";
import type { ActionTiming } from "./actions.js";
import { BrowserDriver, mapLinkError, tabCrashedError } from "./driver.js";
import { HistoryStore, historyFile, isWebUrl } from "./history.js";
import { listImportSources, readCookies, readHistory } from "./import/index.js";
import { assessLoad, systemMemory } from "./load.js";
import { SettingsStore, settingsFile } from "./settings.js";
import { ShellLink, ShellLinkError, parseTab } from "./shell-link.js";
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

const DEFAULT_TIMING: Pick<
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

/** No such profile on this machine, as the import routes answer it. */
function sourceNotFound(sourceId: string): HttpError {
  return new HttpError(
    404,
    "source_not_found",
    `No browser profile '${sourceId}' was found on this machine.`,
  );
}

/**
 * Why an import could not read a store: the profile gone since it was listed (the importer's
 * ImportSourceNotFoundError) is the same 404 as one never listed; anything else is 422.
 */
function importError(err: unknown, sourceId: string, what: "cookies" | "history"): HttpError {
  if ((err as { code?: unknown } | null)?.code === "source_not_found") {
    return sourceNotFound(sourceId);
  }
  return new HttpError(422, "import_failed", `The ${what} could not be read: ${messageOf(err)}`);
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

/**
 * A homepage as PUT /settings takes it: null for none, else a web page read by the rule above,
 * a bare host given its scheme. Never the blank page: that is what no homepage already opens.
 */
export function homepageUrl(raw: unknown): string | null {
  if (raw === null) return null;
  let url: string | null;
  try {
    url = browserUrl(raw, false);
  } catch {
    url = null;
  }
  if (url === null || !isWebUrl(url)) {
    throw new HttpError(
      400,
      "invalid_url",
      `${JSON.stringify(raw)} is not a web address a homepage can be (http or https).`,
    );
  }
  return url;
}

/**
 * What raw CDP may not do: reach other targets (`Target.*`: open, attach to or close pages the
 * browser does not know), or navigate the tab where the browser would not go. The shell guards
 * the page's own navigations only; one that CDP makes passes it, so `Page.navigate` gets the
 * address bar's rule here: a web page or about:blank.
 */
function checkRawCdp(method: string, params: Record<string, unknown> | undefined): void {
  if (method.startsWith("Target.")) {
    throw new HttpError(
      403,
      "cdp_refused",
      `${method} is not available through the built-in browser; open, switch and close tabs with penguin browser open, switch and close.`,
    );
  }
  if (method === "Page.navigate") browserUrl(params?.url, false);
}

export interface BuiltinBrowserDeps {
  /** The shell's message port; null when this server is not the desktop shell's child. */
  port: BrowserShellPort | null;
  /** The data root; the history and the settings live under it. */
  root: string;
  /** Sends one event to every admin's user channel. */
  publish(event: BuiltinBrowserServerEvent): void;
  log(line: string): void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  importer?: Importer;
  timing?: Partial<BrowserTiming>;
  /** This computer's memory, for the load warning (os.freemem / os.totalmem by default). */
  systemMemory?: () => { freeBytes: number; totalBytes: number };
  /** process.platform by default. */
  platform?: string;
}

interface Connected {
  link: ShellLink;
  driver: BrowserDriver;
  actions: BrowserActions;
}

export class BuiltinBrowser {
  readonly tabs: TabRegistry;
  readonly history: HistoryStore;
  readonly settings: SettingsStore;
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
  /** The last tab list the windows were sent, to skip sending the same one again. */
  private published: string | null = null;
  /** The shell's latest measurement with its verdict; null before the first. */
  private metrics: BuiltinBrowserMetrics | null = null;
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

  constructor(private readonly deps: BuiltinBrowserDeps) {
    const now = deps.now ?? Date.now;
    this.now = now;
    this.timing = { ...DEFAULT_TIMING, ...deps.timing };
    this.loadWaitMs = deps.timing?.loadWaitMs ?? DEFAULT_ACTION_TIMING.loadWaitMs;
    this.importer = deps.importer ?? { listImportSources, readCookies, readHistory };
    this.tabs = new TabRegistry(now);
    this.history = new HistoryStore(historyFile(deps.root), { now, log: deps.log });
    this.settings = new SettingsStore(settingsFile(deps.root), deps.log);
    if (deps.port === null) {
      this.connected = null;
      return;
    }
    const link = new ShellLink(deps.port, deps.timing, now, deps.log);
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
      ...(this.metrics !== null ? { metrics: this.metrics } : {}),
    };
  }

  /** GET /tabs. */
  async listTabs(): Promise<BuiltinBrowserTabsResponse> {
    await this.ready();
    return { tabs: this.tabs.list(), activeTabId: this.tabs.activeTabId };
  }

  /**
   * POST /tabs: asks the admins' windows for a tab — at the address given, else at the
   * homepage, else blank — waits for one to claim it, and, for a web page, for the page to load.
   */
  async openTab(opts: {
    url?: unknown;
    sessionId?: string;
    activate?: boolean;
  }): Promise<BuiltinBrowserTab> {
    const { driver } = await this.ready();
    const url = await this.newTabUrl(opts.url);
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
    // The agent's (or the panel's) new tab: its grace runs from now, as after an action.
    this.actedAt.set(tabId, this.now());
    this.syncThrottle();
    if (isWebUrl(url)) {
      // A window claims the tab as soon as it exists, on its initial empty document, which reads
      // as loaded: the page asked for is waited for once it has committed.
      const deadline = this.now() + this.loadWaitMs;
      await this.tabs.waitForFirstPage(tabId, this.loadWaitMs);
      await driver.waitForLoad(tabId, Math.max(0, deadline - this.now()));
    }
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

  /**
   * POST /tabs/on-screen: the tab a window shows now, or none (its panel closed, the window
   * hidden). That tab is left at full speed; the one it replaces may be throttled.
   */
  setOnScreen(tabId: number | null): void {
    this.onScreen = tabId;
    this.syncThrottle();
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
    checkRawCdp(method, params);
    return this.act(tab, "cdp", sessionId, (tabId, actions) => actions.cdp(tabId, method, params));
  }

  // --- settings ----------------------------------------------------------------

  /** GET /settings: the server's own file, so it needs no shell. */
  getSettings(): Promise<BuiltinBrowserSettings> {
    return this.settings.read();
  }

  /** PUT /settings: the homepage as a web address (a bare host gets a scheme), or null for none. */
  async updateSettings(update: { homepage: unknown }): Promise<BuiltinBrowserSettings> {
    return this.settings.write({ homepage: homepageUrl(update.homepage) });
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
    if (source === undefined) throw sourceNotFound(req.sourceId);
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
        throw importError(err, source.id, "cookies");
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
        throw importError(err, source.id, "history");
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
    if (this.throttleTimer !== null) clearTimeout(this.throttleTimer);
    this.throttleTimer = null;
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

  /** The page a new tab opens: the address it was given, else the homepage, else the blank page. */
  private async newTabUrl(raw: unknown): Promise<string> {
    if (raw !== undefined && raw !== null && raw !== "") return browserUrl(raw, false);
    return (await this.settings.read()).homepage ?? "about:blank";
  }

  /**
   * One agent action on one tab: made active, running unthrottled and announced busy while it
   * runs. A tab whose page crashed answers `tab_crashed` at once, and so does an action whose
   * page crashed under it, whatever error that left behind.
   */
  private async act<T>(
    tab: string,
    action: BuiltinBrowserAction,
    sessionId: string | undefined,
    run: (tabId: number, actions: BrowserActions) => Promise<T>,
  ): Promise<T> {
    const { actions } = await this.ready();
    const tabId = this.resolve(tab);
    const crashed = this.tabs.get(tabId)?.crashed;
    if (crashed !== undefined) throw tabCrashedError(tabId, crashed);
    if (this.tabs.activate(tabId)) this.schedulePublish();
    this.activity(tabId, action, sessionId, 1);
    try {
      return await run(tabId, actions);
    } catch (err) {
      // The shell no longer has it: the registry catches up rather than waiting for the event.
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

  /** One shell event. Never throws: a failure is logged, and the next event starts clean. */
  private onShellEvent(event: DesktopBrowserEvent): void {
    try {
      this.applyShellEvent(event);
    } catch (err) {
      this.deps.log(`builtin browser: the shell's '${event.kind}' event failed: ${messageOf(err)}`);
    }
  }

  private applyShellEvent(event: DesktopBrowserEvent): void {
    switch (event.kind) {
      case "tab": {
        const previous = this.tabs.upsert(event.tab);
        if (previous === undefined) {
          // A new tab loads at full speed for the grace period, whoever opened it.
          if (!this.actedAt.has(event.tab.id)) this.actedAt.set(event.tab.id, this.now());
          this.syncThrottle();
        }
        this.history.observe(previous, event.tab);
        this.schedulePublish();
        break;
      }
      case "tab-closed":
        if (this.tabs.remove(event.tabId)) this.schedulePublish();
        this.inflight.delete(event.tabId);
        this.popups.delete(event.tabId);
        this.actedAt.delete(event.tabId);
        this.syncThrottle();
        break;
      case "tab-crashed":
        this.deps.log(
          `builtin browser: tab ${event.tabId}'s page crashed (${event.reason}, exit code ${event.exitCode})`,
        );
        if (this.tabs.markCrashed(event.tabId, event.reason)) this.schedulePublish();
        break;
      case "metrics":
        this.measure(event.tabs, event.totalKB);
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
    this.metrics = assessLoad(
      {
        at: this.now(),
        tabs: measured.filter((tab) => open.has(tab.tabId)),
        totalKB,
        ...(system !== undefined ? { system } : {}),
        tabCount: open.size,
      },
      this.metrics?.warnings ?? [],
    );
    this.deps.publish({ type: "builtin_browser_metrics", metrics: this.metrics });
  }

  /**
   * Tells the shell which tabs may be throttled while out of sight: every open tab but the one on
   * screen and those an agent is acting in or acted in within the grace period (new tabs
   * included). Sent only when the list changes, and re-checked when the earliest grace runs out.
   * A shell too old for the command leaves every tab at full speed, as before.
   */
  private syncThrottle(): void {
    const link = this.connected?.link;
    if (link === undefined || !link.connected || this.throttleUnsupported || this.disposed) return;
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
          err instanceof ShellLinkError &&
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
        this.deps.log(`builtin browser: the tab list could not be sent: ${messageOf(err)}`);
      }
    }, this.timing.publishDelayMs);
  }
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));
