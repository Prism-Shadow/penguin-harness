/**
 * The tabs of one launched Chrome, as the hosted link speaks of them: CDP's page targets turned
 * into the link's tabs and tab events. One per launch — a Chrome that exits takes it along.
 *
 * - A page target that appears (one the link created, or a popup) is attached with a flat
 *   session and has its Page events turned on; only then is it announced as a `tab`. A tab is
 *   known by a number the link gives it.
 * - Its address follows `Target.targetInfoChanged` and its loading state the main frame's Page
 *   events. Chrome announces no change of title, so the title — with whether there is a page to
 *   go back or forward to — is read from the navigation history when the page navigates or
 *   finishes loading, and once more a moment later for a page that names itself late. A title
 *   changed with no navigation at all is seen at the next one.
 * - Its end is `tab-closed`; its renderer's is `tab-crashed`, and the tab says `crashed` until
 *   a document commits in it again.
 * - The CDP events a `cdp` command asked for are relayed as `cdp-event`s.
 * - A dialog nobody is watching for would block its page for good — there is no window to
 *   answer it in — so outside an action that relays dialogs an alert or a leave-page prompt is
 *   accepted and a confirm or prompt dismissed.
 */
import type { BuiltinBrowserTab, DesktopBrowserEvent } from "../api/types.js";
import type { CdpConnection } from "./hosted-chrome.js";
import { BrowserLinkError } from "./link.js";

