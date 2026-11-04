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
import { readPackageCard, userAgent } from "@prismshadow/penguin-core";
import type { IconImage } from "@prismshadow/penguin-core";
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
  if (!listed.url.startsWith("https://")) {
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
 * Answers one package name's github channel from the published index, fetched at most once
 * per TTL (the same cadence the Plugins page reads at) and consulted only when npm has
 * already failed on the name — installs are rare, so no standing fetch. A source that is
 * down answers "no channel": the npm failure is the news then, not the index's silence.
 */
export function indexChannelLookup(
  indexUrl: string | null,
  { fetchImpl = fetch, ttlMs = INDEX_CACHE_TTL_MS, now = Date.now } = {},
): (name: string) => Promise<{ channel: IndexChannel | null; fault: string | null }> {
  let cache: { at: number; byName: Map<string, ReturnType<typeof indexChannelOf>> } | null = null;
  return async (name) => {
    if (indexUrl === null) return { channel: null, fault: null };
    const at = now();
    if (cache === null || at - cache.at > ttlMs) {
      let entries: IndexDocumentEntry[];
      try {
        entries = await httpPluginRegistry(indexUrl, { fetchImpl }).index();
      } catch {
        return { channel: null, fault: null };
      }
      cache = { at, byName: new Map(entries.map((e) => [e.name, indexChannelOf(e)])) };
    }
    return cache.byName.get(name) ?? { channel: null, fault: null };
  };
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
 * A registry behind an `index.json` URL.
 *
 * A connection that fails is tried again before it is reported: the document sits behind a
 * CDN redirect, and the first hop out through a corporate proxy is exactly the kind of thing
 * that fails once and works a second later. What the server answered (a 404, a 503) is not
 * retried — that is a fact about the source, not about the wire.
 */
export function httpPluginRegistry(
  indexUrl: string,
  options: HttpRegistryOptions | typeof fetch = {},
): PluginRegistry {
  const opts: HttpRegistryOptions =
    typeof options === "function" ? { fetchImpl: options } : options;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const attempts = opts.attempts ?? 3;
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const delay = opts.delay ?? backoff;
  // What the last 200 answered, so the next read can revalidate instead of re-downloading:
  // the etag goes back as If-None-Match, and the body's hash catches a CDN (GitHub Pages
  // among them) whose etag churns while the document does not.
  let revalidate: { etag: string | null; hash: string; entries: PluginIndexEntry[] } | null = null;
  const request = async (): Promise<Response> => {
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await fetchImpl(indexUrl, {
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
      `plugin index from ${indexUrl} could not be fetched (${attempts} attempts): ${why}`,
    );
  };
  return {
    source: indexUrl,
    index: async () => {
      const res = await request();
      // Unchanged since the last read: the document in hand stands, nothing re-parsed.
      if (res.status === 304 && revalidate !== null) {
        const fresh = res.headers.get("etag");
        if (fresh !== null) revalidate = { ...revalidate, etag: fresh };
        return revalidate.entries;
      }
      if (!res.ok) {
        throw new Error(`plugin index from ${indexUrl} answered HTTP ${res.status}`);
      }
      const text = await res.text();
      const hash = createHash("sha256").update(text).digest("hex");
      // The etag moved but the document did not — a Pages quirk this hash is here to catch.
      // The new etag is kept so the next revalidation speaks the header the server last sent.
      if (revalidate !== null && hash === revalidate.hash) {
        revalidate = { ...revalidate, etag: res.headers.get("etag") };
        return revalidate.entries;
      }
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch (err) {
        throw new Error(
          `plugin index from ${indexUrl} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      const entries = parsePluginIndex(data, indexUrl, { icons: "drop" });
      revalidate = { etag: res.headers.get("etag"), hash, entries };
      return entries;
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
 * specifier does not get to describe a package the operator already has.
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
    for (const entry of answer.entries) {
      const key = `${entry.name}@${entry.version}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push(entry);
    }
  }
  return { entries, failures, pending };
}
