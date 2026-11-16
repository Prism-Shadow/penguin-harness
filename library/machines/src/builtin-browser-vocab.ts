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
 */
export interface BrowserHello {
  version: 1;
  backend?: BrowserBackend;
  partition?: string;
  extension?: { version: string; chrome: string; name: string };
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
