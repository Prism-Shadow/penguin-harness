/**
 * Provider-neutral tool catalog search.
 *
 * Catalog entries stay outside the model context until a provider chooses to expose a match.
 * The ranking deliberately uses deterministic lexical signals rather than embeddings: it is
 * local, fast, dependency-free, and stable enough to benchmark. Providers can attach their own
 * metadata without coupling this module to MCP or any future plugin transport.
 */
import type { ToolDefinition } from "../interfaces.js";

export interface ToolCatalogEntry<T> {
  definition: ToolDefinition;
  metadata: T;
  /** Extra provider-owned terms, such as an MCP server name or an unprefixed tool name. */
  aliases?: readonly string[];
}

export type ToolCatalogMatch<T extends ToolCatalogEntry<unknown>> = T & { score: number };

/** Transport/routing words do not distinguish one catalog entry from another. */
const GENERIC_QUERY_TERMS = new Set([
  "capabilities",
  "capability",
  "external",
  "integration",
  "integrations",
  "mcp",
  "tool",
  "tools",
]);

function normalized(value: string): string {
  return value.normalize("NFKC").toLowerCase();
}

function terms(value: string): string[] {
  // Tool names commonly use snake_case / kebab-case. Treat their separators as word
  // boundaries so a natural-language "describe table" query gets exact name-token signals
  // instead of only a weak substring hit on "describe_table".
  return (
    normalized(value)
      .replace(/[_-]+/g, " ")
      .match(/[\p{L}\p{N}]+/gu) ?? []
  );
}

/**
 * Searches a catalog and returns stable, relevance-ordered matches.
 *
 * Name and alias hits dominate description hits; parameter names/descriptions are still
 * searchable at a lower weight. Ties preserve provider discovery order. An empty query returns
 * no entries so an accidental catalog call cannot return arbitrary tools.
 */
export function searchToolCatalog<T extends ToolCatalogEntry<unknown>>(
  entries: readonly T[],
  query: string,
  limit: number,
): ToolCatalogMatch<T>[] {
  const phrase = normalized(query.trim());
  if (phrase === "" || limit <= 0) return [];
  // Short connective words and standalone numbers create noisy substring hits (for example a
  // date ending in "20" matching operation_20). Exact/substring phrase matching above still
  // supports deliberate short-name and numeric lookups; only the additive term signals are
  // filtered here.
  const queryTerms = [
    ...new Set(
      terms(phrase).filter(
        (term) =>
          [...term].length >= 3 && !/^\p{N}+$/u.test(term) && !GENERIC_QUERY_TERMS.has(term),
      ),
    ),
  ];

  return entries
    .map((entry, index) => {
      const name = normalized(entry.definition.name);
      const aliases = (entry.aliases ?? []).map(normalized);
      const nameTerms = terms(name);
      const aliasTerms = aliases.flatMap(terms);
      const description = normalized(entry.definition.description ?? "");
      const parameters = normalized(JSON.stringify(entry.definition.parameters ?? {}));
      let score = 0;

      if (name === phrase || aliases.includes(phrase)) score += 1000;
      else if (name.includes(phrase) || aliases.some((alias) => alias.includes(phrase)))
        score += 250;

      for (const term of queryTerms) {
        if (nameTerms.includes(term) || aliasTerms.includes(term)) score += 100;
        else if (name.includes(term) || aliases.some((alias) => alias.includes(term))) score += 40;
        if (description.includes(term)) score += 12;
        if (parameters.includes(term)) score += 3;
      }

      return { ...entry, score, index };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, Math.floor(limit))
    .map(({ index: _index, ...entry }) => entry as ToolCatalogMatch<T>);
}
