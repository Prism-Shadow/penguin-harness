/**
 * The Shiki engine itself: the core, the lazily loaded grammars, and one call that turns code into
 * dual-theme HTML. The package's code components never import it: `CodeSurface` asks a
 * {@link CodeHighlighter} it is handed (by prop or by `CodeHighlighterProvider`), and the app
 * decides where the engine runs — the Web App runs it on a worker and falls back to this thread.
 * So it is published on its own subpath (`@prismshadow/penguin-ui/highlighter`), which a worker can
 * import without React, and kept out of the root barrel, so no static import of the barrel can put
 * a copy of Shiki in the entry chunk.
 *
 * Assembled from `shiki/core` with the language list in code-languages.ts instead of importing
 * `shiki` (its full bundle): that entry point drags in the oniguruma WASM engine and a registry of
 * all 332 bundled grammars, and both land on the *first* code block a conversation renders — 230 KB
 * gzip of WASM before a single token is colored. The pure-JS regex engine replaces it for free:
 * every pattern in every bundled grammar translates to a JS RegExp, and its token output is
 * byte-identical to oniguruma's. Measured on the Web App: ~308 KB -> ~70 KB gzip for the first
 * block.
 *
 * The trade is coverage — a fence in a language not listed in code-languages.ts renders
 * unhighlighted instead of highlighted, where the full bundle would have known it.
 *
 * Both themes of {@link CODE_THEMES} are baked into one pass: the light colours inline, the dark
 * ones as `--shiki-dark` variables that prose.css switches to under the dark mode, so switching
 * light/dark never re-highlights. Grammars load lazily and are cached per language, so a
 * conversation downloads only the languages it shows, once each.
 */
import { createHighlighterCore, type HighlighterCore, type LanguageInput } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { LANGUAGE_LOADERS, isPlainTextLanguage, resolveLanguage } from "./code-languages";
import type { HighlightOptions } from "./highlight-options";

export type { CodeHighlighter, CodeMark, HighlightOptions } from "./highlight-options";

/**
 * The syntax palette, one Shiki theme per mode. The token contract has no syntax colours, so every
 * app theme shares this pair; the surface around the code — its fill, rules, gutter and selection —
 * is the theme's own, from the `--ui-code-*` tokens.
 */
export const CODE_THEMES = { light: "github-light", dark: "github-dark" } as const;

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
 * Shiki separates its `<span class="line">` wrappers with a literal newline, which is what
 * breaks the lines when they stay inline. A gutter needs them to be blocks instead — only a
 * block takes the per-line padding and negative text-indent that keep a wrapped line's
 * continuation rows clear of its number — and those separators would then each add a blank
 * row of their own. Dropping them is this transformer's whole job; the line elements, and so
 * the text a selection serialises out of them, are untouched.
 */
const BLOCK_LINES = {
  code(node: { children: { type: string }[] }) {
    node.children = node.children.filter((child) => child.type !== "text");
  },
};

/**
 * Highlights `code` as `language`, returning Shiki's dual-theme HTML, or undefined when the
 * language isn't one this bundle carries. Rejects only on an unexpected failure (chunk fetch,
 * grammar error); callers fall back to unhighlighted text either way.
 *
 * `marks` wrap character ranges in an element of their own (Shiki's decorations), splitting the
 * tokens they cross — the diff viewer's changed words. Always a new element, never a class merged
 * onto a token or a line that a range happens to cover whole, so a line stays a bare
 * `<span class="line">` a caller can cut the markup at. Empty ranges are dropped; the ranges must
 * not overlap.
 */
export async function highlight(
  code: string,
  language: string,
  options: HighlightOptions = {},
): Promise<string | undefined> {
  const id = resolveLanguage(language);
  if (!id) return undefined;
  const core = await getCore();
  const load = isPlainTextLanguage(id) ? undefined : LANGUAGE_LOADERS.get(id);
  if (load) await loadGrammar(core, id, load);
  const decorations = (options.marks ?? [])
    .filter((mark) => mark.end > mark.start)
    .map((mark) => ({
      start: { line: mark.line, character: mark.start },
      end: { line: mark.line, character: mark.end },
      properties: { class: mark.className },
      alwaysWrap: true,
    }));
  return core.codeToHtml(code, {
    lang: id,
    themes: CODE_THEMES,
    ...(options.blockLines === true ? { transformers: [BLOCK_LINES] } : {}),
    ...(decorations.length > 0 ? { decorations } : {}),
  });
}
