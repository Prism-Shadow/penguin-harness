/**
 * What the extension refuses on its own, whatever a server asks. The server applies the same
 * rules first (its `browserUrl` check and raw-CDP deny list); these hold even against a server
 * that does not, so a paired server can never reach the user's cookies, files or other tabs
 * through this extension.
 */

/** Pages Chrome does not let an extension debug, or that the agent must never touch. */
const RESTRICTED_SCHEMES = new Set([
  "chrome:",
  "chrome-extension:",
  "chrome-untrusted:",
  "chrome-search:",
  "devtools:",
  "edge:",
  "view-source:",
  "file:",
]);

const WEB_STORE_HOSTS = new Set(["chromewebstore.google.com"]);

/** True for a URL whose page the extension must not attach to. An empty URL is not restricted. */
export function isRestrictedUrl(url: string | undefined): boolean {
  if (url === undefined || url === "") return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return true;
  }
  if (RESTRICTED_SCHEMES.has(parsed.protocol)) return true;
  if (WEB_STORE_HOSTS.has(parsed.hostname)) return true;
  return parsed.hostname === "chrome.google.com" && parsed.pathname.startsWith("/webstore");
}

/** Where `open-tab` and `Page.navigate` may go: the web and a blank page, nothing local. */
export function isNavigableUrl(url: unknown): url is string {
  if (typeof url !== "string") return false;
  if (url === "about:blank") return true;
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * CDP domains and methods never relayed: the browser-wide ones (targets, the browser, storage,
 * request interception) and the cookie store, as in the server's deny list; plus three that
 * would read or write the user's disk (a file input fed from local paths, downloads to a chosen
 * directory) or switch off certificate checks.
 */
const REFUSED_DOMAINS = new Set([
  "Target",
  "Browser",
  "Storage",
  "Fetch",
  "Extensions",
  "Tethering",
  "Security",
]);

const REFUSED_METHODS = new Set([
  "Network.getAllCookies",
  "Network.getCookies",
  "Network.setCookie",
  "Network.setCookies",
  "Network.deleteCookies",
  "Network.clearBrowserCookies",
  "Network.setRequestInterception",
  "DOM.setFileInputFiles",
  "Page.setDownloadBehavior",
]);

export function isRefusedCdpMethod(method: string): boolean {
  const domain = method.split(".", 1)[0] ?? "";
  return REFUSED_DOMAINS.has(domain) || REFUSED_METHODS.has(method);
}
