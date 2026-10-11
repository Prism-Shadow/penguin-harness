/**
 * The agent browser's round trips to the server, each paired with the local change that makes
 * it feel immediate. Components call these; none of them throws.
 *
 * Those the Browser panel makes name the server the panel belongs to (null, the default, for
 * this one): the request goes to that server and the local change to its state.
 */
import type { BrowserBackend, BuiltinBrowserTab } from "@prismshadow/penguin-server/api";
import { toastAttention, toastError, toastSuccess } from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { apiErrorText } from "../../lib/api-error";
import { S } from "../../lib/strings";
import { machineForSession } from "../../lib/session-machines";
import { currentDockScope, openPanel } from "../dock/dock-state";
import { browserState, dispatchBrowser } from "./browser-store";
import { NO_BROWSER_SCOPE, type BrowserGuest, type RemoteBackend } from "./browser-state";

const opening = new Map<Promise<unknown>, string>();

/**
 * The server whose browser the conversation on screen uses: the machine its Session lives on,
 * or this server (a draft, or a Session here).
 */
export function conversationServer(): string | null {
  return machineForSession(currentDockScope());
}

/**
 * Reads availability and the registry. A refusal — an older server without the route, an
 * account that is not an admin — means the browser cannot be used from here; a network
 * failure says nothing either way and keeps what is known.
 */
export async function refreshBrowserStatus(server: string | null = null): Promise<void> {
  try {
    dispatchBrowser({ type: "status", status: await api.getBuiltinBrowserStatus(server) }, server);
  } catch (err) {
    if (err instanceof ApiError && err.status !== 0) {
      dispatchBrowser({ type: "unreachable" }, server);
    }
  }
}

/**
 * Reads the browser's settings (its homepage). A refusal or a network failure keeps what is
 * known: an older server without the route simply has no homepage to offer.
 */
export async function refreshBrowserSettings(): Promise<void> {
  try {
    dispatchBrowser({ type: "settings", settings: await api.getBuiltinBrowserSettings() });
  } catch {
    // Nothing to do: the toolbar goes on without a Home button.
  }
}

/**
 * Opens a tab and brings it to the front: at `url`, or else at the new-tab page the server
 * picks, the homepage, or a blank page without one. The tab once it exists, else null. While
 * the request is on its way the store counts it, so the panel does not open the new-tab page
 * beside it. A browser that turned out not to run (a server's Chrome that did not start) is
 * read again, so the panel says why.
 */
export function openBrowserTab(
  url?: string,
  server: string | null = null,
): Promise<BuiltinBrowserTab | null> {
  const state = browserState(server);
  const request = openInScope(state.scope, state.projectId, url, server);
  opening.set(request, state.scope);
  void request.finally(() => opening.delete(request));
  return request;
}

async function openInScope(
  scope: string,
  projectId: string | null,
  url?: string,
  server: string | null = null,
): Promise<BuiltinBrowserTab | null> {
  dispatchBrowser({ type: "opening", delta: 1, scope }, server);
  try {
    const { tab } = await api.openBuiltinBrowserTab(
      {
        activate: true,
        ...(projectId === null ? {} : { projectId }),
        ...(url === undefined ? {} : { url }),
        ...(scope === NO_BROWSER_SCOPE ? {} : { sessionId: scope }),
      },
      server,
    );
    return tab;
  } catch (err) {
    toastError(S.builtinBrowser.openFailed(apiErrorText(err)));
    if (err instanceof ApiError && err.code === "browser_unavailable") {
      void refreshBrowserStatus(server);
    }
    return null;
  } finally {
    dispatchBrowser({ type: "opening", delta: -1, scope }, server);
  }
}

/** A draft's pages follow its first send, after any outstanding opens have been claimed. */
export async function adoptBrowserSession(fromSessionId: string, sessionId: string): Promise<void> {
  if (fromSessionId === sessionId || fromSessionId === NO_BROWSER_SCOPE) return;
  const state = browserState();
  if (!state.supported) return;
  const pending = [...opening]
    .filter(([, scope]) => scope === fromSessionId)
    .map(([request]) => request);
  if (
    pending.length === 0 &&
    !state.guests.some((guest) => guest.scope === fromSessionId) &&
    !state.tabs.some((tab) => tab.sessionId === fromSessionId)
  )
    return;
  await Promise.all(pending);
  try {
    await api.adoptBuiltinBrowserSession(fromSessionId, sessionId);
    dispatchBrowser({
      type: "event",
      event: { type: "builtin_browser_session", fromSessionId, sessionId },
    });
  } catch (err) {
    toastError(apiErrorText(err));
  }
}

