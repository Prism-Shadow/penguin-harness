/**
 * The built-in browser's round trips to the server, each paired with the local change that
 * makes it feel immediate. Components call these; none of them throws.
 */
import type { BuiltinBrowserTab } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { apiErrorText } from "../../lib/api-error";
import { S } from "../../lib/strings";
import { toastError } from "../../components/ui/toast";
import { openPanel } from "../dock/dock-state";
import { dispatchBrowser } from "./browser-store";
import type { BrowserGuest } from "./browser-state";

/**
 * Reads availability and the registry. A refusal — an older server without the route, an
 * account that is not an admin — means the browser cannot be used from here; a network
 * failure says nothing either way and keeps what is known.
 */
export async function refreshBrowserStatus(): Promise<void> {
  try {
    dispatchBrowser({ type: "status", status: await api.getBuiltinBrowserStatus() });
  } catch (err) {
    if (err instanceof ApiError && err.status !== 0) dispatchBrowser({ type: "unreachable" });
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
 * beside it.
 */
export async function openBrowserTab(url?: string): Promise<BuiltinBrowserTab | null> {
  dispatchBrowser({ type: "opening", delta: 1 });
  try {
    const { tab } = await api.openBuiltinBrowserTab(
      url === undefined ? { activate: true } : { url, activate: true },
    );
    return tab;
  } catch (err) {
    toastError(S.builtinBrowser.openFailed(apiErrorText(err)));
    return null;
  } finally {
    dispatchBrowser({ type: "opening", delta: -1 });
  }
}

/**
 * A link from the conversation, opened in the built-in browser: the Browser panel comes up in
 * the dock of the conversation on screen, and the link opens in a new tab there — the same
 * request as the panel's own new tab, so the page joins the one set of tabs.
 */
export function openLinkInBrowser(url: string): void {
  openPanel("builtin-browser");
  void openBrowserTab(url);
}

/** Brings a tab to the front here at once; the server's next registry snapshot confirms it. */
export function activateBrowserTab(tabId: number): void {
  dispatchBrowser({ type: "activated", tabId });
  void api.activateBuiltinBrowserTab(tabId).catch(() => undefined);
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
