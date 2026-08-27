/**
 * Shiki highlighter for code blocks — the chunk CodeBlock dynamically imports.
 *
 * Assembled from `shiki/core` with the language list in code-languages.ts instead of importing
 * `shiki` (its full bundle): that entry point drags in the oniguruma WASM engine and a registry of
 * all 332 bundled grammars, and both land on the *first* code block a conversation renders — 230 KB
 * gzip of WASM before a single token is colored. The pure-JS regex engine replaces it for free:
 * every pattern in every bundled grammar translates to a JS RegExp, and its token output is
 * byte-identical to oniguruma's. Measured on this app: ~308 KB -> ~70 KB gzip for the first block.
 *
 * The trade is coverage — a fence in a language not listed in code-languages.ts renders
 * unhighlighted instead of highlighted (`highlightToHtml` returns undefined and CodeBlock keeps its
 * plain <pre> fallback), where the full bundle would have known it. An installed extension closes
 * that gap for the languages it contributes: its grammar is fetched from the server and loaded
 * into this same core, through the same one-load-per-language cache as a bundled chunk.
 *
 * Both themes are baked into one pass as CSS variables (`--shiki-dark`, see styles.css), so
 * switching light/dark never re-highlights. Grammars load lazily and are cached per language, so a
 * conversation downloads only the languages it shows, once each.
 */
import { createHighlighterCore, type HighlighterCore, type LanguageInput } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import {
  LANGUAGE_LOADERS,
  isPlainTextLanguage,
  isRuntimeLanguage,
  resolveLanguage,
} from "./code-languages";

let corePromise: Promise<HighlighterCore> | undefined;
const grammarPromises = new Map<string, Promise<void>>();

function getCore(): Promise<HighlighterCore> {
  corePromise ??= createHighlighterCore({
    themes: [import("@shikijs/themes/github-light"), import("@shikijs/themes/github-dark")],
    langs: [],
    engine: createJavaScriptRegexEngine(),
  });
  return corePromise;
}

/** Loads a grammar at most once, even when several code blocks of the same language settle together. */
function loadGrammar(
  core: HighlighterCore,
  id: string,
  load: () => Promise<unknown>,
): Promise<void> {
  let pending = grammarPromises.get(id);
  if (!pending) {
    pending = load()
      .then((mod) => core.loadLanguage((mod as { default: LanguageInput }).default))
      .then(() => undefined)
      .catch((err: unknown) => {
        // Don't cache a failed load: a transient chunk fetch failure shouldn't leave the language
        // permanently unhighlighted for the rest of the session.
        grammarPromises.delete(id);
        throw err;
      });
    grammarPromises.set(id, pending);
  }
  return pending;
}

/**
 * Fetches an extension-contributed grammar, in the `{default}` shape loadGrammar expects.
 *
 * The grammar is DATA — a TextMate document Shiki's JS engine interprets — so nothing here
 * evaluates anything the extension shipped. Note the engine is the pure-JS one, not oniguruma:
 * a grammar leaning on an oniguruma-only construct fails to compile, which loadGrammar reports
 * as a load failure and CodeBlock renders as an unhighlighted block.
 */
function fetchGrammar(id: string): Promise<{ default: LanguageInput }> {
  return fetch(`/api/languages/${encodeURIComponent(id)}/grammar`, { credentials: "same-origin" })
    .then((res) => {
      if (!res.ok) throw new Error(`grammar for ${id} answered HTTP ${res.status}`);
      return res.json() as Promise<LanguageInput>;
    })
    .then((grammar) => ({ default: grammar }));
}

/**
 * Highlights `code` as `language`, returning Shiki's dual-theme HTML, or undefined when the
 * language isn't one this bundle carries. Rejects only on an unexpected failure (chunk fetch,
 * grammar error); callers fall back to unhighlighted text either way.
 */
export async function highlightToHtml(code: string, language: string): Promise<string | undefined> {
  const id = resolveLanguage(language);
  if (!id) return undefined;
  const core = await getCore();
  const load = isPlainTextLanguage(id)
    ? undefined
    : (LANGUAGE_LOADERS.get(id) ?? (isRuntimeLanguage(id) ? () => fetchGrammar(id) : undefined));
  if (load) await loadGrammar(core, id, load);
  return core.codeToHtml(code, {
    lang: id,
    themes: { light: "github-light", dark: "github-dark" },
  });
}
