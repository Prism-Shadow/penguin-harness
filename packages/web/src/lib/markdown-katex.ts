/**
 * The KaTeX half of the Markdown pipeline, in a chunk of its own.
 *
 * KaTeX is the single largest thing the entry bundle used to carry, and most page loads never
 * typeset a formula: a sidebar, a settings page, a chat with no math. So this module is reached
 * only by `import()` — from `loadKatexStage` in markdown-plugins.ts, the first time a settled
 * body actually contains a math delimiter — and the entry stays free of it. The stylesheet rides
 * along: Vite emits it as this chunk's own CSS and loads it before the chunk resolves, so no
 * formula renders unstyled. It lands AFTER styles.css in the cascade, which is fine because every
 * rule styles.css has on KaTeX markup outranks KaTeX's own on specificity, not on order (see the
 * KaTeX section there); the woff2 faces are the same local assets as before (vite.config.ts).
 *
 * Nothing but markdown-plugins.ts and its test may import this module statically: a static
 * import anywhere on the entry's graph puts KaTeX back into the entry.
 */
import rehypeKatex from "rehype-katex";
import type { Options } from "react-markdown";
import "katex/dist/katex.min.css";

/**
 * KaTeX settings for untrusted input, because that is what this renders: model output, and files
 * out of a Workspace.
 *
 * - `strict: "ignore"` — KaTeX's default warns to the console for every LaTeX-incompatible but
 *   renderable construct, and sloppy `\text` around CJK trips it per character. The warnings are
 *   not actionable by anyone reading a chat transcript, and the render is identical either way.
 * - `errorColor: "currentColor"` — the default `#cc0000` is an inline style, so it cannot adapt to
 *   the dark theme, where it lands under 4:1 against a black background. Failed expressions instead
 *   render as their own source in the body colour; `.katex-error` in styles.css marks them with a
 *   dotted underline and keeps KaTeX's parse error in the `title` tooltip.
 * - `trust: false` (KaTeX's default, restated because it is a boundary) — leaves `\href`, `\url`
 *   and `\includegraphics` inert, so a formula cannot smuggle in a link or an image request.
 * - `maxSize` — caps the em value any sizing command may claim. KaTeX defaults to Infinity, so
 *   `\rule{9999em}{9999em}` is a black square the size of the viewport many times over; 5em is
 *   80px at a 16px root, which a message body absorbs the way it absorbs an emoji. Every sizing
 *   command a real formula uses — a `\rule` for a fraction bar, a `\raisebox`, an array row gap,
 *   `\hspace{1cm}` — is well under it.
 *
 * `throwOnError` is *not* here, and cannot be: `rehype-katex` omits it from its options type
 * because it owns that behaviour. It renders once strictly, and on any error re-renders with
 * `throwOnError: false`, falling back to a `.katex-error` span holding the original source. That is
 * exactly the required degradation — a malformed expression shows its own text instead of taking
 * the message down with it — so there is nothing to override.
 */
const KATEX_OPTIONS = {
  strict: "ignore",
  errorColor: "currentColor",
  trust: false,
  maxSize: 5,
} as const;

/**
 * The rehype (mdast -> hast) stage. `rehype-katex` turns every element the remark stage classed
 * `math-inline` / `math-display` into KaTeX's own markup, replacing it outright — which is also why
 * a `$$…$$` block never reaches the chat renderer's `<pre>` override and never becomes a CodeBlock.
 */
export const REHYPE_PLUGINS: NonNullable<Options["rehypePlugins"]> = [[rehypeKatex, KATEX_OPTIONS]];