/** One tab's CDP session, as the picture and the input of a tab use it (hosted-view.ts). */
export interface TabSession {
  send(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<unknown>;
  /** The session's CDP events. Returns the unsubscribe. */
  onEvent(listener: (method: string, params: Record<string, unknown>) => void): () => void;
}

export interface HostedTabsDeps {
  cdp: CdpConnection;
  emit(event: DesktopBrowserEvent): void;
  /** A number for a new tab; never the same twice, across launches too. */
  nextId(): number;
  /** The number of tabs changed (the link's idle countdown follows it). */
  changed(): void;
  log(line: string): void;
  /** A command that names no timeout of its own. */
  timeoutMs: number;
}

/** A new tab's window, in CSS pixels, until a viewer lays the page out to its panel. */
const TAB_SIZE = { width: 1280, height: 800 };
/** Reading the history and answering a dialog: a page answers these at once. */
const QUICK_TIMEOUT_MS = 5_000;
/** After a navigation, how long a page gets to name itself before its title is read once more. */
const TITLE_SETTLE_MS = 1_000;
const DIALOG_EVENT = "Page.javascriptDialogOpening";

interface HostedTab {
  tab: BuiltinBrowserTab;
  targetId: string;
  /** Empty until the target is attached. */
  sessionId: string;
  /** Whether it has been announced as a `tab`; until then it is not one. */
  announced: boolean;
  /** The CDP events relayed as `cdp-event`s (the last `cdp` command's `events`). */
  relay: Set<string>;
  listeners: Set<(method: string, params: Record<string, unknown>) => void>;
  /** The second reading of its title under way (see TITLE_SETTLE_MS). */
  settle: NodeJS.Timeout | null;
  /**
   * A tab created blank for an address (see `open`): `asked` until that address commits,
   * `committed` until its load ends, when the blank page is taken out of the history.
   */
  blank: "no" | "asked" | "committed";
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const stringOf = (value: unknown): string => (typeof value === "string" ? value : "");
const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export class HostedTabs {
  private readonly tabs = new Map<number, HostedTab>();
  private readonly byTarget = new Map<string, HostedTab>();
  private readonly bySession = new Map<string, HostedTab>();
  /** Per target, its attachment under way or done. */
  private readonly adopting = new Map<string, Promise<HostedTab | null>>();

  constructor(private readonly deps: HostedTabsDeps) {}

  /** The targets held, announced or still being attached. */
  get size(): number {
    return this.tabs.size;
  }

  list(): BuiltinBrowserTab[] {
    return [...this.tabs.values()].filter((entry) => entry.announced).map((entry) => entry.tab);
  }

  /** The target of an open tab, or the link's `no_such_tab`. */
  targetOf(tabId: number): string {
    return this.entry(tabId).targetId;
  }

  /** `open-tab`: a page target in a window of its own (so no tab hides another), then navigated. */
  async open(url: string, timeoutMs: number): Promise<BuiltinBrowserTab> {
    const { cdp } = this.deps;
    const deadline = Date.now() + timeoutMs;
    const left = () => Math.max(1, deadline - Date.now());
    // Created blank and then navigated: the address is asked for only once the tab's events are
    // heard, so its loading state is never missed.
    const created = await cdp.call(
      "Target.createTarget",
      { url: "about:blank", newWindow: true, ...TAB_SIZE },
      undefined,
      left(),
    );
    const targetId = isRecord(created) ? stringOf(created.targetId) : "";
    const entry = await this.adopt({ targetId, type: "page", url: "about:blank", title: "" });
    if (entry === null) {
      throw new BrowserLinkError("refused", "The new tab closed before it could be driven.");
    }
    if (url !== "about:blank") {
      entry.blank = "asked";
      await cdp.call("Page.navigate", { url }, entry.sessionId, left());
    }
    return entry.tab;
  }

  /** `cdp`: one command on the tab's session; `events` replaces the events relayed from it. */
  command(
    tabId: number,
    method: string,
    params: Record<string, unknown>,
    events: string[] | undefined,
    timeoutMs: number,
  ): Promise<unknown> {
    const entry = this.entry(tabId);
    if (entry.tab.crashed !== undefined) throw new BrowserLinkError("refused", "tab_crashed");
    if (events !== undefined) entry.relay = new Set(events);
    return this.deps.cdp.call(method, params, entry.sessionId, timeoutMs);
  }

  /** The CDP session of an open tab, or null when the tab is not one. */
  session(tabId: number): TabSession | null {
    const entry = this.tabs.get(tabId);
    if (entry === undefined || !entry.announced) return null;
    return {
      send: (method, params = {}, timeoutMs = this.deps.timeoutMs) =>
        this.deps.cdp.call(method, params, entry.sessionId, timeoutMs),
      onEvent: (listener) => {
        entry.listeners.add(listener);
        return () => entry.listeners.delete(listener);
      },
    };
  }

  /** One event off the pipe: the browser's (no session) or a tab's. */
  onEvent(method: string, params: Record<string, unknown>, sessionId: string | undefined): void {
    if (sessionId === undefined) {
      this.onBrowserEvent(method, params);
      return;
    }
    const entry = this.bySession.get(sessionId);
    if (entry !== undefined) this.onSessionEvent(entry, method, params);
  }

  /** Chrome is gone: nothing here is a tab any more, and an attachment under way ends quietly. */
  clear(): void {
    for (const entry of this.tabs.values()) this.unsettle(entry);
    this.tabs.clear();
    this.byTarget.clear();
    this.bySession.clear();
    this.adopting.clear();
  }

  private entry(tabId: number): HostedTab {
    const entry = this.tabs.get(tabId);
    if (entry === undefined || !entry.announced) {
      throw new BrowserLinkError("refused", "no_such_tab");
    }
    return entry;
  }

  /** Takes a page target on as a tab: attached with a flat session, its Page events on, then announced. */
  private adopt(info: Record<string, unknown>): Promise<HostedTab | null> {
    const targetId = stringOf(info.targetId);
    if (targetId === "" || info.type !== "page") return Promise.resolve(null);
    const known = this.adopting.get(targetId);
    if (known !== undefined) return known;
    const entry: HostedTab = {
      tab: {
        id: this.deps.nextId(),
        url: stringOf(info.url),
        title: stringOf(info.title),
        loading: false,
        canGoBack: false,
        canGoForward: false,
      },
      targetId,
      sessionId: "",
      announced: false,
      relay: new Set(),
      listeners: new Set(),
      settle: null,
      blank: "no",
    };
    this.tabs.set(entry.tab.id, entry);
    this.byTarget.set(targetId, entry);
    this.deps.changed();
    const { cdp, timeoutMs } = this.deps;
    const held = () => this.byTarget.get(targetId) === entry;
    const adoption = (async () => {
      const attached = await cdp.call(
        "Target.attachToTarget",
        { targetId, flatten: true },
        undefined,
        timeoutMs,
      );
      const sessionId = isRecord(attached) ? stringOf(attached.sessionId) : "";
      if (sessionId === "" || !held()) return null;
      entry.sessionId = sessionId;
      this.bySession.set(sessionId, entry);
      await cdp.call("Page.enable", {}, sessionId, timeoutMs);
      if (!held()) return null;
      entry.announced = true;
      this.deps.emit({ kind: "tab", tab: entry.tab });
      return entry;
    })().catch((err: unknown) => {
      // Closed while it was being attached, or Chrome went away: there is no tab to speak of.
      if (held()) {
        this.deps.log(`hosted browser: a new tab could not be attached: ${messageOf(err)}`);
        this.drop(entry);
      }
      return null;
    });
    this.adopting.set(targetId, adoption);
    return adoption;
  }

  private drop(entry: HostedTab): void {
    this.unsettle(entry);
    this.tabs.delete(entry.tab.id);
    this.byTarget.delete(entry.targetId);
    this.bySession.delete(entry.sessionId);
    this.adopting.delete(entry.targetId);
    if (entry.sessionId !== "") this.deps.cdp.refuseSession(entry.sessionId, "no_such_tab");
    if (entry.announced) this.deps.emit({ kind: "tab-closed", tabId: entry.tab.id });
    this.deps.changed();
  }

  /** Changes a tab's state; an announced tab that did change is announced again. */
  private update(entry: HostedTab, patch: Partial<BuiltinBrowserTab>): void {
    const next: BuiltinBrowserTab = { ...entry.tab, ...patch };
    if (next.crashed === undefined) delete next.crashed;
    if (JSON.stringify(next) === JSON.stringify(entry.tab)) return;
    entry.tab = next;
    if (entry.announced) this.deps.emit({ kind: "tab", tab: next });
  }

  /** Reads the page's title and history now, and once more when it has had time to name itself. */
  private refresh(entry: HostedTab): void {
    void this.readPage(entry);
    this.unsettle(entry);
    entry.settle = setTimeout(() => {
      entry.settle = null;
      void this.readPage(entry);
    }, TITLE_SETTLE_MS);
    entry.settle.unref?.();
  }

  private unsettle(entry: HostedTab): void {
    if (entry.settle !== null) clearTimeout(entry.settle);
    entry.settle = null;
  }

  /** The current history entry's title, and whether there are entries before and after it. */
  private async readPage(entry: HostedTab): Promise<void> {
    try {
      const history = await this.deps.cdp.call(
        "Page.getNavigationHistory",
        {},
        entry.sessionId,
        QUICK_TIMEOUT_MS,
      );
      if (!isRecord(history) || !Array.isArray(history.entries)) return;
      const index = typeof history.currentIndex === "number" ? history.currentIndex : 0;
      const current: unknown = history.entries[index];
      const title = isRecord(current) ? stringOf(current.title) : "";
      this.update(entry, {
        // A page with no title keeps the one Chrome gave its target (its address).
        ...(title !== "" ? { title } : {}),
        canGoBack: index > 0,
        canGoForward: index < history.entries.length - 1,
      });
    } catch {
      // A page between documents, or a tab on its way out: the next navigation asks again.
    }
  }

  private onBrowserEvent(method: string, params: Record<string, unknown>): void {
    const info = isRecord(params.targetInfo) ? params.targetInfo : {};
    switch (method) {
      case "Target.targetCreated":
        void this.adopt(info);
        break;
      case "Target.targetInfoChanged": {
        const entry = this.byTarget.get(stringOf(info.targetId));
        if (entry === undefined) break;
        this.update(entry, {
          ...(typeof info.url === "string" ? { url: info.url } : {}),
          ...(typeof info.title === "string" ? { title: info.title } : {}),
        });
        break;
      }
      case "Target.targetDestroyed": {
        const entry = this.byTarget.get(stringOf(params.targetId));
        if (entry !== undefined) this.drop(entry);
        break;
      }
      case "Target.targetCrashed": {
        const entry = this.byTarget.get(stringOf(params.targetId));
        if (entry === undefined) break;
        if (entry.sessionId !== "") this.deps.cdp.refuseSession(entry.sessionId, "tab_crashed");
        this.update(entry, { loading: false, crashed: "crashed" });
        if (!entry.announced) break;
        this.deps.emit({
          kind: "tab-crashed",
          tabId: entry.tab.id,
          reason: "crashed",
          exitCode: typeof params.errorCode === "number" ? params.errorCode : 0,
        });
        break;
      }
    }
  }

  private onSessionEvent(entry: HostedTab, method: string, params: Record<string, unknown>): void {
    // A page target's main frame carries the target's own id.
    const main = params.frameId === entry.targetId;
    switch (method) {
      case "Page.frameStartedLoading":
        if (main) this.update(entry, { loading: true });
        break;
      case "Page.frameStoppedLoading":
        if (main) {
          this.update(entry, { loading: false });
          if (entry.blank === "committed") {
            // The blank page a tab was created on is not somewhere to go back to. Chrome prunes
            // its history only once the navigation is over, so not before now.
            entry.blank = "no";
            this.deps.cdp
              .call("Page.resetNavigationHistory", {}, entry.sessionId, QUICK_TIMEOUT_MS)
              .catch(() => {})
              .then(() => this.refresh(entry));
          } else {
            this.refresh(entry);
          }
        }
        break;
      case "Page.frameNavigated":
        // A document committed in the main frame: a crashed page has been reloaded.
        if (isRecord(params.frame) && params.frame.parentId === undefined) {
          this.update(entry, { crashed: undefined });
          if (entry.blank === "asked") entry.blank = "committed";
          this.refresh(entry);
        }
        break;
      case "Page.navigatedWithinDocument":
        if (main) this.refresh(entry);
        break;
      case DIALOG_EVENT:
        if (!entry.relay.has(DIALOG_EVENT)) {
          const accept = params.type === "alert" || params.type === "beforeunload";
          this.deps.cdp
            .call("Page.handleJavaScriptDialog", { accept }, entry.sessionId, QUICK_TIMEOUT_MS)
            .catch(() => {});
        }
        break;
    }
    if (entry.relay.has(method)) {
      this.deps.emit({ kind: "cdp-event", tabId: entry.tab.id, method, params });
    }
    for (const listener of entry.listeners) {
      try {
        listener(method, params);
      } catch (err) {
        this.deps.log(`hosted browser: a '${method}' listener failed: ${messageOf(err)}`);
      }
    }
  }
}
