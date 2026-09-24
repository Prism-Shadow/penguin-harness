/**
 * The built-in browser's rules in the shell — pure, no Electron imports (unit-tested).
 * builtin-browser.ts applies them to the <webview> guests it hosts.
 *
 * Everything here is mechanism: which guests may attach and with what preferences, which
 * navigations a guest may make, the user agent sites see, how a relayed frame is read, which
 * permission prompts a page gets, and the guests' right-click menu. What the browser does with
 * its pages — the page scripts, the tab registry, import — is the server platform's
 * (packages/server/src/builtin-browser), delivered by push.
 */
import type {
  DesktopBrowserCommand,
  DesktopBrowserCommandMessage,
  DesktopBrowserCookie,
} from "@prismshadow/penguin-server/api";
import type { TrayLocale } from "./tray-menu.js";

/** The guests' own session: independent sign-ins and profile, persisted under userData. */
export const BUILTIN_BROWSER_PARTITION = "persist:penguin-browser";

/** What the shell answers `hello` with; the server learns from it that this shell hosts guests. */
export const BUILTIN_BROWSER_PROTOCOL_VERSION = 1;

function schemeOf(url: string): string | null {
  const match = /^([a-z][a-z0-9+.-]*):/i.exec(url.trim());
  return match === null ? null : match[1]!.toLowerCase();
}

/**
 * Whether a <webview> may attach at all: only in the browser's partition, and only starting on
 * a web page or a blank one. An element with no `src` yet starts blank, which is harmless.
 */
export function mayAttachGuest(params: { partition?: string; src?: string }): boolean {
  if (params.partition !== BUILTIN_BROWSER_PARTITION) return false;
  const src = params.src ?? "";
  if (src === "" || src === "about:blank") return true;
  const scheme = schemeOf(src);
  return scheme === "http" || scheme === "https";
}

/**
 * Forces a guest's webPreferences into the one hardened shape, whatever the element's
 * attributes asked for: the browser's partition (a `webpreferences` attribute is spread over
 * the one `partition` set), no preload and no Node, isolated and sandboxed, web security on,
 * no nested <webview>, and no background throttling — the agent works in tabs nobody is
 * looking at. Mutates, as `will-attach-webview` expects.
 *
 * Popups are let through to the guest's window-open handler (`disablePopups: false`, which is
 * what the `allowpopups` attribute would set): with them disabled Chromium refuses window.open
 * and target=_blank before any handler runs, so a popup could never become a tab. The handler
 * then denies every one of them (builtin-browser.ts), so no guest ever opens a window.
 */
export function hardenGuestPreferences(prefs: Record<string, unknown>): void {
  prefs.partition = BUILTIN_BROWSER_PARTITION;
  delete prefs.preload;
  delete prefs.preloadURL;
  prefs.nodeIntegration = false;
  prefs.nodeIntegrationInSubFrames = false;
  prefs.nodeIntegrationInWorker = false;
  prefs.contextIsolation = true;
  prefs.sandbox = true;
  prefs.webSecurity = true;
  prefs.allowRunningInsecureContent = false;
  prefs.webviewTag = false;
  prefs.backgroundThrottling = false;
  prefs.disablePopups = false;
}

/** Schemes a guest's main frame may navigate to on its own (a link, a form, script). */
const NAVIGABLE_SCHEMES = new Set(["http", "https", "about", "data", "blob"]);

export function mayNavigate(url: string): boolean {
  const scheme = schemeOf(url);
  return scheme !== null && NAVIGABLE_SCHEMES.has(scheme);
}

/**
 * The favicon a tab reports: the page's first one that is small enough to ride every tab event
 * (a `data:` icon can be arbitrarily large). None rather than a truncated one.
 */
export function pickFavicon(favicons: readonly string[]): string | undefined {
  return favicons.find((url) => url.length > 0 && url.length <= 16 * 1024);
}

/** A popup, or a link opened in a new tab, becomes a tab only for a web page. */
export function isOpenableUrl(url: string): boolean {
  const scheme = schemeOf(url);
  return scheme === "http" || scheme === "https";
}

/**
 * The user agent sites see: Chrome's own. Electron's default adds an `Electron/x.y.z` token
 * and the app's `<name>/<version>` between `(KHTML, like Gecko)` and `Chrome/`; some sites
 * refuse or degrade an embedded browser they can name, so both go. The app name may contain
 * spaces (a dev build's "… Dev"), hence everything between the two anchors is dropped rather
 * than one token.
 */
