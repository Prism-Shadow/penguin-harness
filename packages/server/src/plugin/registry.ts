/**
 * Extension registries: WHERE extension index entries come from. A registry is one source
 * of `ExtensionIndexEntry` rows — the shared index format every registry speaks (see
 * api/types.ts; the schema follows typst/packages' `index.json`: a flat array of
 * per-version entries). Discovery only: installing an entry stays the operator's
 * `extensions.json` edit (extension/loader.ts), and nothing here imports extension code.
 *
 * Two implementations, one contract:
 *   - the builtin registry serves the index embedded in this package
 *     (builtin-index.json — the four sandbox backends the workspace ships);
 *   - the HTTP registry fetches an `index.json` URL and runs it through the same
 *     validator, so a remote index is trusted no further than the embedded one.
 *
 * The deployment's registry list is fixed to the builtin one for now; additional
 * sources plug in as more `ExtensionRegistry` values.
 */
import type { ExtensionIndexEntry } from "../api/types.js";
import builtinIndex from "./builtin-index.json" with { type: "json" };

/** One source of extension index entries; `source` identifies it for display and errors. */
export interface ExtensionRegistry {
  readonly source: string;
  index(): Promise<ExtensionIndexEntry[]>;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

/** Validates one raw entry; returns null instead of throwing so the caller can name the index position. */
function asIndexEntry(value: unknown): ExtensionIndexEntry | null {
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
  return value as ExtensionIndexEntry;
}

/**
 * Validates a whole index document. Strict, not per-entry-tolerant: an index is one
 * publisher's single artifact, so a malformed row means the artifact is broken —
 * unlike extensions.json entries, which are independent operator choices skipped one
 * by one.
 */
export function parseExtensionIndex(data: unknown, source: string): ExtensionIndexEntry[] {
  if (!Array.isArray(data)) {
    throw new Error(`extension index from ${source} is not an array`);
  }
  return data.map((raw, i) => {
    const entry = asIndexEntry(raw);
    if (entry === null) {
      throw new Error(`extension index from ${source} has a malformed entry at index ${i}`);
    }
    return entry;
  });
}

export const BUILTIN_REGISTRY_SOURCE = "builtin";

/** The registry embedded in this package: the workspace's own extension packages. */
export function builtinExtensionRegistry(): ExtensionRegistry {
  return {
    source: BUILTIN_REGISTRY_SOURCE,
    // Validated like any other source: a broken embedded index should fail loudly
    // in tests rather than serve garbage.
    index: () => Promise.resolve(parseExtensionIndex(builtinIndex, BUILTIN_REGISTRY_SOURCE)),
  };
}

/** A registry behind an `index.json` URL; `fetchImpl` is injectable for tests. */
export function httpExtensionRegistry(
  indexUrl: string,
  fetchImpl: typeof fetch = fetch,
): ExtensionRegistry {
  return {
    source: indexUrl,
    index: async () => {
      const res = await fetchImpl(indexUrl);
      if (!res.ok) {
        throw new Error(`extension index from ${indexUrl} answered HTTP ${res.status}`);
      }
      let data: unknown;
      try {
        data = await res.json();
      } catch (err) {
        throw new Error(
          `extension index from ${indexUrl} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      return parseExtensionIndex(data, indexUrl);
    },
  };
}
