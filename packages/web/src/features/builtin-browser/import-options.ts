/**
 * The import dialog's decisions, kept pure: how the system browsers' profiles are grouped,
 * what the "only these sites" field sends, when a Keychain prompt is worth warning about,
 * and the request the chosen options make.
 */
import type {
  BuiltinBrowserImportBrowser,
  BuiltinBrowserImportRequest,
  BuiltinBrowserImportSource,
} from "@prismshadow/penguin-server/api";

export interface SourceGroup {
  browser: BuiltinBrowserImportBrowser;
  browserName: string;
  sources: BuiltinBrowserImportSource[];
}

/** Profiles grouped under their browser, browsers and profiles in the order the server listed them. */
export function groupSources(sources: readonly BuiltinBrowserImportSource[]): SourceGroup[] {
  const groups: SourceGroup[] = [];
  for (const source of sources) {
    const group = groups.find((g) => g.browser === source.browser);
    if (group !== undefined) group.sources.push(source);
    else
      groups.push({ browser: source.browser, browserName: source.browserName, sources: [source] });
  }
  return groups;
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
