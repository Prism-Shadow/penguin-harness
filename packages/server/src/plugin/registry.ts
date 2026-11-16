/**
 * Plugin registries: WHERE plugin index entries come from. A registry is one source
 * of `PluginIndexEntry` rows — the shared index format every registry speaks (see
 * api/types.ts; the schema follows typst/packages' `index.json`: a flat array of
 * per-version entries). Discovery only: a Project asks for an entry on the Plugins page
 * (http/routes/plugins-installed.ts), and nothing here imports plugin code.
 *
 * Two implementations, one contract:
 *   - the builtin registry serves the index embedded in this package
 *     (builtin-index.json — the four sandbox backends the workspace ships, each row carrying
 *     the descriptions of the package's own card contribution and its icon, so its card renders
 *     on a server the package is not installed on);
 *   - the HTTP registry fetches an `index.json` URL and runs it through the same
 *     validator, so a remote index is trusted no further than the embedded one — and less
 *     in one respect: its entries lose their `icon`, an SVG this server would serve as its own
 *     image, which only what ships with this server may supply (the embedded index, and a
 *     package's own icon on this machine, see localPluginDisplay).
 *
 * A deployment's list is the builtin registry plus the published index (see
 * NIGHTLY_INDEX_URL), merged in http/routes/plugins.ts.
 */
import type { PluginIndexEntry } from "../api/types.js";
import builtinIndex from "./builtin-index.json" with { type: "json" };
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import type { IconImage } from "@prismshadow/penguin-core";
import {
  compareVersions,
  normalizeVersion,
  readPackageCard,
  userAgent,
} from "@prismshadow/penguin-core";
import safeRegex from "safe-regex";
import { indexMirrorRules } from "./mirror-settings.js";
import { resolvePluginPackage } from "./loader.js";
import type { PluginBase } from "./loader.js";

/**
 * One row of an index document, as a registry hands it out: the listing's entry, except that its
 * icon, when it has one, is raw SVG text. Only the index embedded in this server keeps one (see
 * parsePluginIndex); the listing reads it the way it reads a package's icon file and names it by
 * the URL it is served at (http/routes/plugins.ts).
 */
export type IndexDocumentEntry = Omit<PluginIndexEntry, "icon"> & { icon?: string };

