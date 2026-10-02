/**
 * The agent browser as the routes drive it: one object per platform generation that owns the
 * backends — the desktop's built-in browser (a runtime over the shell link, when this server is
 * the shell's child) and the users' own Chromes (the extension hub) — plus the built-in
 * browser's history, settings and import.
 *
 * Every call names an actor, and the actor's backend decides which runtime answers it: the
 * backend the user chose (`ui_prefs.browserBackend`, through PUT /backend), else built-in for an
 * admin on the desktop and chrome everywhere else. A server with no shell offers only chrome. No
 * call ever falls back from one backend to the other: an unavailable backend says why.
 *
 * - Built-in: admins only (the desktop window and the agents' admin token). Availability comes
 *   first: no port means this server is not the shell's child (`not_desktop`), an unanswered
 *   hello a shell too old to host the browser (`shell_unsupported`), and an open nobody claims
 *   no window to put the tab in (`no_window`).
 * - Chrome: any signed-in user, their own Chrome only, unless the admin switched it off
 *   (`extension_disabled`). No paired extension is `extension_not_paired`, a paired one not
 *   connected now `extension_disconnected`.
 *
 * Import, history and clearing data belong to the built-in browser: on chrome they answer 405
 * `not_supported` (Chrome keeps its own).
 */
import type {
  BrowserBackend,
  BrowserBackendInfo,
  BrowserBackendResponse,
  BuiltinBrowserExecResult,
  BuiltinBrowserHistoryEntry,
  BuiltinBrowserImportRequest,
  BuiltinBrowserImportResult,
  BuiltinBrowserImportSource,
  BuiltinBrowserScanResult,
  BuiltinBrowserScreenshot,
  BuiltinBrowserServerEvent,
  BuiltinBrowserSettings,
  BuiltinBrowserStatus,
  BuiltinBrowserTab,
  BuiltinBrowserTabsResponse,
} from "../api/types.js";
import type { BrowserExtensionStore } from "../db/repos/browser-extensions.js";
import { HttpError } from "../http/errors.js";
import { BrowserBackendRuntime } from "./backend-runtime.js";
import type { BrowserTiming } from "./backend-runtime.js";
import { ExtensionHub } from "./extension-hub.js";
import type { BrowserExtensionAdmission } from "./extension-hub.js";
import type { ExtensionLinkTiming, ExtensionSocket } from "./extension-link.js";
import { HistoryStore, historyFile, isWebUrl } from "./history.js";
import { listImportSources, readCookies, readHistory } from "./import/index.js";
import { BrowserUnavailableError } from "./link.js";
import { SettingsStore, settingsFile } from "./settings.js";
import { ShellLink } from "./shell-link.js";
import type { BrowserShellPort } from "./shell-link.js";
import { TabRegistry } from "./tabs.js";

export { BrowserUnavailableError } from "./link.js";
export { MAX_TABS } from "./backend-runtime.js";
export type { BrowserTiming } from "./backend-runtime.js";

/** The system-browser importer (./import), injectable for tests. */
export interface Importer {
  listImportSources: typeof listImportSources;
  readCookies: typeof readCookies;
  readHistory: typeof readHistory;
}

/** Who a call acts for: the signed-in user, or the human an agent's call is attributed to. */
export interface Actor {
  userId: string;
  isAdmin: boolean;
}

/** The users' backend choice (ui_prefs.browserBackend). */
export interface BackendPrefs {
  get(userId: string): BrowserBackend | null;
  set(userId: string, backend: BrowserBackend): void;
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

const adminRequired = () =>
  new HttpError(403, "admin_required", "The built-in browser is for admins only.");

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

export interface BuiltinBrowserDeps {
  /** The shell's message port; null when this server is not the desktop shell's child. */
  port: BrowserShellPort | null;
  /** The data root; the history and the settings live under it. */
  root: string;
  /** Sends one built-in browser event to every admin's user channel. */
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
  /** The chrome backend; absent, this server offers only the built-in browser. */
  chrome?: {
    store: BrowserExtensionStore;
    /** The admin's switch. */
    enabled(): boolean;
    /** Sends one event to one user's channel. */
    publishTo(userId: string, event: BuiltinBrowserServerEvent): void;
    linkTiming?: Partial<ExtensionLinkTiming>;
  };
  /** The users' backend choice; absent, nobody can switch. */
  prefs?: BackendPrefs;
}

export class BuiltinBrowser {
  readonly history: HistoryStore;
  readonly settings: SettingsStore;
  /** The chrome backend: every user's extension; null on a server that offers none. */
  readonly extensions: ExtensionHub | null;
  /** The built-in browser; null when this server is not the desktop shell's child. */
  private readonly builtin: BrowserBackendRuntime | null;
  /** What `tabs` answers on a server without the built-in browser. */
  private readonly noTabs: TabRegistry;
  private readonly importer: Importer;
  private disposed = false;

