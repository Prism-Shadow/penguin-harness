/**
 * The builtin browser's event vocabulary: the tab list, activity, metrics and extension
 * state the browser pushes to its watchers, and the desktop Chrome bridge's shapes. Declared
 * apart from what implements them — the server's browser machinery implements the pushes
 * these name. One package, no server dependencies.
 */
import type { SessionSource } from "@prismshadow/amsp";

/** The browser an agent drives: the desktop's built-in one, or the user's own Chrome. */
export type BrowserBackend = "builtin" | "chrome";

/** One Chrome paired to the caller's account (a row of `browser_extensions`). */
export interface BrowserExtensionRecord {
  id: string;
  /** As the extension names itself, e.g. "Chrome 130 on macOS". */
  name: string;
  version: string;
  createdAt: string;
  lastSeenAt: string | null;
  /** Whether this one holds the caller's connection now (one at a time per user). */
  connected: boolean;
}

/**
 * The `hello` reply. Built-in: `{ version: 1, partition }` (an older shell sends no `backend`).
 * Chrome: `{ version: 1, backend: "chrome", extension }`; any other version is closed 4005.
 * Hub (the server that added this machine, over its channel): `{ version: 1, backend, hub: true }`,
 * `backend` the one its admin's agents drive there now.
 */
export interface BrowserHello {
  version: 1;
  backend?: BrowserBackend;
  partition?: string;
  extension?: { version: string; chrome: string; name: string };
  hub?: true;
}

export type BuiltinBrowserAction =
  "navigate" | "scan" | "exec" | "click" | "type" | "screenshot" | "cdp";

/**
 * The built-in browser's load: GET /status's `metrics`, and the `builtin_browser_metrics` event
 * after each of the shell's measurements (every ~10 s while tabs are open, and soon after one
 * closes). The thresholds are the server's; the UI and the CLI only word what it concluded.
 */
/** One tab's share of the built-in browser's load, as the shell last measured it. */
export interface BuiltinBrowserTabMetrics {
  tabId: number;
  /** The memory held by the processes behind the page (its own and its cross-site frames'), KB. */
  memoryKB: number;
  /** Their CPU use since the previous measurement, in percent of one core. */
  cpuPercent: number;
}

/** Why the built-in browser should be lighter. */
export type BuiltinBrowserLoadWarning =
  /** Its pages together hold more memory than they should. */
  | "memory"
  /** This computer is running out of memory. */
  | "low_system_memory"
  /** More tabs are open than the browser should hold. */
  | "many_tabs";

export interface BuiltinBrowserMetrics {
  /** When the server received the measurement (epoch ms). */
  at: number;
  tabs: BuiltinBrowserTabMetrics[];
  /** All the pages' memory, a process two tabs share counted once, KB. */
  totalKB: number;
  /**
   * This computer's memory, KB. Absent on macOS, whose free count leaves out the memory it would
   * readily hand back, so that "free" there reads as nearly none on a healthy machine.
   */
  system?: { freeKB: number; totalKB: number };
  /** What to warn about now; empty when all is well. */
  warnings: BuiltinBrowserLoadWarning[];
  /** While a memory warning stands: the tabs holding the most memory, heaviest first. */
  heavyTabIds: number[];
}

/**
 * One tab of the agent browser. Built-in: a guest page, `id` its webContents id. Chrome: a tab
 * the extension drives (one it created in the Penguin tab group, or one the user added), `id`
 * Chrome's tab id; `canGoBack`/`canGoForward` are always false there (the tabs API cannot read
 * them).
 */
export interface BuiltinBrowserTab {
  id: number;
  /** The built-in tab belongs to this conversation; absent for pages opened outside a conversation. */
  sessionId?: string;
  /** Electron storage partition, shared only within this tab's Project. */
  partition?: string;
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  favicon?: string;
  /**
   * Present while the page's renderer is gone, with Electron's reason (`crashed`, `oom`,
   * `killed`, …): the panel shows the crash until the page is reloaded, and an agent action on
   * the tab answers 409 `tab_crashed`.
   */
  crashed?: string;
}

/**
 * Server → browser link: what the shell (built-in) or the extension (chrome) does with its tabs.
 * Mechanism only — the product logic stays on the server. The names are historical: the same
 * envelopes travel the extension's WebSocket as JSON text frames.
 */
