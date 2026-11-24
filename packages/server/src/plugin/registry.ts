/**
 * Plugin registries: WHERE plugin index entries come from. A registry is one source
 * of `PluginIndexEntry` rows — the shared index format every registry speaks (see
 * api/types.ts; the schema follows typst/packages' `index.json`: a flat array of
 * per-version entries). Discovery only: a Project asks for an entry on the Plugins page
 * (http/routes/plugins-installed.ts), and nothing here imports plugin code.
 *
 * Two implementations, one contract:
 *   - the builtin registry serves the index embedded in this package
 *     (builtin-index.json — the server-module plugins of the workspace: the four sandbox
 *     backends, agent-state-git and computer-use; each row carries the descriptions of the package's own card contribution and
 *     its icon, so its card renders on a server the package is not installed on);
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
import {
  compareSemver,
  indexChannelOf,
  isSemver,
  newestPerName,
  parsePluginIndex,
  type IndexChannel,
  type IndexDocumentEntry,
} from "@prismshadow/penguin-core/plugin-index";
import builtinIndex from "./builtin-index.json" with { type: "json" };
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import type { IconImage } from "@prismshadow/penguin-core";
import {
  compareVersions,
  libraryParts,
  normalizeVersion,
  readPackageCard,
  userAgent,
} from "@prismshadow/penguin-core";
import safeRegex from "safe-regex";
import { indexMirrorRules } from "./mirror-settings.js";
import { resolvePluginPackage } from "./loader.js";
import type { PluginBase } from "./loader.js";

// The index document's readers are core's, shared with the website's build; the registry's
// callers keep reaching them here.
export {
  compareSemver,
  indexChannelOf,
  isSemver,
  newestPerName,
  NIGHTLY_INDEX_URL,
  parsePluginIndex,
  withoutIcon,
  type IndexChannel,
  type IndexDocumentEntry,
} from "@prismshadow/penguin-core/plugin-index";

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

/**
 * The sandbox backends the embedded index declares as defaults for `platform`
 * (`sandboxDefaultFor`), in index order: what a server whose sandbox is turned on with no backend
 * offers to install. Only the embedded index answers: the listing lets it win every name it
 * carries, it is read without waiting on the network, and an offer to install a package as part
 * of turning a setting on is something only what ships with this server supplies. A row without
 * the field is the default for no platform.
 */
export function sandboxDefaultsFor(
  platform: string,
  entries: readonly Pick<IndexDocumentEntry, "name" | "sandboxDefaultFor">[] = parsePluginIndex(
    builtinIndex,
    BUILTIN_REGISTRY_SOURCE,
  ),
): string[] {
  return entries.filter((e) => e.sandboxDefaultFor?.includes(platform) === true).map((e) => e.name);
}

/** The display fields an index entry may carry, which a package can also carry itself: its card's, and its icon. */
export type PluginDisplay = Pick<
  PluginIndexEntry,
  "title" | "titleZh" | "descriptionZh" | "shortDescription" | "shortDescriptionZh" | "localInstall"
> & { icon?: IconImage };

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
 * in the configured order and merged first-come-first-served: the first source to register a
 * package provides every version row for it, and a later source listing the same package adds
 * nothing (the listing's mergeIndexes rule). A source that is down contributes no
 * rows: the npm failure is the news then, not the index's silence.
 */
export function indexChannelLookup(
  readUrls: () => readonly string[],
  {
    fetchImpl = fetch,
    ttlMs = INDEX_CACHE_TTL_MS,
    now = Date.now,
    attempts,
    timeoutMs,
  }: {
    fetchImpl?: typeof fetch;
    ttlMs?: number;
    now?: () => number;
    /** Per address (httpPluginRegistry): an install's lookup tries once, briefly — it already waited on npm. */
    attempts?: number;
    timeoutMs?: number;
  } = {},
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
          const fromSource = await httpPluginRegistry([url, ...pluginProxyMirrors(url, mirrors)], {
            fetchImpl,
            ...(attempts !== undefined ? { attempts } : {}),
            ...(timeoutMs !== undefined ? { timeoutMs } : {}),
          }).index();
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
  available?: IndexDocumentEntry,
): Promise<PluginDisplay> {
  const found = resolvePluginPackage(name, bases);
  if (found === null) return {};
  const { card, icon } = readPackageCard(found.dir);
  const display: PluginDisplay = {};
  if (available && !found.base.builtin && !found.base.program) {
    try {
      const { version } = JSON.parse(await fs.readFile(found.manifest, "utf8")) as {
        version?: unknown;
      };
      const entry = path.join(path.dirname(found.base.file), "node_modules", name);
      if (typeof version === "string" && !(await fs.lstat(entry)).isSymbolicLink()) {
        const parts = libraryParts(found.dir);
        display.localInstall = {
          version,
          libraryOnly:
            !parts.modules && (parts.workbenches || parts.skills || parts.mcp || parts.hooks),
          updateAvailable:
            indexChannelOf(available).fault === null &&
            isSemver(version) &&
            isSemver(available.version) &&
            compareSemver(available.version, version) > 0,
        };
      }
    } catch {
      // The package can disappear during a registry read. Its index entry still lists.
    }
  }
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
 * The mirrors the two fetches try after the source's own URL come from a user's setting
 * (Settings → Plugins → Plugin mirrors, plugin/mirror-settings.ts) — which third-party
 * services to lean on is a service choice a user makes, applied through that group's
 * watch, not a constant here.
 */

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
          // The snapshot names the source it was fetched from: what a successor parks (and
          // seeds) carries its URL, so a saved change of the sources cannot hand the old
          // source's entries to the new one.
          good = { at: now(), entries, url: inner.source };
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