  constructor(private readonly deps: BuiltinBrowserDeps) {
    const now = deps.now ?? Date.now;
    this.importer = deps.importer ?? { listImportSources, readCookies, readHistory };
    this.noTabs = new TabRegistry(now);
    this.history = new HistoryStore(historyFile(deps.root), { now, log: deps.log });
    this.settings = new SettingsStore(settingsFile(deps.root), deps.log);
    const shared = {
      log: deps.log,
      homepage: async () => (await this.settings.read()).homepage,
      url: browserUrl,
      now,
      ...(deps.sleep ? { sleep: deps.sleep } : {}),
      ...(deps.timing ? { timing: deps.timing } : {}),
    };
    this.builtin =
      deps.port === null
        ? null
        : new BrowserBackendRuntime({
            ...shared,
            link: new ShellLink(deps.port, deps.timing, now, deps.log),
            publish: deps.publish,
            history: this.history,
            ...(deps.systemMemory ? { systemMemory: deps.systemMemory } : {}),
            ...(deps.platform !== undefined ? { platform: deps.platform } : {}),
          });
    const chrome = deps.chrome;
    this.extensions =
      chrome === undefined
        ? null
        : new ExtensionHub({
            store: chrome.store,
            enabled: () => chrome.enabled(),
            publish: (userId, event) => chrome.publishTo(userId, event),
            runtime: shared,
            ...(chrome.linkTiming ? { linkTiming: chrome.linkTiming } : {}),
            log: deps.log,
            now,
          });
  }

  /** The built-in browser's tab registry (an empty one on a server without it). */
  get tabs(): TabRegistry {
    return this.builtin?.tabs ?? this.noTabs;
  }

  // --- backends ------------------------------------------------------------------

  /** The backends the actor may choose: built-in for an admin on the desktop, chrome where offered. */
  choices(actor: Actor): BrowserBackend[] {
    const choices: BrowserBackend[] = [];
    if (this.builtin !== null && actor.isAdmin) choices.push("builtin");
    if (this.extensions !== null) choices.push("chrome");
    return choices;
  }

  /** The backend the actor's calls go to; see the module doc. */
  backendOf(actor: Actor): BrowserBackend {
    if (this.builtin === null) return this.extensions !== null ? "chrome" : "builtin";
    if (this.extensions === null) return "builtin";
    const chosen = this.deps.prefs?.get(actor.userId) ?? null;
    if (chosen !== null) return chosen;
    return actor.isAdmin ? "builtin" : "chrome";
  }

  /** GET /backend. */
  backendChoice(actor: Actor): BrowserBackendResponse {
    return { backend: this.backendOf(actor), choices: this.choices(actor) };
  }

  /**
   * PUT /backend: the user's choice, stored and announced to their windows. Refused while an
   * agent acts in the backend being left, and for a backend the actor may not choose.
   */
  setBackend(actor: Actor, backend: BrowserBackend): BrowserBackendResponse {
    if (!this.choices(actor).includes(backend) || this.deps.prefs === undefined) {
      if (backend === "builtin" && this.builtin !== null && !actor.isAdmin) throw adminRequired();
      throw new HttpError(
        405,
        "not_supported",
        backend === "builtin"
          ? "This server has no built-in browser; it runs outside the PenguinHarness desktop app."
          : "This server does not offer driving your own Chrome.",
      );
    }
    const current = this.backendOf(actor);
    if (backend !== current) {
      if (this.runtimeOf(actor.userId, current)?.busy === true) {
        throw new HttpError(
          409,
          "action_in_flight",
          "An agent is acting in the browser right now; switch once it is done.",
        );
      }
      this.deps.prefs.set(actor.userId, backend);
      this.deps.chrome?.publishTo(actor.userId, { type: "builtin_browser_backend", backend });
    }
    return this.backendChoice(actor);
  }