export type DesktopBrowserCommand =
  /** Reply: a BrowserHello. An older shell never answers. */
  | { op: "hello" }
  /** Reply: `{ tabs: BuiltinBrowserTab[] }`. */
  | { op: "tabs" }
  /**
   * Reply: the CDP method's result object. `events` names the tab's CDP events the shell relays
   * from then on, as `cdp-event`s: it replaces the list before (empty relays none), and is set
   * before the command runs, so an event the command itself causes is not missed. Without it
   * the list stays as it is.
   */
  | {
      op: "cdp";
      tabId: number;
      method: string;
      params?: Record<string, unknown>;
      events?: string[];
    }
  /** Reply: `{ set: number; failed: number; errors: string[] }` (at most 10 errors). */
  | { op: "set-cookies"; cookies: DesktopBrowserCookie[]; partition?: string }
  /** Reply: `{}`. */
  | { op: "clear-data"; storages: ("cookies" | "cache" | "storage")[]; partition?: string }
  /**
   * Reply: `{}`. The tabs whose pages may be throttled while out of sight (Electron's background
   * throttling, applied at once); every other tab runs at full speed. It replaces the list
   * before. A tab is unthrottled until a command lists it, so a server that never sends one
   * changes nothing. A shell older than this command answers `unknown_op`.
   */
  | { op: "throttle"; tabIds: number[] }
  /**
   * Chrome and hub (the shell answers `unknown_op`). Reply: `{ tab: BuiltinBrowserTab }`. A tab
   * at `url` (http(s) or about:blank, checked by the server) in the extension's Penguin tab group;
   * `activate` asks for it to be the selected tab of its window. To a hub, `sessionId` names the
   * machine's Session the tab belongs to and `projectId` its Project (the tab's partition); the
   * extension ignores both.
   */
  | { op: "open-tab"; url: string; activate: boolean; sessionId?: string; projectId?: string }
  /** Chrome only. Reply: `{}`. Closes a tab the extension drives. */
  | { op: "close-tab"; tabId: number }
  /** Chrome only. Reply: `{}`. Shows the tab in the user's Chrome (selects it, focuses its window). */
  | { op: "activate-tab"; tabId: number }
  /** Chrome and hub. Reply: `{}`. Sent every 20 s; the traffic keeps the MV3 service worker alive. */
  | { op: "ping" }
  /**
   * Hub only. Reply: `{}`. An agent on the machine started (`busy`) or finished an action in the
   * tab: the hub shows the agent at work in its window and keeps the page at full speed meanwhile.
   */
  | {
      op: "activity";
      tabId: number;
      busy: boolean;
      action: BuiltinBrowserAction;
      sessionId?: string;
    }
  /**
   * Chrome only, for the built-in browser's import. Reply: `{ cookies: ChromeExtensionCookie[] }`,
   * the cookies of the Chrome profile the extension runs in, read only after the user allows it
   * on the extension's consent page. Refused `import_declined` when they do not: Deny, the page
   * closed, or no answer within two minutes.
   */
  | { op: "read-cookies" };

export interface DesktopBrowserCommandMessage {
  type: "desktop-browser-command";
  id: string;
  command: DesktopBrowserCommand;
}

export interface DesktopBrowserReplyMessage {
  type: "desktop-browser-reply";
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

/** A cookie as the shell writes it (Electron's CookiesSetDetails). */
export interface DesktopBrowserCookie {
  url: string;
  name: string;
  value: string;
  domain?: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  /** Unix seconds; absent = session cookie. */
  expirationDate?: number;
  sameSite?: "unspecified" | "no_restriction" | "lax" | "strict";
}

/**
 * A cookie as the extension reads it from Chrome (`chrome.cookies.Cookie`, the fields an import
 * uses). `domain` is as Chrome gives it and `hostOnly` is false for a domain cookie;
 * `expirationDate` is Unix seconds, absent for a session cookie; `partitioned` marks a cookie
 * kept for one top-level site.
 */
export interface ChromeExtensionCookie {
  domain: string;
  hostOnly: boolean;
  name: string;
  value: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: "unspecified" | "no_restriction" | "lax" | "strict";
  expirationDate?: number;
  partitioned?: boolean;
}

/**
 * User-channel events of the agent browser. The built-in backend's go to every admin; a chrome
 * backend's go to the user whose Chrome it is, as do `builtin_browser_backend` and
 * `builtin_browser_extension`.
 */
export type BuiltinBrowserServerEvent =
  /**
   * A backend's whole tab list. `backend` names whose: a desktop admin hears both the built-in
   * browser's and their own Chrome's, and the two lists must not overwrite each other.
   */
  | {
      type: "builtin_browser_tabs";
      tabs: BuiltinBrowserTab[];
      activeTabId: number | null;
      backend: BrowserBackend;
    }
  /** Create a guest for `url`, then POST /tabs/claim with `requestId` once it has a webContents id. */
  | {
      type: "builtin_browser_open";
      partition?: string;
      requestId: string;
      url: string;
      activate: boolean;
      openerTabId?: number;
      sessionId?: string;
    }
  | { type: "builtin_browser_close"; tabId: number }
  /** A draft or healed conversation acquired its permanent id. */
  | { type: "builtin_browser_session"; fromSessionId: string; sessionId: string }
  | {
      type: "builtin_browser_activity";
      tabId: number;
      busy: boolean;
      action: BuiltinBrowserAction;
      sessionId?: string;
    }
  /** The shell measured the browser's load (see BuiltinBrowserMetrics). */
  | { type: "builtin_browser_metrics"; metrics: BuiltinBrowserMetrics }
  /** The user switched backend (PUT /backend); every window of theirs follows. */
  | { type: "builtin_browser_backend"; backend: BrowserBackend }
  /** The user's Chrome connected, went away, was replaced by another Chrome of theirs, or was revoked. */
  | {
      type: "builtin_browser_extension";
      state: "connected" | "disconnected" | "replaced" | "revoked";
      extension?: BrowserExtensionRecord;
    };
