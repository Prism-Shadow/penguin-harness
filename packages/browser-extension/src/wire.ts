/**
 * The browser link's wire as the extension speaks it to a PenguinHarness server: the desktop
 * shell's `desktop-browser-command | reply | event` envelopes, carried as JSON text frames on the
 * WebSocket `/api/builtin-browser/extension/ws`, plus the pairing route's request and answer.
 *
 * The server sends commands and the extension answers each with one reply carrying the same id;
 * the extension pushes events. `hello` opens every connection and `ping` keeps it (and the MV3
 * worker) alive. The token rides in `Sec-WebSocket-Protocol` (`penguin-browser.1`,
 * `token.<token>`), never in a URL.
 *
 * TODO(system-chrome integration): the types below mirror the server's `api/types.ts` (design
 * § 3.1). Once the server side lands, replace the mirrors with type-only imports from
 * `@prismshadow/penguin-server/api` and keep only the guards and constants here.
 *
 * This file must stay erasable TypeScript (no enums, namespaces or parameter properties): the
 * e2e's stub server imports it directly under Node's type stripping.
 */

export type BrowserBackend = "builtin" | "chrome";

/** One drivable tab; `id` is Chrome's tab id. */
export interface BuiltinBrowserTab {
  id: number;
  url: string;
  title: string;
  loading: boolean;
  /** The tabs API cannot read a tab's history, so the extension always sends false. */
  canGoBack: boolean;
  canGoForward: boolean;
  favicon?: string;
  crashed?: string;
}

export interface DesktopBrowserCookie {
  url: string;
  name: string;
  value: string;
  domain?: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  expirationDate?: number;
  sameSite?: "unspecified" | "no_restriction" | "lax" | "strict";
}

/** Server → link. The extension answers `set-cookies`, `clear-data` and `throttle` with `unknown_op`. */
export type DesktopBrowserCommand =
  | { op: "hello" }
  | { op: "tabs" }
  | {
      op: "cdp";
      tabId: number;
      method: string;
      params?: Record<string, unknown>;
      events?: string[];
    }
  | { op: "set-cookies"; cookies: DesktopBrowserCookie[] }
  | { op: "clear-data"; storages: ("cookies" | "cache" | "storage")[] }
  | { op: "throttle"; tabIds: number[] }
  | { op: "open-tab"; url: string; activate: boolean }
  | { op: "close-tab"; tabId: number }
  | { op: "activate-tab"; tabId: number }
  | { op: "ping" };

/** The answer to `hello`. */
export interface BrowserHello {
  version: 1;
  backend: BrowserBackend;
  partition?: string;
  extension?: { version: string; chrome: string; name: string };
}

export type TabReleaseReason = "user" | "detached" | "restricted";

export type DesktopBrowserEvent =
  | { kind: "tab"; tab: BuiltinBrowserTab }
  | { kind: "tab-closed"; tabId: number }
  | { kind: "open-request"; url: string; openerTabId: number; background?: boolean }
  | { kind: "cdp-event"; tabId: number; method: string; params: Record<string, unknown> }
  | { kind: "tab-crashed"; tabId: number; reason: string; exitCode: number }
  | {
      kind: "metrics";
      tabs: { tabId: number; memoryKB: number; cpuPercent: number }[];
      totalKB: number;
    }
  | { kind: "tab-released"; tabId: number; reason: TabReleaseReason };

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

export interface DesktopBrowserEventMessage {
  type: "desktop-browser-event";
  event: DesktopBrowserEvent;
}

/** POST /api/builtin-browser/extension/pair, sent without a cookie. */
export interface ExtensionPairRequest {
  code: string;
  /** How this Chrome names itself in the Web App: "Chrome 130 on macOS". */
  name: string;
  /** The extension's version. */
  version: string;
}

export interface ExtensionPairResponse {
  extensionId: string;
  token: string;
  installId: string;
  user: { userId: string; displayName: string };
  serverVersion: string;
}

// --- constants -------------------------------------------------------------------------------

export const PROTOCOL_VERSION = 1;
/** The subprotocol the server selects; the second one the extension offers carries the token. */
export const SUBPROTOCOL = "penguin-browser.1";
export const TOKEN_PROTOCOL_PREFIX = "token.";
export const EXTENSION_WS_PATH = "/api/builtin-browser/extension/ws";
export const EXTENSION_PAIR_PATH = "/api/builtin-browser/extension/pair";

/** The server's close codes (design § 3.5). */
export const CLOSE_REPLACED = 4001;
export const CLOSE_REVOKED = 4003;
export const CLOSE_PROTOCOL_MISMATCH = 4005;
export const CLOSE_PING_TIMEOUT = 4008;
export const CLOSE_DISABLED = 4009;

/**
 * The words a refused command answers with, in `reply.error`. `no_such_tab` and `tab_released`
 * mean the same to the server as the shell's: the tab is not one this server may drive.
 */
export type LinkRefusal =
  | "bad_command"
  | "unknown_op"
  | "no_such_tab"
  | "tab_released"
  | "extension_paused"
  | "cdp_refused"
  | "bad_url";

// --- guards ----------------------------------------------------------------------------------

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isTabId = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value);

/** The most CDP event names one `cdp` command may ask to relay. */
const MAX_RELAYED_EVENTS = 64;