  /** GET /status: never 503 — an unavailable backend says why. Retries a failed shell handshake. */
  async status(actor: Actor): Promise<BuiltinBrowserStatus> {
    const backend = this.backendOf(actor);
    if (backend === "builtin" && this.builtin !== null && !actor.isAdmin) throw adminRequired();
    const backends: BrowserBackendInfo[] = [];
    if (this.builtin === null && this.extensions === null) {
      backends.push({ backend: "builtin", available: false, reason: "not_desktop" });
    }
    if (this.builtin !== null && actor.isAdmin) {
      const reason = await this.builtin.unavailability(true);
      backends.push({
        backend: "builtin",
        available: reason === null,
        ...(reason ? { reason } : {}),
      });
    }
    if (this.extensions !== null) backends.push(this.extensions.info(actor.userId));
    const current = backends.find((info) => info.backend === backend);
    const runtime = this.runtimeOf(actor.userId, backend);
    const metrics = runtime?.metrics ?? null;
    return {
      available: current?.available === true,
      ...(current?.reason !== undefined ? { reason: current.reason } : {}),
      backend,
      backends,
      tabs: runtime?.tabs.list() ?? [],
      activeTabId: runtime?.tabs.activeTabId ?? null,
      ...(metrics !== null ? { metrics } : {}),
    };
  }

  // --- tabs and the agent's actions, on the actor's backend -----------------------

  /** GET /tabs. */
  listTabs(actor: Actor): Promise<BuiltinBrowserTabsResponse> {
    return this.runtime(actor).listTabs();
  }

  /** POST /tabs. */
  openTab(
    actor: Actor,
    opts: { url?: unknown; sessionId?: string; activate?: boolean },
  ): Promise<BuiltinBrowserTab> {
    return this.runtime(actor).openTab(opts);
  }

  /** POST /tabs/claim: a built-in browser window names the <webview> it created. */
  claim(actor: Actor, requestId: string, tabId: number): Promise<void> {
    return this.builtinRuntime(actor).claim(requestId, tabId);
  }

  /** POST /tabs/:tab/activate. */
  activate(actor: Actor, tab: string): Promise<BuiltinBrowserTab> {
    return this.runtime(actor).activate(tab);
  }

  /** POST /tabs/on-screen: the built-in browser's tab a window shows; nothing to do elsewhere. */
  setOnScreen(actor: Actor, tabId: number | null): void {
    if (this.builtin !== null && actor.isAdmin) this.builtin.setOnScreen(tabId);
  }

  /** DELETE /tabs/:tab. */
  close(actor: Actor, tab: string): Promise<void> {
    return this.runtime(actor).close(tab);
  }

  navigate(
    actor: Actor,
    tab: string,
    url: unknown,
    sessionId?: string,
  ): Promise<BuiltinBrowserTab> {
    return this.runtime(actor).navigate(tab, url, sessionId);
  }

  scan(
    actor: Actor,
    tab: string,
    opts: { textOnly?: boolean; maxChars?: number; instruction?: string },
    sessionId?: string,
  ): Promise<BuiltinBrowserScanResult> {
    return this.runtime(actor).scan(tab, opts, sessionId);
  }

  exec(
    actor: Actor,
    tab: string,
    script: string,
    opts: { noMonitor?: boolean; timeoutMs?: number; acceptDialogs?: boolean },
    sessionId?: string,
  ): Promise<BuiltinBrowserExecResult> {
    return this.runtime(actor).exec(tab, script, opts, sessionId);
  }

  click(
    actor: Actor,
    tab: string,
    target: { selector: string; index?: number } | { x: number; y: number },
    opts: { acceptDialogs?: boolean },
    sessionId?: string,
  ): Promise<BuiltinBrowserExecResult> {
    return this.runtime(actor).click(tab, target, opts, sessionId);
  }

  type(
    actor: Actor,
    tab: string,
    opts: { text: string; selector?: string; submit?: boolean; acceptDialogs?: boolean },
    sessionId?: string,
  ): Promise<BuiltinBrowserExecResult> {
    return this.runtime(actor).type(tab, opts, sessionId);
  }

  screenshot(
    actor: Actor,
    tab: string,
    opts: { fullPage?: boolean },
    sessionId?: string,
  ): Promise<BuiltinBrowserScreenshot> {
    return this.runtime(actor).screenshot(tab, opts, sessionId);
  }

  cdp(
    actor: Actor,
    tab: string,
    method: string,
    params: Record<string, unknown> | undefined,
    sessionId?: string,
  ): Promise<unknown> {
    return this.runtime(actor).cdp(tab, method, params, sessionId);
  }

  // --- the extension socket (extension-ws.ts) ------------------------------------

