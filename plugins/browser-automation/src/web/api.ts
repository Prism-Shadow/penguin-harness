/**
 * The agent browser's endpoint wrappers — the desktop's built-in browser, or the user's own
 * Chrome — over the face's `apiFetch`, so they run on the Web App's transport (and its test and
 * gallery stand-ins) without importing the Web App. The gallery's mock coverage check walks this
 * module beside the app's own `api/endpoints.ts`.
 */
import type {
  BuiltinBrowserHistoryResponse,
  BuiltinBrowserImportRequest,
  BuiltinBrowserImportResult,
  BuiltinBrowserImportSourcesResponse,
  BuiltinBrowserSettings,
  BuiltinBrowserStatus,
  BuiltinBrowserTab,
  BrowserBackend,
  BrowserBackendResponse,
  BrowserExtensionPairingResponse,
  BrowserExtensionsResponse,
  DesktopBrowserCommand,
  ServerSettingsResponse,
} from "@prismshadow/penguin-server/api";
import { apiFetch } from "@prismshadow/penguin-web-plugin";

/**
 * Always this server's: the built-in browser's pages live in the desktop shell this server was
 * spawned by, and a user's Chrome is paired to this server, so a machine's browser routes would
 * drive a browser that is not on this screen.
 */
const builtinBrowserPath = (rest: string) => `/api/builtin-browser${rest}`;

/** What the storage-clearing route takes (WebApp's own clear-data command). */
export type BuiltinBrowserStorage = Extract<
  DesktopBrowserCommand,
  { op: "clear-data" }
>["storages"][number];

/**
 * The caller's backend — whether it can be driven now, its tabs — and every backend the server
 * offers them (`backends`).
 */
export const getBuiltinBrowserStatus = () =>
  apiFetch<BuiltinBrowserStatus>(builtinBrowserPath("/status"), { server: null });
/** The caller's backend and the ones they may choose (both only on the desktop, for an admin). */
export const getBrowserBackend = () =>
  apiFetch<BrowserBackendResponse>(builtinBrowserPath("/backend"), { server: null });
/** Chooses the backend; 409 `action_in_flight` while an agent acts in the one being left. */
export const putBrowserBackend = (backend: BrowserBackend) =>
  apiFetch<BrowserBackendResponse>(builtinBrowserPath("/backend"), {
    method: "PUT",
    body: { backend },
    server: null,
  });
/** A one-time pairing code for the signed-in user (ten minutes, one use; a new one replaces it). */
export const createBrowserPairingCode = () =>
  apiFetch<BrowserExtensionPairingResponse>(builtinBrowserPath("/extension/pairings"), {
    method: "POST",
    server: null,
  });
/** The Chromes paired to the caller's account, the connected one, and the admin's switch. */
export const getBrowserExtensions = () =>
  apiFetch<BrowserExtensionsResponse>(builtinBrowserPath("/extension"), { server: null });
/** Forgets a paired Chrome; its connection closes and it must be paired again. */
export const revokeBrowserExtension = (extensionId: string) =>
  apiFetch<void>(builtinBrowserPath(`/extension/${encodeURIComponent(extensionId)}`), {
    method: "DELETE",
    server: null,
  });
/**
 * A new tab, at `url` or else at the homepage (blank without one). The server asks this window
 * (over the user channel) to create the page, and answers once the page is claimed — so this
 * resolves after the tab exists.
 */
export const openBuiltinBrowserTab = (body: {
  url?: string;
  activate?: boolean;
  sessionId?: string;
  projectId?: string;
  /** The machine `sessionId` runs on: this server holds the page for that machine's Session. */
  machineId?: string;
}) =>
  apiFetch<{ tab: BuiltinBrowserTab }>(builtinBrowserPath("/tabs"), {
    method: "POST",
    body,
    server: null,
  });
/** Transfers the built-in pages when a conversation receives a new id. */
export const adoptBuiltinBrowserSession = (fromSessionId: string, sessionId: string) =>
  apiFetch<void>(builtinBrowserPath("/tabs/session"), {
    method: "POST",
    body: { fromSessionId, sessionId },
    server: null,
  });
/** Ties a page this window created to the open request it answers; 409 when another window was first. */
export const claimBuiltinBrowserTab = (requestId: string, tabId: number) =>
  apiFetch<void>(builtinBrowserPath("/tabs/claim"), {
    method: "POST",
    body: { requestId, tabId },
    server: null,
  });
/** The user brought a tab to the front: it is also the one an agent's next command acts on. */
export const activateBuiltinBrowserTab = (tabId: number) =>
  apiFetch<{ tab: BuiltinBrowserTab }>(builtinBrowserPath(`/tabs/${tabId}/activate`), {
    method: "POST",
    server: null,
  });
