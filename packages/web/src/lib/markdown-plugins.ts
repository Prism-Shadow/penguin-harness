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
 *
 * ## The rehype stage is loaded on demand
 *
 * The remark stage is small and always here. The rehype stage is KaTeX (markdown-katex.ts), which
 * is loaded by `import()` the first time a settled body contains a math delimiter, and never for
 * a page that shows no formula — it is a quarter of the entry bundle otherwise, paid on every
 * cold load by the phone that will only ever read the sidebar. Until it arrives (once per page
 * load), a body with math renders through the empty stage, which is exactly what a STREAMING body
 * renders through already: the formula shows its own TeX source, and typesets on the re-render
 * the load triggers. `useRehypeStage` is that decision as a hook; `<Markdown>`
 * (components/ui/markdown.tsx) is the one place it is called.
 */
import { useEffect, useSyncExternalStore } from "react";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type { Options } from "react-markdown";
import { remarkAutolinkBoundary } from "./remark-autolink-boundary";
import { remarkMathBrackets } from "./remark-math-brackets";
import { remarkMathDollars } from "./remark-math-dollars";

/** react-markdown's own plugin-list type, taken from its props so `unified` need not be a dep. */
type PluginList = NonNullable<Options["remarkPlugins"]>;
type RehypeList = NonNullable<Options["rehypePlugins"]>;

/** The remark (Markdown -> mdast) stage. */
export const REMARK_PLUGINS: PluginList = [
  remarkGfm,
  remarkAutolinkBoundary,
  [remarkMath, { singleDollarTextMath: false }],
  remarkMathBrackets,
  remarkMathDollars,
];

/**
 * The rehype stage for a message that is still streaming, and for any body until KaTeX has been
 * loaded: nothing, so the remark stage's own `math-*` elements reach the DOM carrying the TeX
 * source, and the formula is typeset once on the settle render.
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
export const NO_REHYPE_PLUGINS: RehypeList = [];

/**
 * Whether a body can contain math at all — the three delimiter openers the remark stage
 * recognises (`$$`, `\(`, `\[`), and nothing subtler: this decides whether to fetch KaTeX, not
 * whether to typeset, so a false positive costs one chunk load and a false negative would leave a
 * formula as source. A lone `$` is deliberately not one (single-dollar math is off, above).
 */
export function hasMath(text: string): boolean {
  return /\$\$|\\\(|\\\[/.test(text);
}

let katexStage: RehypeList | null = null;
let katexLoad: Promise<void> | null = null;
const listeners = new Set<() => void>();

/**
 * Starts the KaTeX load if it has not started; resolves once the stage is usable. Idempotent: one
 * import for the page, however many bodies asked. A failed load (offline mid-session, a stale
 * chunk after a push) leaves the stage unloaded so a later ask retries, and the bodies keep
 * showing their TeX source rather than nothing.
 */
export function loadKatexStage(): Promise<void> {
  katexLoad ??= import("./markdown-katex").then(
    (m) => {
      katexStage = m.REHYPE_PLUGINS;
      for (const notify of listeners) notify();
    },
    () => {
      katexLoad = null;
    },
  );
  return katexLoad;
}

function subscribe(notify: () => void): () => void {
  listeners.add(notify);
  return () => listeners.delete(notify);
}

const readStage = (): RehypeList | null => katexStage;

/**
 * The rehype stage for one body: KaTeX once the body has settled AND contains a delimiter AND the
 * chunk is here, the empty stage otherwise. Asking for the chunk is the effect; the store
 * subscription is what re-renders every waiting body the moment it lands.
 */
export function useRehypeStage(text: string, streaming: boolean): RehypeList {
  const loaded = useSyncExternalStore(subscribe, readStage, readStage);
  const wanted = !streaming && hasMath(text);
  useEffect(() => {
    if (wanted && loaded === null) void loadKatexStage();
  }, [wanted, loaded]);
  return wanted && loaded !== null ? loaded : NO_REHYPE_PLUGINS;
}
