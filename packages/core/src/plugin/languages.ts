/**
 * The language vocabulary a plugin compiles against — types only.
 *
 * It lives in core, alongside the rest of the plugin contract, for the same reason the sandbox
 * vocabulary does: a language plugin is written against these names and nothing else. What it
 * hands over is one grammar and the strings that address it; the machinery that stores, lists
 * and serves them is the embedder's and stays there.
 *
 * Highlighting happens in the browser — Shiki, with the JS regex engine, over a TextMate
 * grammar. The languages a web bundle ships are resolved by its bundler at build time, so
 * installing a plugin cannot add one; what a plugin can do is hand the embedder a grammar,
 * which the App fetches at runtime and loads into the same Shiki core. That is the whole floor:
 * one contribution here, two endpoints, one `loadLanguage` call there.
 *
 * A grammar is DATA, not code. Nothing on this path imports anything a plugin ships — the
 * document contributed below is serialized to the browser and interpreted by Shiki's engine,
 * which is why a language plugin is a safe first external one.
 *
 * Contributed through the `LanguagesModule.grammars` slot, like a sandbox backend: the metadata
 * is the manifest's static half, the grammar document the code half.
 */

/** The static half of one contributed language: what the App needs BEFORE a grammar loads. */
export interface LanguageContribution {
  /**
   * Canonical id: the fence info string (```kotlin), the Shiki language name, and the key both
   * endpoints address. Must equal the grammar's own `name`, or Shiki resolves a language the
   * App never asked to load.
   */
  language: string;
  /** Human-readable name; what a picker would show. */
  displayName: string;
  /**
   * Alternative fence info strings (```kt). Shiki registers a grammar's own aliases, but only
   * once it is LOADED — and the fence string is exactly what decides whether to load it, so the
   * mapping has to reach the App before the grammar does.
   */
  aliases?: string[];
  /** File extensions without the dot, for the Workspace file viewer. */
  extensions?: string[];
}

/**
 * The code half: the TextMate grammar, in the shape Shiki's `loadLanguage` takes. Typed as
 * `unknown` on purpose — this layer never inspects it, and a structural type here would be a
 * second, always out-of-date copy of Shiki's.
 */
export type LanguageGrammar = unknown;