/** One source of plugin index entries; `source` identifies it for display and errors. */
export interface PluginRegistry {
  readonly source: string;
  index(): Promise<IndexDocumentEntry[]>;
  /**
   * Long-form documentation for one entry, or null when this source has none for it.
   *
   * Separate from `index` because the shapes differ: the index is a listing sent in full
   * on every page load, a readme is large and wanted only for the entry someone opened.
   */
  readme(name: string): Promise<string | null>;
  /**
   * What this source can answer without waiting on the network: the document in hand, or the
   * failure it remembers; null while a read is still out (one is started if none is). Absent on a
   * source that never waits on the network — the builtin index — which is simply read.
   */
  inHand?(): Promise<IndexDocumentEntry[]> | null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

/** Validates one raw entry; returns null instead of throwing so the caller can name the index position. */
function asIndexEntry(value: unknown): IndexDocumentEntry | null {
  if (typeof value !== "object" || value === null) return null;
  const e = value as Record<string, unknown>;
  if (
    typeof e.name !== "string" ||
    typeof e.version !== "string" ||
    typeof e.description !== "string" ||
    !isStringArray(e.authors) ||
    typeof e.license !== "string"
  ) {
    return null;
  }
  for (const key of [
    "title",
    "titleZh",
    "repository",
    "homepage",
    "descriptionZh",
    "shortDescription",
    "shortDescriptionZh",
    "icon",
  ] as const) {
    if (e[key] !== undefined && typeof e[key] !== "string") return null;
  }
  for (const key of ["keywords", "categories"] as const) {
    if (e[key] !== undefined && !isStringArray(e[key])) return null;
  }
  if (e.updatedAt !== undefined && typeof e.updatedAt !== "number") return null;
  // The release pin and its channels ride the row like any other field: an index that
  // carries them is malformed when they are not well-formed, and the install face
  // decides what a well-formed row's channel is worth (registry.ts, indexChannelOf).
  if (
    e.integrity !== undefined &&
    (typeof e.integrity !== "string" || !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(e.integrity))
  ) {
    return null;
  }
  if (e.channels !== undefined) {
    if (!Array.isArray(e.channels)) return null;
    for (const channel of e.channels) {
      if (typeof channel !== "object" || channel === null) return null;
      const c = channel as Record<string, unknown>;
      if (typeof c.kind !== "string" || c.kind === "" || typeof c.url !== "string") return null;
    }
  }
  return value as IndexDocumentEntry;
}

/**
 * Validates a whole index document. Strict, not per-entry-tolerant: an index is one
 * publisher's single artifact, so a malformed row means the artifact is broken —
 * unlike a Project's plugin list, whose entries are independent choices skipped one
 * by one.
 *
 * `icons: "drop"` is for a document from the network: this server would serve an entry's icon
 * as an image of its own, so a remote entry's is removed. Removed rather than refused — the
 * rest of the row still lists, under the puzzle piece.
 */
export function parsePluginIndex(
  data: unknown,
  source: string,
  { icons = "keep" }: { icons?: "keep" | "drop" } = {},
): IndexDocumentEntry[] {
  if (!Array.isArray(data)) {
    throw new Error(`plugin index from ${source} is not an array`);
  }
  return data.map((raw, i) => {
    const entry = asIndexEntry(raw);
    if (entry === null) {
      throw new Error(`plugin index from ${source} has a malformed entry at index ${i}`);
    }
    return icons === "drop" ? withoutIcon(entry) : entry;
  });
}

/** An index entry with no `icon`: what a remote source's entry becomes (see parsePluginIndex). */
export function withoutIcon(entry: IndexDocumentEntry): IndexDocumentEntry {
  if (!("icon" in entry)) return entry;
  const { icon: _dropped, ...rest } = entry;
  return rest;
}

export const BUILTIN_REGISTRY_SOURCE = "builtin";

/**
 * The registry embedded in this package: the workspace's own plugin packages. The index is
 * the listing; a readme is the package's own README.md, read from wherever the package is on
 * this machine (`bases`: the shipped prefix, the data root's, the installation) — the file
 * npm shipped with it, never a second copy. A listed package that is not on this machine
 * has none to show.
 */
export function builtinPluginRegistry(
  bases: () => readonly PluginBase[] = () => [],
): PluginRegistry {
  return {
    source: BUILTIN_REGISTRY_SOURCE,
    // Validated like any other source: a broken embedded index should fail loudly
    // in tests rather than serve garbage.
    index: () => Promise.resolve(parsePluginIndex(builtinIndex, BUILTIN_REGISTRY_SOURCE)),
    readme: async (name) => {
      const found = resolvePluginPackage(name, bases());
      if (found === null) return null;
      try {
        return await fs.readFile(path.join(found.dir, "README.md"), "utf8");
      } catch {
        return null;
      }
    },
  };
}

/** The display fields an index entry may carry, which a package can also carry itself: its card's, and its icon. */
export type PluginDisplay = Pick<
  PluginIndexEntry,
  "title" | "titleZh" | "descriptionZh" | "shortDescription" | "shortDescriptionZh"
> & { icon?: IconImage };

/** An index entry's github channel, as the install face installs it: pinned bytes at a URL. */
export interface IndexChannel {
  name: string;
  version: string;
  integrity: string;
  url: string;
  /**
   * The same asset behind this source's CDN mirrors, tried in order when `url` is
   * unreachable; absent when the deployment carries no rewrite rules for it.
   */
  mirrors?: string[];
}

/**
 * What an entry's github channel is worth for an install: the channel when the entry pins
 * its asset and the channel is one the install face fetches; a `fault` sentence when a
 * channel is listed but the row does not pin it (there is nothing to verify against —
 * the refusal says so rather than installing unverified bytes); channel null without a
 * fault when the entry simply has no github channel (the caller's npm error stands).
 */
export function indexChannelOf(entry: IndexDocumentEntry): {
  channel: IndexChannel | null;
  fault: string | null;
} {
  const listed = entry.channels?.find((c) => c.kind === "github");
  if (listed === undefined) return { channel: null, fault: null };
  if (entry.integrity === undefined) {
    return {
      channel: null,
      fault: `${entry.name}'s index entry lists a github release channel but pins no sha512 integrity, so its bytes cannot be verified; it is not installable.`,
    };
  }
  // Plain http is refused everywhere but the loopback: a self-hosted index on this very
  // machine serves its assets locally too, and the sha512 the entry pins is what actually
  // guards the bytes — a man in the middle on any http hop cannot make a tampered tarball
  // match. Off the machine the channel is https, no exceptions.
  if (
    !listed.url.startsWith("https://") &&
    !/^http:\/\/(127\.0\.0\.1|localhost|\[::1\])([:/]|$)/.test(listed.url)
  ) {
    return {
      channel: null,
      fault: `${entry.name}'s github channel is not an https link; it is not installable.`,
    };
  }
  return {
    channel: {
      name: entry.name,
      version: entry.version,
      integrity: entry.integrity,
      url: listed.url,
    },
    fault: null,
  };
}

/**
 * Picks which of a name's index entries an install takes its github channel from. The index
 * lists one row per version, so a name may carry several; the requested version — the very
 * string npm failed on, a bare range in npm's own shape — decides among them:
 *
 *   - no version at all, or npm's `latest`: the newest version the index carries;
 *   - an exact version (a leading `v` tolerated): the entry that names it;
 *   - `^x.y.z`: the newest entry in the same major at or above the requested version;
 *   - `~x.y.z`: the newest entry in the same major.minor at or above it;
 *
 * Anything else npm accepts — a dist-tag other than `latest`, a compound range — is refused
 * with the versions the index does carry, rather than guessed at: refusing sends the user a
 * sentence they can act on, guessing installs a version nobody asked for. The chosen entry's
 * channel is then worth exactly what indexChannelOf says it is (a row without its integrity
 * pin faults there, and that fault is the answer).
 */
export function selectIndexChannel(
  entries: readonly IndexDocumentEntry[],
  version: string | undefined,
): { channel: IndexChannel | null; fault: string | null } {
  if (entries.length === 0) return { channel: null, fault: null };
  const newest = (pool: readonly IndexDocumentEntry[]) =>
    pool.reduce((a, b) => (compareVersions(b.version, a.version) > 0 ? b : a));
  const tag =
    version === undefined || version.trim() === "" ? null : normalizeVersion(version.trim());
  if (tag === null || tag === "latest") {
    return indexChannelOf(newest(entries));
  }
  const noMatch = (): { channel: null; fault: string } => ({
    channel: null,
    fault: `${entries[0]!.name} is published on a github release channel, but no version of it matches ${version}; the index carries ${entries.map((e) => e.version).join(", ")}.`,
  });
  const range = /^([\^~])?(\d+)\.(\d+)(?:\.(\d+))?(?:[-+].*)?$/.exec(tag);
  if (range !== null && range[1] !== undefined) {
    const [op, major, minor] = [range[1], range[2], range[3]];
    // The comparison runs against the numeric part alone: compareVersions reads a caret as
    // no version at all, and the caret's work — the major constraint — is the filter above.
    const floor = tag.slice(op.length);
    const matching = entries.filter((e) => {
      const [entryMajor, entryMinor] = normalizeVersion(e.version).split(".");
      return (
        entryMajor === major &&
        (op === "~" ? entryMinor === minor : true) &&
        compareVersions(e.version, floor) >= 0
      );
    });
    if (matching.length === 0) return noMatch();
    return indexChannelOf(newest(matching));
  }
  const exact = entries.find((e) => normalizeVersion(e.version) === tag);
  if (exact !== undefined) return indexChannelOf(exact);
  if (range !== null) return noMatch();
  return {
    channel: null,
    fault: `${entries[0]!.name} can be installed from its github release channel by version only, not by the tag or range ${version}; name a version, or none for the newest.`,
  };
}

/**
 * Answers one package name's github channel from the configured index sources — the entry whose
 * version the requested one (when the caller has one) selects — fetched at most once
 * per TTL (the same cadence the Plugins page reads at) and consulted only when npm has
 * already failed on the name — installs are rare, so no standing fetch. The sources are read
 * in the configured order and their rows are concatenated, the first source's row for a
 * `name@version` staying the one the selection sees. A source that is down contributes no
 * rows: the npm failure is the news then, not the index's silence.
 */
export function indexChannelLookup(
  readUrls: () => readonly string[],
  { fetchImpl = fetch, ttlMs = INDEX_CACHE_TTL_MS, now = Date.now } = {},
): (
  name: string,
  version?: string,
) => Promise<{ channel: IndexChannel | null; fault: string | null }> {
  // Every version the index carries for a name, not one row per name: the request's version
  // is what picks among them (selectIndexChannel), and collapsing to one row per name would
  // make the index's last-listed version the only one a channel could serve.
  let cache: {
    at: number;
    urls: string;
    byName: Map<string, IndexDocumentEntry[]>;
  } | null = null;
  return async (name, version) => {
    const urls = readUrls();
    if (urls.length === 0) return { channel: null, fault: null };
    const at = now();
    if (cache === null || at - cache.at > ttlMs || cache.urls !== urls.join(" ")) {
      // The sources merge first-come-first-served, as the listing's mergeIndexes does: the
      // first source to register a name provides every row for it — the whole entry rides
      // that first registration, no field merging — and a later source listing the same
      // name contributes nothing. The registration happens per SOURCE, not per row, so a
      // source's own several versions of a package all land (the request's version picks
      // among them, as selectIndexChannel does for a single-source index); a source that
      // answers nothing registers nothing, so the next source to actually list the name is
      // the one whose rows answer.
      const rows: IndexDocumentEntry[] = [];
      const mirrors = indexMirrorRules();
      const registered = new Set<string>();
      for (const url of urls) {
        try {
          const fromSource = await httpPluginRegistry(
            [url, ...pluginProxyMirrors(url, mirrors)],
            { fetchImpl },
          ).index();
          const fresh = fromSource.filter((entry) => !registered.has(entry.name));
          for (const entry of fresh) registered.add(entry.name);
          rows.push(...fresh);
        } catch {
          // A dead source shortens the rows this lookup sees; it does not fail the lookup.
        }
      }
      const byName = new Map<string, IndexDocumentEntry[]>();
      for (const entry of rows) {
        const same = byName.get(entry.name);
        if (same === undefined) byName.set(entry.name, [entry]);
        else same.push(entry);
      }
      cache = { at, urls: urls.join(" "), byName };
    }
    const pool = cache.byName.get(name);
    if (pool === undefined) return { channel: null, fault: null };
    const picked = selectIndexChannel(pool, version);
    if (picked.channel !== null) {
      const mirrors = pluginProxyMirrors(picked.channel.url, indexMirrorRules());
      if (mirrors.length > 0) picked.channel = { ...picked.channel, mirrors };
    }
    return picked;
  };
}

/**
 * One proxy rule, Cloudflare-rewrite shaped: `match` is a JS regex over the whole URL,
 * `rewrite` is the result — the URL with everything `match` captured replaced by `rewrite`
 * (`$1`, `$2`, … name the captures, `String.replace` semantics). Rules are tried in order
 * against a URL; every matching rule contributes the address it rewrites to, and the
 * canonical URL stays first in the caller's try order — a rule never replaces it.
 *
 * `kind` is the rule's type, "rewrite" today — a rule that maps one URL shape onto another.
 * Both fetches of the plugin chain (the index document, a version's release asset) are
 * rewritten by the same rules: the `match` pattern, not a kind, is what decides which URLs
 * a rule applies to. A rule of another kind is not a rewrite and is skipped here; the
 * config parse refuses it, so reaching this point means the rule list was hand-built.
 */
/**
 * A rewrite pattern can only ever match one URL, so its length is bounded by the URL
 * length the web itself allows — Firefox's 65,536-character limit, the largest of the
 * mainstream browsers. Anything a URL can carry, the pattern may name; refused at parse.
 */
export const REWRITE_PATTERN_MAX = 65536;
/** The rule list a deployment carries; more than this is a misconfiguration, not a proxy. */
export const PROXY_RULES_MAX = 32;

export interface PluginProxyRule {
  /** The rule's type; "rewrite" maps a URL onto another shape via `match` and `rewrite`. */
  kind: "rewrite";
  /** A JS regex over the whole URL; the rule applies when it matches. */
  match: string;
  /** The result address; `$1`–`$9` are the match's capture groups. */
  rewrite: string;
}

/**
 * What a rewrite rule must answer for before it runs, once at config parse. A plain JS
 * `RegExp` has no per-match timeout: a pattern with catastrophic backtracking (`(a+)+`
 * and friends) run against a URL from the network — the index document is remote, so the
 * strings the rules run over are half attacker-chosen — would pin the server for the
 * length of the backtracking, which is the ReDoS denial of service. `safe-regex` reads
 * the pattern's shape and answers whether its worst case stays linear; a pattern it
 * distrusts never reaches a fetch. The static read is conservative — it may refuse a
 * pattern a linear engine would have run — and that is the right side to be wrong on:
 * a refused rule is a boot-time sentence, a hung one is a fetch that never ends.
 */
export function rewriteRuleRisk(rule: PluginProxyRule): string | null {
  if (rule.kind !== "rewrite") return `unknown rule kind ${JSON.stringify(rule.kind)}`;
  if (rule.match.length > REWRITE_PATTERN_MAX) {
    return `the pattern is ${rule.match.length} characters, over the ${REWRITE_PATTERN_MAX} cap`;
  }
  if (!safeRegex(rule.match)) {
    return "the pattern's worst case is not linear (catastrophic backtracking); narrow it or drop it";
  }
  return null;
}

/**
 * The addresses `rules` rewrite `url` into, in rule order: every rewrite rule whose `match`
 * matches contributes its `rewrite` result. A rule that matches but rewrites to the same
 * URL contributes nothing (it would only repeat the canonical address), and duplicates
 * collapse — the first rule to produce an address owns it.
 */
export function pluginProxyMirrors(url: string, rules: readonly PluginProxyRule[]): string[] {
  const mirrors: string[] = [];
  for (const rule of rules) {
    if (rule.kind !== "rewrite") continue;
    // A rule's shape was checked at config parse (rewriteRuleRisk); a hand-edited source
    // that reaches here anyway is skipped rather than run.
    if (rewriteRuleRisk(rule) !== null) continue;
    const re = new RegExp(rule.match);
    if (!re.test(url)) continue;
    const rewritten = url.replace(re, rule.rewrite);
    if (rewritten !== url && !mirrors.includes(rewritten)) mirrors.push(rewritten);
  }
  return mirrors;
}

/**
 * What a package on this machine says about itself for its card: the Chinese and short
 * descriptions of its card contribution (in its generated `ifaces.json`), and its icon — read by
 * core's reader, the same one the library reads a library plugin with, so an icon that will not
 * do is never served. Empty when the package is not here (an index row is then all there is)
 * or carries neither; a package without a table, or whose table will not read, still has its
 * root `icon.<ext>`. Nothing here fails the listing: the card falls back to what the index says.
 */
export async function localPluginDisplay(
  name: string,
  bases: readonly PluginBase[],
): Promise<PluginDisplay> {
  const found = resolvePluginPackage(name, bases);
  if (found === null) return {};
  const { card, icon } = readPackageCard(found.dir);
  const display: PluginDisplay = {};
  if (card.title !== undefined) display.title = card.title;
  if (card.titleZh !== undefined) display.titleZh = card.titleZh;
  if (card.descriptionZh !== undefined) display.descriptionZh = card.descriptionZh;
  if (card.shortDescription !== undefined) display.shortDescription = card.shortDescription;
  if (card.shortDescriptionZh !== undefined) display.shortDescriptionZh = card.shortDescriptionZh;
  // No icon, or one that will not do: the card draws the puzzle piece.
  if (icon !== undefined) display.icon = icon;
  return display;
}

/** How a published index is fetched: `fetchImpl` and `delay` are injectable for tests. */
export interface HttpRegistryOptions {
  fetchImpl?: typeof fetch;
  /** Tries at a connection-level failure (a refused or reset connection, a timeout), an HTTP status is never retried. */
  attempts?: number;
  /** Per attempt: a proxy that never answers must not hold the listing forever. */
  timeoutMs?: number;
  /** The pause before the next attempt, by attempt number (1-based). */
  delay?: (attempt: number) => Promise<void>;
}

const backoff = (attempt: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, 500 * 2 ** (attempt - 1)));

