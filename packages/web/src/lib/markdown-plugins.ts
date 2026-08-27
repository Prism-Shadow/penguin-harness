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
 * Three delimiter pairs are accepted, which is what it takes to cover what models actually emit:
 * `$$…$$` and `\[…\]` render as display math, `\(…\)` as inline. `remark-math` brings the dollar
 * form, `remarkMathBrackets` the TeX bracket forms (see its module comment for why those cannot be
 * a text-node rewrite), and `remarkMathDollars` makes a `$$…$$` pair display wherever it is written
 * rather than only when it stands alone on its own lines.
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
import { remarkMathDollars } from "./remark-math-dollars";

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

/** The remark (Markdown -> mdast) stage. */
export const REMARK_PLUGINS: PluginList = [
  remarkGfm,
  remarkAutolinkBoundary,
  [remarkMath, { singleDollarTextMath: false }],
  remarkMathBrackets,
  remarkMathDollars,
];

/**
 * The rehype (mdast -> hast) stage. `rehype-katex` turns every element the remark stage classed
 * `math-inline` / `math-display` into KaTeX's own markup, replacing it outright — which is also why
 * a `$$…$$` block never reaches the chat renderer's `<pre>` override and never becomes a CodeBlock.
 */
export const REHYPE_PLUGINS: NonNullable<Options["rehypePlugins"]> = [[rehypeKatex, KATEX_OPTIONS]];

/**
 * The rehype stage for a message that is still streaming: nothing, so the remark stage's own
 * `math-*` elements reach the DOM carrying the TeX source, and the formula is typeset once on the
 * settle render.
 *
 * KaTeX itself is cheap — ~0.3ms for a typical formula. What is not cheap is the rest of the stage
 * around it: `rehype-katex` re-parses KaTeX's ~2.5KB of markup per formula back into hast, and
 * React then builds several hundred elements from it. Measured through this pipeline with
 * `renderToStaticMarkup` on a 3.6KB reply carrying 60 formulas: 16ms for gfm alone, 13ms with the
 * math parsed but not rendered, 284ms for the full stage. Streamed in 40 deltas — chat bodies
 * re-parse on every delta, ~8 times a second — that is 196ms of total work without the rehype
 * stage and 2352ms with it, and it grows with the square of the reply's length. One oversized
 * formula shows the same shape on its own: a 16KB formula is 885ms per render, and a 20KB
 * paragraph accidentally wrapped by an unmatched `\[ … \]` is 856ms.
 *
 * Memoizing the produced hast per formula was measured too and is not enough: it cannot help the
 * formula that is still growing, which is the one being re-rendered, and it left 1853ms of the
 * 2352ms in place. This is the same trade as `highlight={!streaming}` for code blocks — the settle
 * render re-parses the message anyway, so it is where the expensive stage belongs.
 */
export const NO_REHYPE_PLUGINS: NonNullable<Options["rehypePlugins"]> = [];