  /** What a presented extension token may do; `unknown` on a server that offers no chrome. */
  admit(token: string): BrowserExtensionAdmission {
    return this.extensions?.admit(token) ?? "unknown";
  }

  connect(token: string, socket: ExtensionSocket): void {
    if (this.extensions !== null) this.extensions.connect(token, socket);
    else socket.close(4009, "disabled");
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

  // --- the built-in browser's import, history, data -------------------------------

  listImportSources(actor: Actor): BuiltinBrowserImportSource[] {
    this.builtinOnly(actor, "Importing from another browser");
    return this.importer.listImportSources();
  }

  /**
   * POST /import: cookies go into the browser's session through the shell, history into the
   * history file. With neither flag both are imported. `sourceId` may also name just a
   * browser (`chrome`), meaning its first profile.
   */
  async importFrom(
    actor: Actor,
    req: BuiltinBrowserImportRequest,
  ): Promise<BuiltinBrowserImportResult> {
    this.builtinOnly(actor, "Importing from another browser");
    const sources = this.importer.listImportSources();
    const source =
      sources.find((s) => s.id === req.sourceId) ?? sources.find((s) => s.browser === req.sourceId);
    if (source === undefined) throw sourceNotFound(req.sourceId);
    const both = req.cookies === undefined && req.history === undefined;
    const result: BuiltinBrowserImportResult = { sourceId: source.id, warnings: [] };
    if (both || req.cookies === true) {
      const runtime = this.shellRuntime();
      await runtime.ready();
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
        written = (await runtime.request(
          { op: "set-cookies", cookies: read.cookies },
          30_000 + read.cookies.length * 20,
        )) as typeof written;
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

  searchHistory(actor: Actor, query: string, limit: number): BuiltinBrowserHistoryEntry[] {
    this.builtinOnly(actor, "The browsing history");
    return this.history.search(query, limit);
  }

  clearHistory(actor: Actor): void {
    this.builtinOnly(actor, "The browsing history");
    this.history.clear();
  }

  /** POST /clear-data: the browser's cookies, cache or site storage. */
  async clearData(actor: Actor, storages: ("cookies" | "cache" | "storage")[]): Promise<void> {
    this.builtinOnly(actor, "Clearing the browser's data");
    await this.shellRuntime().request({ op: "clear-data", storages }, 60_000);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.builtin?.dispose();
    this.extensions?.dispose();
    this.noTabs.dispose();
    void this.history.dispose();
  }

  // --- internals ---------------------------------------------------------------

  /** The runtime of `backend` for `userId`, when there is one (no checks). */
  private runtimeOf(userId: string, backend: BrowserBackend): BrowserBackendRuntime | null {
    return backend === "builtin" ? this.builtin : (this.extensions?.runtimeFor(userId) ?? null);
  }

  /** The actor's backend's runtime, or why it cannot be driven (503 with the reason, 403). */
  private runtime(actor: Actor): BrowserBackendRuntime {
    const backend = this.backendOf(actor);
    if (backend === "builtin") return this.builtinRuntime(actor);
    const hub = this.extensions;
    if (hub === null) throw new BrowserUnavailableError("not_desktop");
    const reason = hub.unavailability(actor.userId);
    if (reason === "extension_disabled" || reason === "extension_not_paired") {
      throw new BrowserUnavailableError(reason);
    }
    const runtime = hub.runtimeFor(actor.userId);
    if (runtime === null) throw new BrowserUnavailableError("extension_disconnected");
    return runtime;
  }

  /** The built-in browser, for an admin. */
  private builtinRuntime(actor: Actor): BrowserBackendRuntime {
    if (this.builtin === null) throw new BrowserUnavailableError("not_desktop");
    if (!actor.isAdmin) throw adminRequired();
    return this.builtin;
  }

  /** The built-in browser's shell, for what only it holds (the cookie store). */
  private shellRuntime(): BrowserBackendRuntime {
    if (this.builtin === null) throw new BrowserUnavailableError("not_desktop");
    return this.builtin;
  }

  /** What only the built-in browser has: refused on chrome (405), and to a non-admin (403). */
  private builtinOnly(actor: Actor, what: string): void {
    if (this.backendOf(actor) === "chrome") {
      throw new HttpError(
        405,
        "not_supported",
        `${what} belongs to the built-in browser; your agents drive your own Chrome here, which keeps its own.`,
      );
    }
    if (!actor.isAdmin) throw adminRequired();
  }
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));
