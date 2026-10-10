/**
 * The seam under the driver: one link per backend, the same request/reply-and-events contract
 * whether the far side is the desktop shell (ShellLink, over Electron's utilityProcess port) or
 * the PenguinHarness Browser extension in the user's Chrome (ExtensionLink, over a WebSocket the
 * extension opens). The driver, the page scripts and the actions speak only this.
 *
 * What differs between the two is declared, not discovered: `capabilities` says which commands
 * the far side answers (the shell throttles and holds a cookie store; the extension creates,
 * closes and focuses its own tabs), and the backend runtime branches on it.
 */
import type {
  BrowserBackend,
  BrowserLinkCapabilities,
  BuiltinBrowserUnavailableReason,
  DesktopBrowserCommand,
  DesktopBrowserEvent,
} from "../api/types.js";
import { HttpError } from "../http/errors.js";

export interface BrowserLink {
  readonly backend: BrowserBackend;
  readonly capabilities: BrowserLinkCapabilities;
  /** Whether the far side has answered `hello` and is there now. */
  readonly connected: boolean;
  /** Sends one command and resolves with the far side's result. */
  request(command: DesktopBrowserCommand, timeoutMs?: number): Promise<unknown>;
  /**
   * True once the far side has answered `hello`. The shell's is tried (again, with `force`); an
   * extension's runs when its socket opens, so this answers false while there is none.
   */
  handshake(force?: boolean): Promise<boolean>;
  /** Every validated event, in order. Returns the unsubscribe. */
  onEvent(listener: (event: DesktopBrowserEvent) => void): () => void;
  /** Runs after each successful handshake (the runtime refreshes its tabs here). */
  onConnect(listener: () => Promise<void> | void): () => void;
  /** The far side went away (an extension's socket closed); never for the shell. */
  onDisconnect(listener: () => void): () => void;
  dispose(): void;
}

export const BUILTIN_CAPABILITIES: BrowserLinkCapabilities = {
  createsTabs: false,
  throttles: true,
  cookieStore: true,
};

export const CHROME_CAPABILITIES: BrowserLinkCapabilities = {
  createsTabs: true,
  throttles: false,
  cookieStore: false,
};

/**
 * Why a request did not produce a result: the far side refused it (`message` is its own error
 * — a CDP error text, or `no_such_tab`, `tab_crashed`, `tab_released`), it did not answer in
 * time, or the link closed under it.
 */
export class BrowserLinkError extends Error {
  constructor(
    readonly kind: "refused" | "timeout" | "closed",
    message: string,
  ) {
    super(message);
    this.name = "BrowserLinkError";
  }
}

/** How the errors name the browser the agent drives. */
export function browserLabel(backend: BrowserBackend): string {
  return backend === "builtin" ? "the built-in browser" : "your Chrome";
}

const UNAVAILABLE: Record<BuiltinBrowserUnavailableReason, string> = {
  not_desktop:
    "The built-in browser needs the PenguinHarness desktop app, and this server is not running inside it.",
  shell_unsupported:
    "This installation of the desktop app is too old to host the built-in browser; update the app.",
  no_window: "No PenguinHarness window took the tab; open the app window and try again.",
  extension_not_paired:
    "No Chrome is paired for this user. Ask the user to install the PenguinHarness Browser extension and pair it (Browser panel → Connect your Chrome).",
  extension_disconnected:
    "Chrome is not connected. Ask the user to open Chrome with the PenguinHarness Browser extension, or to pair it again in the Browser panel.",
  extension_disabled:
    "An admin has switched off Chrome connections on this server; the user's own Chrome cannot be driven.",
};

/** 503 `browser_unavailable`, with the reason the routes put beside the code. */
export class BrowserUnavailableError extends HttpError {
  constructor(readonly reason: BuiltinBrowserUnavailableReason) {
    super(503, "browser_unavailable", UNAVAILABLE[reason]);
  }
}

/** 409 `tab_released`: the user took the tab back from the agent in their Chrome. */
export function tabReleasedError(tabId: number): HttpError {
  return new HttpError(
    409,
    "tab_released",
    `The user stopped the extension on tab ${tabId}; open a new tab (penguin browser open) or ask the user to add one. Do not retry this tab.`,
  );
}
