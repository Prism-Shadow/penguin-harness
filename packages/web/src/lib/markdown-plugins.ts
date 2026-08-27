/**
 * The unified pipeline every Markdown surface renders through.
 *
 * Shared so the five renderers cannot drift: a bare URL has to end at the same place, and a formula
 * has to render the same way, in a chat message, a Trace event, a benchmark case and a workspace
 * file preview. The lists are module constants rather than array literals at the call sites because
 * a fresh array is a new prop identity, and react-markdown rebuilds its whole processor when the
 * plugin list changes — per commit, on a path that already had to be memoized to stop an O(n²)
 * re-parse of the transcript while a reply streams.
 *
 * ## Math
 *
 * Four delimiter forms are accepted, which is what it takes to cover what models actually emit:
 * `$$…$$` and `\[…\]` render as display math, `\(…\)` as inline. `remark-math` brings the dollar
 * forms and `remarkMathBrackets` the TeX bracket forms (see its module comment for why those cannot
 * be a text-node rewrite).
 *
 * **Single-dollar inline math is off.** It is the one delimiter whose cost is paid by text that was
 * never meant to be math, and in this product that text is everywhere: `$PATH`, `$HOME`, prices.
 * `remark-math` rejects a span that starts or ends with whitespace, which saves a lone `$5`, but
 * two dollars in a sentence are enough and agent transcripts are full of pairs. Measured against
 * this repo's own idiom, with single-dollar math enabled:
 *
 *     Set $PATH and $HOME before running.  ->  Set <math>PATH and </math>HOME before running.
 *     It costs $5 and $10 in total.        ->  It costs <math>5 and </math>10 in total.
 *     The range is $5-$10 per seat.        ->  The range is <math>5-</math>10 per seat.
 *     echo $PATH; echo $HOME               ->  echo <math>PATH; echo </math>HOME
 *     Prices: $1,200 and $3,400.           ->  Prices: <math>1,200 and </math>3,400.
 *
 * Each of those loses its dollar signs, its spacing and its meaning. The failure in the other
 * direction is that someone writing `$x^2$` sees `$x^2$` — the source, legible, and re-typable as
 * `\(x^2\)`. Corrupting prose that was already correct is the worse trade, so the dollar pair is
 * reserved for `$$…$$`, which no shell variable or price produces by accident.
 */
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import type { Options } from "react-markdown";
import { remarkAutolinkBoundary } from "./remark-autolink-boundary";
import { remarkMathBrackets } from "./remark-math-brackets";

/** react-markdown's own plugin-list type, taken from its props so `unified` need not be a dep. */
type PluginList = NonNullable<Options["remarkPlugins"]>;

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
 * - `maxSize` — caps the em value any sizing command may claim, so `\rule{9999em}{9999em}` cannot
 *   blow the message layout apart. KaTeX defaults to Infinity.
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
  maxSize: 100,
} as const;

/** The remark (Markdown -> mdast) stage. */
export const REMARK_PLUGINS: PluginList = [
  remarkGfm,
  remarkAutolinkBoundary,
  [remarkMath, { singleDollarTextMath: false }],
  remarkMathBrackets,
];

/**
 * The rehype (mdast -> hast) stage. `rehype-katex` turns every element the remark stage classed
 * `math-inline` / `math-display` into KaTeX's own markup, replacing it outright — which is also why
 * a `$$…$$` block never reaches the chat renderer's `<pre>` override and never becomes a CodeBlock.
 *
 * KaTeX renders synchronously, and that is load-bearing rather than incidental: it keeps the whole
 * pipeline one pass, so the memoized chat body stays a pure function of its text and a streaming
 * message never shows a formula as raw source and then re-lays it out a frame later.
 */
export const REHYPE_PLUGINS: NonNullable<Options["rehypePlugins"]> = [[rehypeKatex, KATEX_OPTIONS]];