export function plainChromeUserAgent(userAgent: string): string {
  return userAgent
    .replace(/\s+Electron\/\S+/g, "")
    .replace(/(\(KHTML, like Gecko\))(?:\s+(?!Chrome\/)\S+)+(?=\s+Chrome\/)/, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Electron's `clearStorageData` storage names (WebSQL is gone from Chromium, and from the list). */
export type StorageDataName =
  | "cookies"
  | "filesystem"
  | "indexdb"
  | "localstorage"
  | "shadercache"
  | "serviceworkers"
  | "cachestorage";

/** The `clearStorageData` names behind each of the protocol's storage categories. */
const STORAGE_DATA: Record<"cookies" | "storage", StorageDataName[]> = {
  cookies: ["cookies"],
  storage: [
    "filesystem",
    "indexdb",
    "localstorage",
    "shadercache",
    "serviceworkers",
    "cachestorage",
  ],
};

/** What a `clear-data` command does, or null when it names something that is not a category. */
export function clearDataPlan(
  storages: unknown,
): { storageData: StorageDataName[]; cache: boolean } | null {
  if (!Array.isArray(storages) || storages.length === 0) return null;
  const storageData: StorageDataName[] = [];
  let cache = false;
  for (const storage of storages as unknown[]) {
    if (storage === "cache") cache = true;
    else if (storage === "cookies" || storage === "storage") {
      storageData.push(...STORAGE_DATA[storage]);
    } else return null;
  }
  return { storageData: [...new Set(storageData)], cache };
}

/**
 * The permission prompts a page in the browser is granted without asking. Electron grants
 * every request by default, which for pages from the open web would mean a silent camera,
 * microphone, location or notification grant; everything outside this list is refused.
 * The ones kept are what a page needs to work at all: fullscreen video, pointer and keyboard
 * lock in web apps, writing to the clipboard, and storage access for sign-ins spread over
 * several sites.
 */
const GRANTED_PERMISSIONS = new Set([
  "fullscreen",
  "pointerLock",
  "keyboardLock",
  "clipboard-sanitized-write",
  "storage-access",
  "top-level-storage-access",
]);

export function isGrantedPermission(permission: string): boolean {
  return GRANTED_PERMISSIONS.has(permission);
}

// --- the relay ---------------------------------------------------------------

/** One frame read off the port: a command to run, or one that cannot be (answered with the error). */
export type ParsedBrowserCommand =
  { id: string; command: DesktopBrowserCommand } | { id: string; error: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function isCookie(value: unknown): value is DesktopBrowserCookie {
  return (
    isRecord(value) &&
    typeof value.url === "string" &&
    typeof value.name === "string" &&
    typeof value.value === "string"
  );
}

/**
 * Reads one server frame. Null when it is not a browser command at all (another relay's frame),
 * and an `error` when it is one this shell cannot run — every command is answered, so the
 * server never waits out a timeout on a frame the shell understood to be for it.
 */
export function parseBrowserCommand(data: unknown): ParsedBrowserCommand | null {
  if (!isRecord(data)) return null;
  const msg = data as Partial<DesktopBrowserCommandMessage>;
  if (msg.type !== "desktop-browser-command" || typeof msg.id !== "string") return null;
  const { id } = msg;
  const command = msg.command as unknown;
  if (!isRecord(command)) return { id, error: "bad_command" };
  switch (command.op) {
    case "hello":
      return { id, command: { op: "hello" } };
    case "tabs":
      return { id, command: { op: "tabs" } };
    case "cdp": {
      const { tabId, method, params } = command;
      if (typeof tabId !== "number" || typeof method !== "string" || method === "") {
        return { id, error: "bad_command" };
      }
      if (params !== undefined && !isRecord(params)) return { id, error: "bad_command" };
      return { id, command: { op: "cdp", tabId, method, ...(params ? { params } : {}) } };
    }
    case "set-cookies": {
      const { cookies } = command;
      if (!Array.isArray(cookies) || !cookies.every(isCookie)) return { id, error: "bad_command" };
      return { id, command: { op: "set-cookies", cookies } };
    }
    case "clear-data": {
      const plan = clearDataPlan(command.storages);
      if (plan === null) return { id, error: "bad_command" };
      return {
        id,
        command: {
          op: "clear-data",
          storages: command.storages as ("cookies" | "cache" | "storage")[],
        },
      };
    }
    default:
      return { id, error: "unknown_op" };
  }
}

// --- the guests' context menu ------------------------------------------------

/** What a guest's context-menu entry does when it is clicked. */
export type GuestMenuAction =
  | "back"
  | "forward"
  | "reload"
  | "open-link"
  | "copy-link"
  | "copy-image-address"
  | "cut"
  | "copy"
  | "paste"
  | "select-all"
  | "inspect"
  | "devtools";

export interface GuestMenuItem {
  action?: GuestMenuAction;
  label?: string;
  /** Absent means enabled. */
  enabled?: boolean;
  type?: "separator";
}

/** What the menu is built from: Electron's ContextMenuParams, reduced to what it reads, plus the tab's history. */
export interface GuestMenuInput {
  locale: TrayLocale;
  x: number;
  y: number;
  linkURL: string;
  srcURL: string;
  mediaType: string;
  isEditable: boolean;
  selectionText: string;
  editFlags: { canCut: boolean; canCopy: boolean; canPaste: boolean; canSelectAll: boolean };
  canGoBack: boolean;
  canGoForward: boolean;
}

interface GuestMenuLabels {
  back: string;
  forward: string;
  reload: string;
  openLink: string;
  copyLink: string;
  copyImageAddress: string;
  cut: string;
  copy: string;
  paste: string;
  selectAll: string;
  inspect: string;
  devtools: string;
}

/**
 * Written here rather than read from the Web App's catalogs for the tray's reason (see
 * tray-menu.ts): the shell cannot import from packages/web. The wording is Chrome's own in
 * both languages, since that is the menu people know.
 */
export const GUEST_MENU_LABELS: Record<TrayLocale, GuestMenuLabels> = {
  en: {
    back: "Back",
    forward: "Forward",
    reload: "Reload",
    openLink: "Open link in new tab",
    copyLink: "Copy link address",
    copyImageAddress: "Copy image address",
    cut: "Cut",
    copy: "Copy",
    paste: "Paste",
    selectAll: "Select all",
    inspect: "Inspect",
    devtools: "Open DevTools",
  },
  zh: {
    back: "返回",
    forward: "前进",
    reload: "重新加载",
    openLink: "在新标签页中打开链接",
    copyLink: "复制链接地址",
    copyImageAddress: "复制图片地址",
    cut: "剪切",
    copy: "复制",
    paste: "粘贴",
    selectAll: "全选",
    inspect: "检查",
    devtools: "打开开发者工具",
  },
};

/**
 * A guest's right-click menu, with only the entries that apply where the click landed, grouped
 * the way Chrome groups them: the link, the image, the text (edit commands in a field, Copy
 * over a selection), or — on the page itself — Back / Forward / Reload. DevTools closes every
 * menu: Inspect at the click, or Open DevTools when the click has no position to inspect.
 */
export function guestContextMenu(input: GuestMenuInput): GuestMenuItem[] {
  const t = GUEST_MENU_LABELS[input.locale];
  const groups: GuestMenuItem[][] = [];
  if (input.linkURL !== "") {
    groups.push([
      ...(isOpenableUrl(input.linkURL)
        ? [{ action: "open-link" as const, label: t.openLink }]
        : []),
      { action: "copy-link", label: t.copyLink },
    ]);
  }
  if (input.mediaType === "image" && input.srcURL !== "") {
    groups.push([{ action: "copy-image-address", label: t.copyImageAddress }]);
  }
  const edit: GuestMenuItem[] = [];
  const flags = input.editFlags;
  if (input.isEditable) {
    if (flags.canCut) edit.push({ action: "cut", label: t.cut });
    if (flags.canCopy) edit.push({ action: "copy", label: t.copy });
    if (flags.canPaste) edit.push({ action: "paste", label: t.paste });
    if (flags.canSelectAll) edit.push({ action: "select-all", label: t.selectAll });
  } else if (input.selectionText.trim() !== "" && flags.canCopy) {
    edit.push({ action: "copy", label: t.copy });
  }
  if (edit.length > 0) groups.push(edit);
  if (groups.length === 0) {
    groups.push([
      { action: "back", label: t.back, ...(input.canGoBack ? {} : { enabled: false }) },
      { action: "forward", label: t.forward, ...(input.canGoForward ? {} : { enabled: false }) },
      { action: "reload", label: t.reload },
    ]);
  }
  const positioned = Number.isFinite(input.x) && Number.isFinite(input.y);
  groups.push([
    positioned
      ? { action: "inspect", label: t.inspect }
      : { action: "devtools", label: t.devtools },
  ]);
  return groups.flatMap((group, i) =>
    i === 0 ? group : [{ type: "separator" as const }, ...group],
  );
}
