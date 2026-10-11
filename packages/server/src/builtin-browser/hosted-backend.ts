/**
 * The hosted backend, assembled: the link to the server's own Chrome, the backend runtime over
 * it, and the views of its tabs. One per platform generation, shared by the admins — it browses
 * from the server's place on the network, as the built-in browser does from the desktop's.
 *
 * What the facade (service.ts) asks of it beside the runtime:
 *
 * - Which Chrome there is (`chromePath`): the admin's setting, else what the machine has. The
 *   answer decides an admin's default backend on every call, so it is looked up at most once
 *   every few seconds; the status and a launch look afresh.
 * - What to say in the status (`info`), without starting anything: the Chrome found, whether it
 *   runs, and the last launch's failure for as long as the same Chrome is the one found.
 * - The tab list without a launch: a Chrome that is not running has no tabs.
 * - A tab's view, for the picture and the input routes.
 */
import fs from "node:fs";
import path from "node:path";
import type {
  BrowserBackendInfo,
  BuiltinBrowserServerEvent,
  BuiltinBrowserTabsResponse,
  HostedBrowserInputRequest,
  HostedBrowserViewport,
} from "../api/types.js";
import { HttpError } from "../http/errors.js";
import { BrowserBackendRuntime } from "./backend-runtime.js";
import type { BackendRuntimeDeps } from "./backend-runtime.js";
import { mapLinkError } from "./driver.js";
import { hostedProfileDir } from "./hosted-chrome.js";
import type { ChromeHost } from "./hosted-chrome.js";
import { HostedLink } from "./hosted-link.js";
import type { HostedLinkTiming } from "./hosted-link.js";
import { TabView } from "./hosted-view.js";
import type { TabViewOptions } from "./hosted-view.js";
import { BrowserUnavailableError, browserLabel } from "./link.js";
import type { SettingsStore } from "./settings.js";

/** How long a lookup of this machine's Chrome is answered from the last one. */
const FIND_TTL_MS = 5_000;

/** The Chrome to launch as PUT /settings takes it: the absolute path of a file on this machine, or null for none. */
export function chromePathSetting(raw: unknown): string | null {
  if (raw === null) return null;
  const isFile = (file: string): boolean => {
    try {
      return fs.statSync(file).isFile();
    } catch {
      return false;
    }
  };
  if (typeof raw !== "string" || raw.length > 1024 || !path.isAbsolute(raw) || !isFile(raw)) {
    throw new HttpError(
      400,
      "invalid_path",
      `${JSON.stringify(raw)} is not the absolute path of a file on the server's machine.`,
    );
  }
  return raw;
}

export interface HostedBackendDeps {
  /** The data root; Chrome's profile lives under it. */
  root: string;
  host: ChromeHost;
  /** The browser's settings, for the Chrome path an admin set. */
  settings: SettingsStore;
  /** What every runtime shares: the homepage, the address check, timing, the log. */
  runtime: Omit<BackendRuntimeDeps, "link" | "publish" | "history">;
  /** The admins' channels. */
  publish(event: BuiltinBrowserServerEvent): void;
  log(line: string): void;
  now?: () => number;
  linkTiming?: Partial<HostedLinkTiming>;
  view?: TabViewOptions;
}

export class HostedBackend {
  readonly link: HostedLink;
  readonly runtime: BrowserBackendRuntime;
  private readonly views = new Map<number, TabView>();
  private readonly now: () => number;
  private found: { path: string | null; at: number } | null = null;

  constructor(private readonly deps: HostedBackendDeps) {
    this.now = deps.now ?? Date.now;
    const profileDir = hostedProfileDir(deps.root);
    this.link = new HostedLink({
      chrome: () => this.chromePath(true),
      launch: (chromePath) => deps.host.launch(chromePath, profileDir),
      log: deps.log,
      ...(deps.linkTiming ? { timing: deps.linkTiming } : {}),
    });
    this.runtime = new BrowserBackendRuntime({
      ...deps.runtime,
      link: this.link,
      publish: deps.publish,
    });
    this.link.onEvent((event) => {
      if (event.kind !== "tab-closed") return;
      this.views.get(event.tabId)?.end();
      this.views.delete(event.tabId);
    });
    // Chrome exited: its tabs went with it, and so does everything that showed them.
    this.link.onDisconnect(() => {
      this.endViews();
      this.runtime.reset();
    });
  }

  /** The Chrome a launch would start now, or null when the machine has none. */
  chromePath(fresh = false): string | null {
    const found = this.found;
    if (!fresh && found !== null && this.now() - found.at < FIND_TTL_MS) return found.path;
    const chrome = this.deps.host.find(this.deps.settings.readSync().chromePath ?? null);
    this.found = { path: chrome, at: this.now() };
    return chrome;
  }

  /** The settings changed: the next lookup reads them again. */
  settingsChanged(): void {
    this.found = null;
  }

  /** The hosted entry of GET /status's `backends`. Starts nothing. */
  info(): BrowserBackendInfo {
    const found = this.chromePath(true);
    if (found === null) return { backend: "hosted", available: false, reason: "hosted_no_chrome" };
    const version = this.link.version;
    const chrome = {
      path: found,
      ...(version !== null ? { version } : {}),
      running: this.link.connected,
    };
    const failure = this.link.failure;
    if (
      !this.link.connected &&
      failure?.reason === "hosted_launch_failed" &&
      failure.chromePath === found
    ) {
      return {
        backend: "hosted",
        available: false,
        reason: failure.reason,
        ...(failure.detail !== undefined ? { detail: failure.detail } : {}),
        chrome,
      };
    }
    return { backend: "hosted", available: true, chrome };
  }

  /** GET /tabs: a Chrome that is not running has none, and is not started to say so. */
  async listTabs(): Promise<BuiltinBrowserTabsResponse> {
    if (this.link.connected) return this.runtime.listTabs();
    if (this.chromePath(true) === null) throw new BrowserUnavailableError("hosted_no_chrome");
    return { tabs: [], activeTabId: null };
  }

  /**
   * GET /tabs/:id/view: the open tab's view, to watch; 404 for a tab that is not open (a Chrome
   * that is not running has none). `viewport` lays the page out to the viewer's panel.
   */
  viewOf(tabId: number, viewport?: HostedBrowserViewport): TabView {
    const view = this.view(tabId);
    if (viewport !== undefined) {
      view.resize(viewport).catch((err: unknown) => {
        this.deps.log(`hosted browser: the page could not be resized: ${String(err)}`);
      });
    }
    return view;
  }

  /** POST /tabs/:id/input. */
  async input(tabId: number, request: HostedBrowserInputRequest): Promise<void> {
    const view = this.view(tabId);
    try {
      if (request.viewport !== undefined) await view.resize(request.viewport);
      await view.input(request.events ?? []);
    } catch (err) {
      throw mapLinkError(err, tabId, "hosted");
    }
  }

  dispose(): void {
    this.endViews();
    this.runtime.dispose();
  }

  private view(tabId: number): TabView {
    const session = this.link.session(tabId);
    if (session === null) {
      throw new HttpError(
        404,
        "no_such_tab",
        `Tab ${tabId} is not open in ${browserLabel("hosted")}.`,
      );
    }
    let view = this.views.get(tabId);
    if (view === undefined) {
      view = new TabView(session, { log: this.deps.log, ...this.deps.view });
      this.views.set(tabId, view);
    }
    return view;
  }

  private endViews(): void {
    for (const view of this.views.values()) view.end();
    this.views.clear();
  }
}