/** The tab this window shows on screen, or none: the server leaves that one unthrottled. */
export const setBuiltinBrowserOnScreen = (tabId: number | null) =>
  apiFetch<void>(builtinBrowserPath("/tabs/on-screen"), {
    method: "POST",
    body: { tabId },
    server: null,
  });
export const closeBuiltinBrowserTab = (tabId: number) =>
  apiFetch<void>(builtinBrowserPath(`/tabs/${tabId}`), { method: "DELETE", server: null });
/**
 * Loads `url` in a tab through the server, and answers once it loaded: the address bar of a tab
 * this window does not host (one in the user's Chrome).
 */
export const navigateBuiltinBrowserTab = (tabId: number, url: string) =>
  apiFetch<{ tab: BuiltinBrowserTab }>(builtinBrowserPath(`/tabs/${tabId}/navigate`), {
    method: "POST",
    body: { url },
    server: null,
  });
/** The system browsers' profiles on this computer that can be imported from. */
export const getBuiltinBrowserImportSources = () =>
  apiFetch<BuiltinBrowserImportSourcesResponse>(builtinBrowserPath("/import/sources"), {
    server: null,
  });
export const importIntoBuiltinBrowser = (body: BuiltinBrowserImportRequest) =>
  apiFetch<BuiltinBrowserImportResult>(builtinBrowserPath("/import"), {
    method: "POST",
    body,
    server: null,
  });
/** The browser's settings — its homepage. The server's own file: no desktop shell needed. */
export const getBuiltinBrowserSettings = () =>
  apiFetch<BuiltinBrowserSettings>(builtinBrowserPath("/settings"), { server: null });
/** Replaces them; answers them as stored (a bare host given its scheme). */
export const putBuiltinBrowserSettings = (settings: BuiltinBrowserSettings) =>
  apiFetch<BuiltinBrowserSettings>(builtinBrowserPath("/settings"), {
    method: "PUT",
    body: settings,
    server: null,
  });
/** History matching `q` (address and title), most visited first. */
export const searchBuiltinBrowserHistory = (q: string, limit: number) =>
  apiFetch<BuiltinBrowserHistoryResponse>(builtinBrowserPath("/history"), {
    query: { q, limit },
    server: null,
  });
export const clearBuiltinBrowserHistory = () =>
  apiFetch<void>(builtinBrowserPath("/history"), { method: "DELETE", server: null });
export const clearBuiltinBrowserData = (
  storages: BuiltinBrowserStorage[],
  scope: { sessionId?: string; projectId?: string } = {},
) =>
  apiFetch<void>(builtinBrowserPath("/clear-data"), {
    method: "POST",
    body: { storages, ...scope },
    server: null,
  });

/**
 * The admin's switch over users' Chromes (`browserExtensionsEnabled` in the server settings),
 * which stays a server setting of the host: read and written through its admin settings route.
 */
export const getExtensionsSwitch = () => apiFetch<ServerSettingsResponse>("/api/admin/settings");
export const putExtensionsSwitch = (enabled: boolean) =>
  apiFetch<ServerSettingsResponse>("/api/admin/settings", {
    method: "PUT",
    body: { browserExtensionsEnabled: enabled },
  });

export interface ManagedBrowserGroup {
  machineId: string | null;
  projectId: string;
  sessionId: string;
}

function managedTabsPath(group: ManagedBrowserGroup): string {
  return builtinBrowserPath(
    `/projects/${encodeURIComponent(group.projectId)}/session-resources/${encodeURIComponent(group.sessionId)}/tabs`,
  );
}

export const listManagedPages = (group: ManagedBrowserGroup) =>
  apiFetch<{ tabs: BuiltinBrowserTab[] }>(managedTabsPath(group), { server: group.machineId });
export const openManagedPage = (group: ManagedBrowserGroup, url?: string) =>
  apiFetch<{ tab: BuiltinBrowserTab }>(managedTabsPath(group), {
    server: group.machineId,
    method: "POST",
    body: url ? { url } : {},
  });
export const closeManagedPage = (group: ManagedBrowserGroup, id: number) =>
  apiFetch<void>(`${managedTabsPath(group)}/${id}`, { server: group.machineId, method: "DELETE" });
export const activateManagedPage = (group: ManagedBrowserGroup, id: number) =>
  apiFetch<void>(`${managedTabsPath(group)}/${id}/activate`, {
    server: group.machineId,
    method: "POST",
    body: {},
  });