/**
 * A link from the conversation, opened in the agent browser: the Browser panel comes up in the
 * dock of the conversation on screen, and the link opens in a new tab — the same request as the
 * panel's own new tab, so the page joins this conversation's tabs (in the user's Chrome, its tab
 * comes to the front there). The browser is the one that panel shows: the conversation's
 * server's.
 */
export function openLinkInBrowser(url: string): void {
  openPanel("builtin-browser");
  void openBrowserTab(url, conversationServer());
}

/**
 * Brings a tab to the front here at once; the server's next registry snapshot confirms it. A
 * tab of the user's Chrome comes to the front in Chrome too.
 */
export function activateBrowserTab(
  tabId: number,
  backend: BrowserBackend = "builtin",
  server: string | null = null,
): void {
  dispatchBrowser({ type: "activated", tabId, backend }, server);
  void api.activateBuiltinBrowserTab(tabId, server).catch(() => undefined);
}

/**
 * Closes a tab of the user's Chrome, or of a server's own: it leaves the strip at once, and the
 * browser it lives in closes it. A failure says why; the next tab list puts the tab back if it
 * is still open.
 */
export function closeRemoteTab(
  tabId: number,
  backend: RemoteBackend = "chrome",
  server: string | null = null,
): void {
  dispatchBrowser({ type: "chrome-closed", tabId, backend }, server);
  void api.closeBuiltinBrowserTab(tabId, server).catch((err: unknown) => {
    if (!(err instanceof ApiError && err.status === 404)) {
      toastError(S.builtinBrowser.closeFailed(apiErrorText(err)));
    }
  });
}

/** Loads an address in a tab this window hosts no page for (the user's Chrome, a server's own). */
export function navigateRemoteTab(tabId: number, url: string, server: string | null = null): void {
  void api.navigateBuiltinBrowserTab(tabId, url, server).catch((err: unknown) => {
    toastError(S.builtinBrowser.openFailed(apiErrorText(err)));
  });
}

/**
 * Moves this user's agents to another backend. The server tells every window of theirs, this
 * one included; the toast says what changed. While an agent acts in the browser being left the
 * server refuses, and the toast says to wait — nothing is asked, nothing changes. True once
 * switched.
 */
export async function switchBrowserBackend(
  backend: BrowserBackend,
  server: string | null = null,
): Promise<boolean> {
  try {
    await api.putBrowserBackend(backend, server);
  } catch (err) {
    if (err instanceof ApiError && err.code === "action_in_flight") {
      toastAttention(S.builtinBrowser.switchRefused);
    } else {
      toastError(S.builtinBrowser.switchFailed(apiErrorText(err)));
    }
    return false;
  }
  dispatchBrowser({ type: "event", event: { type: "builtin_browser_backend", backend } }, server);
  toastSuccess(
    backend === "chrome"
      ? S.builtinBrowser.switchedToChrome
      : backend === "hosted"
        ? S.builtinBrowser.switchedToHosted
        : S.builtinBrowser.switchedToBuiltin,
  );
  await refreshBrowserStatus(server);
  return true;
}

/**
 * Closes a tab. The page leaves this window at once — removing its element ends the guest,
 * and the shell reports that to the server itself — so the request only tells the server
 * (and any other window) sooner; a 404 means the server had already dropped it.
 */
export function closeBrowserTab(tabId: number): void {
  dispatchBrowser({ type: "closed", tabId });
  void api.closeBuiltinBrowserTab(tabId).catch(() => undefined);
}

/**
 * A guest attached and knows its tab id: record it, then claim the open request it answers.
 * Another window claiming first (409) removes this copy. Any other failure keeps the page —
 * the shell has registered it as a tab either way, it just answers no request.
 */
export async function claimGuest(guest: BrowserGuest, tabId: number): Promise<void> {
  dispatchBrowser({ type: "attached", key: guest.key, tabId });
  try {
    await api.claimBuiltinBrowserTab(guest.requestId, tabId);
  } catch (err) {
    if (err instanceof ApiError && err.status === 409)
      dispatchBrowser({ type: "rejected", key: guest.key });
    return;
  }
  // Activating is idempotent server-side, and asking here does not depend on whether the
  // request that opened the tab already made it active.
  if (guest.activate) activateBrowserTab(tabId);
}
