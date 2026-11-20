/**
 * The import dialog's decisions, kept pure: how the system browsers' profiles are grouped,
 * what the "only these sites" field sends, when a Keychain prompt or Chrome's app-bound
 * encryption is worth a note, what the user's Chrome extension offers, and the request the
 * chosen options make.
 */
import type {
  BuiltinBrowserImportBrowser,
  BuiltinBrowserImportRequest,
  BuiltinBrowserImportResult,
  BuiltinBrowserImportSource,
  BuiltinBrowserImportSourcesResponse,
} from "@prismshadow/penguin-server/api";
import type { ImportExtensionRoute } from "../../lib/browser-import-route";

export type { ImportExtensionRoute };

export interface SourceGroup {
  /** The browser's id, or `extension` for the group of the user's connected Chrome extension. */
  key: BuiltinBrowserImportBrowser | "extension";
  browserName: string;
  sources: BuiltinBrowserImportSource[];
}

/**
 * Profiles grouped under their browser, browsers and profiles in the order the server listed
 * them; the connected Chrome extension in a group of its own.
 */
export function groupSources(sources: readonly BuiltinBrowserImportSource[]): SourceGroup[] {
  const groups: SourceGroup[] = [];
  for (const source of sources) {
    const key = source.via ?? source.browser;
    const group = groups.find((g) => g.key === key);
    if (group !== undefined) group.sources.push(source);
    else groups.push({ key, browserName: source.browserName, sources: [source] });
  }
  return groups;
}

/** What the sources response says of the user's Chrome extension as an import route. */
export function extensionRoute(res: BuiltinBrowserImportSourcesResponse): ImportExtensionRoute {
  if (res.sources.some((s) => s.via === "extension")) return "connected";
  if (res.extension === "extension_not_paired") return "not_paired";
  if (res.extension === "extension_disconnected") return "disconnected";
  return "off";
}

/**
 * Whether importing this profile's cookies on this computer meets Chrome's app-bound
 * encryption (Chrome 127+ on Windows), which keeps most of them from any reader but Chrome.
 */
export function appBoundLikely(userAgent: string, source: BuiltinBrowserImportSource): boolean {
  return /Windows/.test(userAgent) && source.browser === "chrome" && source.via === undefined;
}

/** How many cookies an import left behind under Chrome's app-bound encryption. */
export function appBoundSkips(result: BuiltinBrowserImportResult): number {
  return result.cookies?.skips.find((skip) => skip.reason === "app_bound")?.count ?? 0;
}

/** A source worth offering: it holds something to import. */
export function sourceImportable(source: BuiltinBrowserImportSource): boolean {
  return source.hasCookies || source.hasHistory;
}

/**
 * The "only these sites" field as the request's list, or undefined for every site. Entries
 * are separated by commas, semicolons (full-width ones too, as a CJK keyboard types them) or
 * spaces; a pasted address keeps only its host, and a leading `www.` goes, because a site's
 * sign-in cookies usually sit on the bare domain — a filter of `www.amazon.com` would leave
 * out the `.amazon.com` cookies the user is after.
 */
export function parseDomainFilter(text: string): string[] | undefined {
  const domains: string[] = [];
  for (const raw of text.split(/[\s,;，；]+/)) {
    const host = raw
      .trim()
      .toLowerCase()
      .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
      .replace(/[/?#].*$/, "")
      .replace(/:\d+$/, "")
      .replace(/^\*?\./, "")
      .replace(/^www\./, "")
      .replace(/\.$/, "");
    if (host !== "" && !domains.includes(host)) domains.push(host);
  }
  return domains.length > 0 ? domains : undefined;
}

/**
 * Whether reading this browser's cookies may make macOS ask for Keychain access: every
 * Chromium-family browser keeps its cookie key there; Firefox stores cookies in the clear.
 */
export function keychainPromptLikely(
  userAgent: string,
  browser: BuiltinBrowserImportBrowser,
): boolean {
  return /Macintosh|Mac OS X/.test(userAgent) && browser !== "firefox";
}

/** The request for what is chosen, or null when nothing is (no source, or neither kind of data). */
export function importRequest(
  source: BuiltinBrowserImportSource | null,
  choice: { cookies: boolean; history: boolean; domains: string },
): BuiltinBrowserImportRequest | null {
  if (source === null) return null;
  const cookies = choice.cookies && source.hasCookies;
  const history = choice.history && source.hasHistory;
  if (!cookies && !history) return null;
  const domains = cookies ? parseDomainFilter(choice.domains) : undefined;
  return {
    sourceId: source.id,
    cookies,
    history,
    ...(domains !== undefined ? { domains } : {}),
  };
}
