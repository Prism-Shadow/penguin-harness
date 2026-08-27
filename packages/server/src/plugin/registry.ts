/**
 * Plugin registries: WHERE plugin index entries come from. A registry is one source
 * of `PluginIndexEntry` rows — the shared index format every registry speaks (see
 * api/types.ts; the schema follows typst/packages' `index.json`: a flat array of
 * per-version entries). Discovery only: installing an entry stays the operator's
 * `plugins.json` edit (plugin/loader.ts), and nothing here imports plugin code.
 *
 * Two implementations, one contract:
 *   - the builtin registry serves the index embedded in this package
 *     (builtin-index.json — the four sandbox backends the workspace ships);
 *   - the HTTP registry fetches an `index.json` URL and runs it through the same
 *     validator, so a remote index is trusted no further than the embedded one.
 *
 * A deployment's list is the builtin registry plus the published index (see
 * NIGHTLY_INDEX_URL), merged in http/routes/plugins.ts.
 */
import type { PluginIndexEntry } from "../api/types.js";
import builtinIndex from "./builtin-index.json" with { type: "json" };
import { BUILTIN_READMES } from "./builtin-readmes.js";

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
  return value as PluginIndexEntry;
}

/**
 * Validates a whole index document. Strict, not per-entry-tolerant: an index is one
 * publisher's single artifact, so a malformed row means the artifact is broken —
 * unlike plugins.json entries, which are independent operator choices skipped one
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

/** The registry embedded in this package: the workspace's own plugin packages. */
export function builtinPluginRegistry(): PluginRegistry {
  return {
    source: BUILTIN_REGISTRY_SOURCE,
    // Validated like any other source: a broken embedded index should fail loudly
    // in tests rather than serve garbage.
    index: () => Promise.resolve(parsePluginIndex(builtinIndex, BUILTIN_REGISTRY_SOURCE)),
    readme: (name) => Promise.resolve(BUILTIN_READMES[name] ?? null),
  };
}

/** A registry behind an `index.json` URL; `fetchImpl` is injectable for tests. */
export function httpPluginRegistry(
  indexUrl: string,
  fetchImpl: typeof fetch = fetch,
): PluginRegistry {
  return {
    source: indexUrl,
    index: async () => {
      const res = await fetchImpl(indexUrl);
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
  "https://github.com/Prism-Shadow/penguin-plugins/releases/download/nightly/index.json";

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
export function cachedRegistry(
  inner: PluginRegistry,
  { ttlMs = INDEX_CACHE_TTL_MS, now = Date.now }: { ttlMs?: number; now?: Clock } = {},
): PluginRegistry {
  let good: { at: number; entries: PluginIndexEntry[] } | null = null;
  let inFlight: Promise<PluginIndexEntry[]> | null = null;
  return {
    source: inner.source,
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
 * On a name collision the FIRST source wins, and the builtin registry is listed first: what this
 * deployment actually ships is the truth about it, and a published index claiming the same
 * specifier does not get to describe a package the operator already has.
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
      const key = `${entry.name}@${entry.version}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push(entry);
    }
  }
  const failures = settled
    .filter((r) => r.error !== null)
    .map((r) => ({ source: r.source, error: r.error! }));
  return { entries, failures };
}