/**
 * A registry behind an `index.json` source: one canonical URL plus its CDN mirrors, tried
 * one at a time in try order — the first address that serves the document carries the
 * read, a failed one hands the read to the next, and a source exhausted on is reported with
 * the failure it ended on. The start of the order is where the last read succeeded (see
 * `sticky` below), so a deployment whose canonical address is dead does not pay its window
 * on every read; apart from that start the order is the configured one, every address is
 * tried once per read, and nothing is measured: no probe, no speed test — the walk only
 * remembers where it succeeded last. Within one address a connection that fails is tried
 * again before the read moves on:
 * the document sits behind a CDN redirect, and the first hop out through a corporate proxy
 * is exactly the kind of thing that fails once and works a second later. What a server
 * answered (a 404, a 503) is not retried — that is a fact about the source, not about the
 * wire — and it moves the read to the next address the same way a connection failure does:
 * an address that has nothing to serve is as dead as one that cannot be reached.
 */
export function httpPluginRegistry(
  indexUrl: string | readonly string[],
  options: HttpRegistryOptions | typeof fetch = {},
): PluginRegistry {
  const opts: HttpRegistryOptions =
    typeof options === "function" ? { fetchImpl: options } : options;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const attempts = opts.attempts ?? 3;
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const delay = opts.delay ?? backoff;
  const addresses = Array.isArray(indexUrl) ? [...indexUrl] : [indexUrl];
  // What the last 200 answered, so the next read can revalidate instead of re-downloading:
  // the etag goes back as If-None-Match, and the body's hash catches a CDN (GitHub Pages
  // among them) whose etag churns while the document does not.
  let revalidate: { etag: string | null; hash: string; entries: IndexDocumentEntry[] } | null =
    null;
  // The address that served the document last, tried first next time. Memory, not a speed
  // test: the walk still tries one address at a time in a fixed order, only its start
  // moves — the configured order among the rest is untouched. A source whose first address
  // is dead would otherwise pay its window on every read forever; starting where the last
  // read succeeded returns the common case to one address, and a sticky address that has
  // died hands the walk back to the configured order inside the same read.
  let sticky: string | null = null;
  const ordered = (): readonly string[] => {
    if (sticky === null || !addresses.includes(sticky)) return addresses;
    return [sticky, ...addresses.filter((address) => address !== sticky)];
  };
  // One address, its connection-level retries. A connection failure (refused, reset,
  // timeout) is tried again before the read moves on; what the fetch itself answered is
  // returned as is — the caller decides whether an answer is worth another address.
  const requestAddress = async (address: string): Promise<Response> => {
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await fetchImpl(address, {
          headers: {
            "user-agent": userAgent(),
            ...(revalidate !== null && revalidate.etag !== null
              ? { "if-none-match": revalidate.etag }
              : {}),
          },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        lastError = err;
        if (attempt < attempts) await delay(attempt);
      }
    }
    const cause = lastError instanceof Error ? lastError : new Error(String(lastError));
    const why =
      cause.cause instanceof Error ? `${cause.message} (${cause.cause.message})` : cause.message;
    throw new Error(
      `plugin index from ${address} could not be fetched (${attempts} attempts): ${why}`,
    );
  };
  // One read of the index, fetch through parse. Reads are queued one after another (see
  // `index` below): two overlapping reads would both fetch against the same revalidation
  // state, and whichever finished last would write its document over the other's — an older
  // completion could rewind the etag a newer read had just advanced, and the next read would
  // revalidate against a header the server had already retired.
  const readOnce = async (): Promise<IndexDocumentEntry[]> => {
    // The addresses in try order (the sticky start first, see `ordered`), one at a time:
    // the first one whose answer turns into a document carries the read. A connection
    // failure or a non-ok answer moves on to the next address; an answer that stops
    // halfway (a body that never arrives, a document that will not parse) does the same —
    // the address has not served the document, whatever its headers said. No address is
    // fetched twice or fetched again after another has won. All of them failed: the read
    // reports the failure it ended on, which names the address it belongs to.
    let lastError: unknown = null;
    for (const address of ordered()) {
      let res: Response;
      try {
        res = await requestAddress(address);
        if (!res.ok && !(res.status === 304 && revalidate !== null)) {
          throw new Error(`plugin index from ${address} answered HTTP ${res.status}`);
        }
        // Unchanged since the last read: the document in hand stands, nothing re-parsed.
        // The null check also narrows the write below for the type checker.
        if (res.status === 304 && revalidate !== null) {
          const fresh = res.headers.get("etag");
          if (fresh !== null) revalidate = { ...revalidate, etag: fresh };
          // The address served the read (a revalidation is still a served document).
          sticky = address;
          return revalidate.entries;
        }
        const text = await res.text();
        const hash = createHash("sha256").update(text).digest("hex");
        // The etag moved but the document did not — a Pages quirk this hash is here to
        // catch. The new etag is kept so the next revalidation speaks the header the
        // server last sent.
        if (revalidate !== null && hash === revalidate.hash) {
          revalidate = { ...revalidate, etag: res.headers.get("etag") };
          sticky = address;
          return revalidate.entries;
        }
        let data: unknown;
        try {
          data = JSON.parse(text);
        } catch (err) {
          throw new Error(
            `plugin index from ${address} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        const entries = parsePluginIndex(data, address, { icons: "drop" });
        revalidate = { etag: res.headers.get("etag"), hash, entries };
        // Content verified by the same parser as before — a mirror wins nothing by
        // serving bytes the validator refuses. Only now is the address remembered.
        sticky = address;
        return entries;
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError;
  };
  // The queue itself: every read follows the one before it, and a read that fails does not
  // poison the chain — the failure is the caller's news, not the next read's state.
  let chain: Promise<unknown> = Promise.resolve();
  return {
    source: addresses[0]!,
    index: () => {
      const next = chain.then(readOnce, readOnce);
      chain = next.catch(() => undefined);
      return next;
    },
    // The shared index format carries no readme location, so a remote source has none to
    // offer yet. Null rather than a guessed URL: inventing one would have the Web App
    // render whatever answered it.
    readme: () => Promise.resolve(null),
  };
}

/**
 * Where the published plugin index lives.
 *
 * A release asset, not the GitHub API and not a Pages URL. The API would cost this server two
 * requests against an unauthenticated 60/hour budget shared by every deployment behind one NAT,
 * for a document that changes four times a day; the asset is a plain file download with no such
 * budget, and the CDN in front of it is the same one that serves the installers.
 *
 * The tag is fixed and never re-pointed. What a six-hourly workbench in the index repository
 * replaces is the ASSET on that release, so this URL is stable for the life of the tag and
 * nothing here has to discover which release is newest — "latest nightly" is a name, resolved
 * by the publisher rather than by a search.
 */
export const NIGHTLY_INDEX_URL =
  "https://github.com/Prism-Shadow/penguin-extensions/releases/download/nightly/index.json";

/**
 * The proxy rules a deployment with no proxy config of its own falls back to, in rule
 * order — the built-in set a deployment overrides with PENGUIN_PLUGIN_PROXY.
 * Empty by default: naming the endpoints is a deployment's call (which third-party
 * services to lean on for GitHub Pages, GitHub Releases and npm in its region), not this
 * constant's — a default here would be a service choice made without the deployer.
 */
export const PLUGIN_DEFAULT_PROXY_RULES: readonly PluginProxyRule[] = [];

/** Wall-clock reader, injectable so a cache's TTL is deterministic in tests. */
export type Clock = () => number;

/**
 * How long a fetched index is reused. The published document changes every six hours, so this
 * is not about freshness — it is about a listing endpoint that any logged-in user can open on
 * every page load, which without a cache turns one navigation habit into a request per view.
 */
export const INDEX_CACHE_TTL_MS = 30 * 60_000;

/**
 * How long a failed fetch stands before the next read tries again. Inside this window a read with
 * nothing cached is answered with the failure at once: on a host that cannot reach the index at
 * all, every page load would otherwise start the same doomed fetch and report the source as still
 * loading instead of down.
 */
export const INDEX_RETRY_MS = 60_000;

/**
 * Wrap a registry so its index is fetched at most once per TTL, and keep serving the last good
 * document when a refresh fails.
 *
 * Serving stale is the point rather than a fallback: the alternative to a slightly old index is
 * no index at all, and the page's job is to show what exists. So a read past the TTL is answered
 * with the document in hand while the refresh runs behind it, and the next read gets the new one.
 * A failure with nothing cached still propagates — the caller decides whether one dead source
 * should cost the whole listing — and is remembered for INDEX_RETRY_MS, so a source that is down
 * costs one fetch per window rather than one per read.
 *
 * Concurrent callers share one in-flight fetch, so a page opened in four tabs at once is one
 * request rather than four.
 */
export interface IndexSnapshot {
  /** When the document was fetched (ms since the epoch). */
  at: number;
  entries: IndexDocumentEntry[];
  /** The URL the document was fetched from; a successor only seeds the same URL's registry. */
  url?: string;
}

/** A cached registry also hands out its last good document, for a successor to start from. */
export interface CachedRegistry extends PluginRegistry {
  snapshot(): IndexSnapshot | null;
}

export function cachedRegistry(
  inner: PluginRegistry,
  {
    ttlMs = INDEX_CACHE_TTL_MS,
    retryMs = INDEX_RETRY_MS,
    now = Date.now,
    seed = null,
  }: {
    ttlMs?: number;
    retryMs?: number;
    now?: Clock;
    /**
     * The last good document a previous App fetched. It is served while the TTL has not
     * lapsed and stands in when the refresh fails — a hot push must not turn one flaky
     * connection into a listing with a source missing.
     */
    seed?: IndexSnapshot | null;
  } = {},
): CachedRegistry {
  let good: IndexSnapshot | null = seed;
  let failed: { at: number; error: unknown } | null = null;
  let inFlight: Promise<IndexDocumentEntry[]> | null = null;
  const refresh = (): Promise<IndexDocumentEntry[]> =>
    (inFlight ??= inner
      .index()
      .then(
        (entries) => {
          good = { at: now(), entries };
          failed = null;
          return entries;
        },
        (err: unknown) => {
          failed = { at: now(), error: err };
          throw err;
        },
      )
      .finally(() => {
        inFlight = null;
      }));
  /** The answer in hand — refreshing a stale document behind it — or null when a fetch is all there is. */
  const inHand = (): Promise<IndexDocumentEntry[]> | null => {
    if (good !== null && now() - good.at < ttlMs) return Promise.resolve(good.entries);
    const resting = failed !== null && now() - failed.at < retryMs;
    if (good !== null) {
      // Answered with the document in hand; a refresh that fails leaves it standing.
      if (!resting) refresh().catch(() => undefined);
      return Promise.resolve(good.entries);
    }
    if (resting) return Promise.reject(failed!.error);
    return null;
  };
  return {
    source: inner.source,
    snapshot: () => good,
    index: () => inHand() ?? refresh(),
    inHand: () => {
      const answer = inHand();
      if (answer === null) refresh().catch(() => undefined);
      return answer;
    },
    readme: (name) => inner.readme(name),
  };
}

/** What merging the sources gave: their entries, and the sources that failed or are still being read. */
export interface MergedIndex {
  entries: IndexDocumentEntry[];
  failures: { source: string; error: string }[];
  /** Sources still being read when the listing was made: their entries are missing from it. */
  pending: string[];
}

/**
 * Merge several registries into one listing, tolerating a source that fails.
 *
 * Deliberately unlike the within-document rule: a malformed row still kills its own index,
 * because that index is one publisher's single artifact, but a source that is unreachable,
 * misconfigured or serving garbage must not empty the page of everything else. The failure is
 * reported alongside the entries rather than swallowed, so the Web App can say which source is
 * down instead of quietly showing a shorter list. With `waitForNetwork: false`, a source is read
 * from what it has in hand, and one with nothing in hand yet is reported as pending rather than
 * waited for, for the same reason: what this server ships lists at once, wherever the network is.
 *
 * On a name collision the FIRST source wins, and the builtin registry is listed first: what this
 * deployment actually ships is the truth about it, and a published index claiming the same
 * specifier does not get to describe a package the operator already has. Within one source, the
 * newest row per name wins (see newestPerName) — a publisher's document may carry several
 * versions of a package, and the listing carries the one a consumer would want.
 */
export async function mergeIndexes(
  registries: readonly PluginRegistry[],
  { waitForNetwork = true }: { waitForNetwork?: boolean } = {},
): Promise<MergedIndex> {
  const settled = await Promise.all(
    registries.map(async (r) => {
      const reading = waitForNetwork || r.inHand === undefined ? r.index() : r.inHand();
      if (reading === null) return { source: r.source, answer: null };
      try {
        return { source: r.source, answer: { entries: await reading, error: null } };
      } catch (err) {
        return {
          source: r.source,
          answer: {
            entries: [] as IndexDocumentEntry[],
            error: err instanceof Error ? err.message : String(err),
          },
        };
      }
    }),
  );
  const seen = new Set<string>();
  const entries: IndexDocumentEntry[] = [];
  const failures: MergedIndex["failures"] = [];
  const pending: string[] = [];
  for (const { source, answer } of settled) {
    if (answer === null) {
      pending.push(source);
      continue;
    }
    if (answer.error !== null) failures.push({ source, error: answer.error });
    for (const entry of newestPerName(answer.entries)) {
      if (seen.has(entry.name)) continue;
      seen.add(entry.name);
      entries.push(entry);
    }
  }
  return { entries, failures, pending };
}

/** A parsed semver: the numeric core and the prerelease identifiers, `null` when there are none. */
interface ParsedSemver {
  core: [number, number, number];
  pre: string[] | null;
}

const SEMVER =
  /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

function parseSemver(version: string): ParsedSemver | null {
  const match = SEMVER.exec(version);
  if (match === null) return null;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4] === undefined ? null : match[4].split("."),
  };
}

/** Whether the version parses as a semver at all (a row whose version does not is unranked). */
export function isSemver(version: string): boolean {
  return parseSemver(version) !== null;
}

/**
 * SemVer 2.0.0 precedence (semver.org §11), negative when `a` ranks below `b`, positive above,
 * zero when equivalent: the numeric core first; then a prerelease ranks BELOW the release it
 * belongs to (`0.0.1-alpha.2 < 0.0.1`), its dot-separated identifiers compare left to right —
 * numeric identifiers by value (`alpha.2 < alpha.10`, the trap a string compare falls into),
 * alphanumeric by ASCII (`alpha < beta`), numeric below alphanumeric — and a shorter prerelease
 * that matches so far ranks lower (`alpha < alpha.1`). Build metadata never takes part:
 * `1.0.0+x` and `1.0.0+y` are equivalent. Both versions must parse (`isSemver`); one that does
 * not throws — the caller gates on `isSemver` first.
 */
export function compareSemver(a: string, b: string): number {
  const left = parseSemver(a);
  const right = parseSemver(b);
  if (left === null) throw new Error(`not a semver: ${a}`);
  if (right === null) throw new Error(`not a semver: ${b}`);
  for (let i = 0; i < 3; i += 1) {
    if (left.core[i] !== right.core[i]) return left.core[i]! - right.core[i]!;
  }
  if (left.pre === null && right.pre === null) return 0;
  if (left.pre === null) return 1;
  if (right.pre === null) return -1;
  const shared = Math.min(left.pre.length, right.pre.length);
  for (let i = 0; i < shared; i += 1) {
    const x = left.pre[i]!;
    const y = right.pre[i]!;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) {
      if (x !== y) return Number(x) - Number(y);
    } else if (xn !== yn) {
      return xn ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return left.pre.length - right.pre.length;
}

/** Whether version `a` outranks `b` for the same package: a semver outranks a non-semver, two non-semvers keep the first, two semvers go by precedence (equal keeps the first). */
function outranks(a: string, b: string): boolean {
  const parsedA = isSemver(a);
  const parsedB = isSemver(b);
  if (parsedA !== parsedB) return parsedA;
  if (!parsedA) return false;
  return compareSemver(a, b) > 0;
}

/**
 * The newest row per package name: of a document's several rows for one package — the format is
 * a flat array of per-version entries — the one a consumer would want. The winner is the highest
 * SemVer 2.0.0 precedence (see compareSemver for what that means for prereleases); a row whose
 * version does not parse as semver loses to any row that does, and keeps the document's first
 * among themselves; rows of equal precedence (a build-metadata difference) keep the first. The
 * survivors come back in the document's own order.
 */
export function newestPerName(entries: readonly IndexDocumentEntry[]): IndexDocumentEntry[] {
  const newest = new Map<string, IndexDocumentEntry>();
  for (const entry of entries) {
    const held = newest.get(entry.name);
    if (held === undefined || outranks(entry.version, held.version)) newest.set(entry.name, entry);
  }
  return entries.filter((entry) => newest.get(entry.name) === entry);
}