const isEventList = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.length <= MAX_RELAYED_EVENTS &&
  value.every((name) => typeof name === "string" && name !== "");

export type ParsedCommand =
  | { id: string; command: DesktopBrowserCommand }
  | { id: string; error: "bad_command" | "unknown_op" };

/**
 * One frame from the server, validated before anything reads it: null when it is not a command
 * at all (dropped), `error` when it is one this extension refuses to run.
 */
export function parseCommandMessage(data: unknown): ParsedCommand | null {
  if (!isRecord(data) || data.type !== "desktop-browser-command") return null;
  if (typeof data.id !== "string" || data.id === "") return null;
  const { id } = data;
  const command = data.command;
  if (!isRecord(command)) return { id, error: "bad_command" };
  switch (command.op) {
    case "hello":
    case "tabs":
    case "ping":
      return { id, command: { op: command.op } };
    case "cdp": {
      const { tabId, method, params, events } = command;
      if (!isTabId(tabId) || typeof method !== "string" || method === "") {
        return { id, error: "bad_command" };
      }
      if (params !== undefined && !isRecord(params)) return { id, error: "bad_command" };
      if (events !== undefined && !isEventList(events)) return { id, error: "bad_command" };
      return {
        id,
        command: {
          op: "cdp",
          tabId,
          method,
          ...(params !== undefined ? { params } : {}),
          ...(events !== undefined ? { events } : {}),
        },
      };
    }
    case "open-tab": {
      const { url, activate } = command;
      if (typeof url !== "string" || (activate !== undefined && typeof activate !== "boolean")) {
        return { id, error: "bad_command" };
      }
      return { id, command: { op: "open-tab", url, activate: activate === true } };
    }
    case "close-tab":
    case "activate-tab":
      if (!isTabId(command.tabId)) return { id, error: "bad_command" };
      return { id, command: { op: command.op, tabId: command.tabId } };
    default:
      // set-cookies, clear-data and throttle included: this link has no cookie store and no
      // throttling, so it answers them as a shell that never heard of them would.
      return { id, error: "unknown_op" };
  }
}

/** One reply, validated (the server's side of the link; the e2e's stub uses it). */
export function parseReplyMessage(data: unknown): DesktopBrowserReplyMessage | null {
  if (!isRecord(data) || data.type !== "desktop-browser-reply") return null;
  if (typeof data.id !== "string" || typeof data.ok !== "boolean") return null;
  return {
    type: "desktop-browser-reply",
    id: data.id,
    ok: data.ok,
    ...("result" in data ? { result: data.result } : {}),
    ...(typeof data.error === "string" ? { error: data.error } : {}),
  };
}

const RELEASE_REASONS: readonly string[] = ["user", "detached", "restricted"];

/**
 * One event, validated (the server's side of the link; the e2e's stub uses it). Only the kinds
 * this extension sends are accepted: `tab`, `tab-closed`, `cdp-event` and `tab-released`.
 */
export function parseEventMessage(data: unknown): DesktopBrowserEvent | null {
  if (!isRecord(data) || data.type !== "desktop-browser-event" || !isRecord(data.event)) {
    return null;
  }
  const event = data.event;
  switch (event.kind) {
    case "tab": {
      const tab = event.tab;
      if (!isRecord(tab) || !isTabId(tab.id) || typeof tab.url !== "string") return null;
      if (typeof tab.title !== "string" || typeof tab.loading !== "boolean") return null;
      return {
        kind: "tab",
        tab: {
          id: tab.id,
          url: tab.url,
          title: tab.title,
          loading: tab.loading,
          canGoBack: tab.canGoBack === true,
          canGoForward: tab.canGoForward === true,
          ...(typeof tab.favicon === "string" ? { favicon: tab.favicon } : {}),
        },
      };
    }
    case "tab-closed":
      return isTabId(event.tabId) ? { kind: "tab-closed", tabId: event.tabId } : null;
    case "cdp-event":
      if (!isTabId(event.tabId) || typeof event.method !== "string") return null;
      return {
        kind: "cdp-event",
        tabId: event.tabId,
        method: event.method,
        params: isRecord(event.params) ? event.params : {},
      };
    case "tab-released":
      if (!isTabId(event.tabId) || typeof event.reason !== "string") return null;
      if (!RELEASE_REASONS.includes(event.reason)) return null;
      return {
        kind: "tab-released",
        tabId: event.tabId,
        reason: event.reason as TabReleaseReason,
      };
    default:
      return null;
  }
}

/** The pairing route's answer; null when it is not one. */
export function parsePairResponse(data: unknown): ExtensionPairResponse | null {
  if (!isRecord(data) || !isRecord(data.user)) return null;
  const { extensionId, token, installId, serverVersion } = data;
  const { userId, displayName } = data.user;
  if (typeof extensionId !== "string" || extensionId === "") return null;
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{16,256}$/.test(token)) return null;
  if (typeof installId !== "string" || typeof serverVersion !== "string") return null;
  if (typeof userId !== "string" || typeof displayName !== "string") return null;
  return { extensionId, token, installId, serverVersion, user: { userId, displayName } };
}

/** The socket address for a server origin: http → ws, https → wss. */
export function socketUrl(origin: string): string {
  const url = new URL(EXTENSION_WS_PATH, origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}
