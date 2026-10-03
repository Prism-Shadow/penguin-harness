/**
 * Plugin registries: where index entries (api/types.ts `PluginIndexEntry`) come from. Discovery
 * only — nothing here imports plugin code. Three sources, merged in this order by `mergeIndexes`:
 * the published index (NIGHTLY_INDEX_URL), the index the running build carries
 * (`plugins/index.json`, written by build-plugins.mjs), and what this machine downloaded into
 * `<root>/plugins`, all validated alike. Design: PRFC-0006, 索引与目录.
 */
import type { PluginIndexEntry } from "../api/types.js";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { resolvePluginPackage } from "./loader.js";
import type { PluginBase } from "./loader.js";
import {
  buildPrefix,
  localPackage,
  pluginsPrefix,
  prefixNames,
  readPrefixIndex,
} from "./prefix.js";
import { INTEGRITY, manifestOf, sortIndex } from "../../../../scripts/plugin-entry.mjs";

/** One source of plugin index entries; `source` identifies it for display and errors. */
export interface PluginRegistry {
  readonly source: string;
  index(): Promise<PluginIndexEntry[]>;
  /**
   * Long-form documentation for one entry, or null when this source has none for it.
   *
   * Separate from `index` because the shapes differ: the index is a listing sent in full
   * on every page load, a readme is large and wanted only for the entry someone opened.
   */
  readme(name: string): Promise<string | null>;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

/** Validates one raw entry; returns null instead of throwing so the caller can name the index position. */
function asIndexEntry(value: unknown): PluginIndexEntry | null {
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
  for (const key of ["repository", "homepage"] as const) {
    if (e[key] !== undefined && typeof e[key] !== "string") return null;
  }
  for (const key of ["keywords", "categories"] as const) {
    if (e[key] !== undefined && !isStringArray(e[key])) return null;
  }
  if (e.updatedAt !== undefined && typeof e.updatedAt !== "number") return null;
  // Optional, so an index from before it still lists — but a present one must be npm's:
  // a malformed integrity is a broken artifact, not an unpinned entry.
  if (
    e.integrity !== undefined &&
    (typeof e.integrity !== "string" || !INTEGRITY.test(e.integrity))
  ) {
    return null;
  }
  if (e.yanked !== undefined && typeof e.yanked !== "boolean") return null;
  return value as PluginIndexEntry;
}

/** npm's integrity, `sha512-<base64>`: an entry's content (scripts/plugin-entry.mjs). */
export { INTEGRITY };

/**
 * Validates a whole index document. Strict, not per-entry-tolerant: an index is one
 * publisher's single artifact, so a malformed row means the artifact is broken —
 * unlike a Project's plugin list, whose entries are independent choices skipped one
 * by one.
 */
export function parsePluginIndex(data: unknown, source: string): PluginIndexEntry[] {
  if (!Array.isArray(data)) {
    throw new Error(`plugin index from ${source} is not an array`);
  }
  return data.map((raw, i) => {
    const entry = asIndexEntry(raw);
    if (entry === null) {
      throw new Error(`plugin index from ${source} has a malformed entry at index ${i}`);
    }
    return entry;
  });
}

export const BUILTIN_REGISTRY_SOURCE = "builtin";
export const DOWNLOADED_REGISTRY_SOURCE = "downloaded";

/** A package's own README.md, from wherever it is on this machine; null when it is not. */
async function readmeOf(name: string, bases: readonly PluginBase[]): Promise<string | null> {
  const found = resolvePluginPackage(name, bases);
  if ("refused" in found) return null;
  try {
    return await fsp.readFile(path.join(found.dir, "README.md"), "utf8");
  } catch {
    return null;
  }
}

/**
 * The index the running build carries (plugin/prefix.ts `buildPrefix`): a push's before the
 * installation's. Empty when neither has one: a run from source before its dev build ships none.
 */
export async function shippedIndex(assetsDir: string | null): Promise<PluginIndexEntry[]> {
  const prefix = buildPrefix(assetsDir);
  const rows = prefix === null ? null : readPrefixIndex(prefix);
  return rows === null ? [] : parsePluginIndex(rows, BUILTIN_REGISTRY_SOURCE);
}

/**
 * The registry of the running build: the index scripts/build-plugins.mjs rebuilt from what it
 * packed (`shippedIndex`). A readme is the package's own README.md, read from wherever the
 * package is on this machine (`bases`) — the file npm shipped with it, never a second copy. A
 * listed package that is not on this machine has none to show.
 */
export function builtinPluginRegistry(
  bases: () => readonly PluginBase[] = () => [],
  assetsDir: () => string | null = () => null,
): PluginRegistry {
  return {
    source: BUILTIN_REGISTRY_SOURCE,
    // Validated like any other source: a broken shipped index fails loudly rather than
    // serving garbage.
    index: () => shippedIndex(assetsDir()),
    readme: (name) => readmeOf(name, bases()),
  };
}

/**
 * The registry of what this machine downloaded: each package in `<root>/plugins` that records
 * its integrity, described by its own package.json.
 */
export function downloadedPluginRegistry(
  root: string,
  bases: () => readonly PluginBase[] = () => [],
): PluginRegistry {
  return {
    source: DOWNLOADED_REGISTRY_SOURCE,
    index: async () => {
      const prefix = pluginsPrefix(root);
      const rows = prefixNames(prefix).flatMap((name) => {
        const p = localPackage(prefix, name);
        if (p?.integrity === undefined) return [];
        try {
          const pkg = JSON.parse(fs.readFileSync(path.join(p.dir, "package.json"), "utf8"));
          return [manifestOf(pkg, name, p.version, p.integrity)];
        } catch {
          return [];
        }
      });
      return parsePluginIndex(sortIndex(rows), DOWNLOADED_REGISTRY_SOURCE);
    },
    readme: (name) => readmeOf(name, bases()),
  };
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
  const request = async (): Promise<Response> => {
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await fetchImpl(indexUrl, { signal: AbortSignal.timeout(timeoutMs) });
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
      if (!res.ok) {
        throw new Error(`plugin index from ${indexUrl} answered HTTP ${res.status}`);
      }
      let data: unknown;
      try {
        data = await res.json();
      } catch (err) {
        throw new Error(
          `plugin index from ${indexUrl} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      return parsePluginIndex(data, indexUrl);
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
 * The tag is fixed and never re-pointed. What a six-hourly workflow in the index repository
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
 * Wrap a registry so its index is fetched at most once per TTL, and keep serving the last good
 * document when a refresh fails.
 *
 * Serving stale is the point rather than a fallback: the alternative to a slightly old index is
 * no index at all, and the page's job is to show what exists. A failure with nothing cached
 * still propagates — the caller decides whether one dead source should cost the whole listing.
 *
 * Concurrent callers share one in-flight fetch, so a page opened in four tabs at once is one
 * request rather than four.
 */
export interface IndexSnapshot {
  /** When the document was fetched (ms since the epoch). */
  at: number;
  entries: PluginIndexEntry[];
}

/** A cached registry also hands out its last good document, for a successor to start from. */
export interface CachedRegistry extends PluginRegistry {
  snapshot(): IndexSnapshot | null;
}

export function cachedRegistry(
  inner: PluginRegistry,
  {
    ttlMs = INDEX_CACHE_TTL_MS,
    now = Date.now,
    seed = null,
  }: {
    ttlMs?: number;
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
  let inFlight: Promise<PluginIndexEntry[]> | null = null;
  return {
    source: inner.source,
    snapshot: () => good,
    index: async () => {
      if (good !== null && now() - good.at < ttlMs) return good.entries;
      inFlight ??= inner
        .index()
        .then((entries) => {
          good = { at: now(), entries };
          return entries;
        })
        .finally(() => {
          inFlight = null;
        });
      try {
        return await inFlight;
      } catch (err) {
        if (good !== null) return good.entries;
        throw err;
      }
    },
    readme: (name) => inner.readme(name),
  };
}

/**
 * Merge several registries into one listing, tolerating a source that fails.
 *
 * Deliberately unlike the within-document rule: a malformed row still kills its own index,
 * because that index is one publisher's single artifact, but a source that is unreachable,
 * misconfigured or serving garbage must not empty the page of everything else. The failure is
 * reported alongside the entries rather than swallowed, so the Web App can say which source is
 * down instead of quietly showing a shorter list.
 *
 * One row per content — name, version and integrity — so a build that carries different bytes
 * under a published version is listed beside it, not hidden behind it. When two sources list
 * the same content, the first one's descriptive fields are kept: the published index's, then the
 * build's. A yanked row is left out.
 */
export async function mergeIndexes(
  registries: readonly PluginRegistry[],
): Promise<{ entries: PluginIndexEntry[]; failures: { source: string; error: string }[] }> {
  const settled = await Promise.all(
    registries.map(async (r) => {
      try {
        return { source: r.source, entries: await r.index(), error: null };
      } catch (err) {
        return {
          source: r.source,
          entries: [] as PluginIndexEntry[],
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );
  const seen = new Set<string>();
  const entries: PluginIndexEntry[] = [];
  for (const result of settled) {
    for (const entry of result.entries) {
      // One row per content; a yanked one stays in its source as a record and is not offered.
      const key = `${entry.name}@${entry.version}#${entry.integrity ?? ""}`;
      if (entry.yanked === true || seen.has(key)) continue;
      seen.add(key);
      entries.push(entry);
    }
  }
  const failures = settled
    .filter((r) => r.error !== null)
    .map((r) => ({ source: r.source, error: r.error! }));
  return { entries, failures };
}
