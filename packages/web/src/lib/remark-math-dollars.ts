/**
 * `$$…$$` is display math wherever it is written, not only when it stands alone on its own lines.
 *
 * `remark-math` has two constructs for the dollar forms. The flow one — `$$` alone on a line, the
 * formula, `$$` alone on a line — is display. Everything else is its *text* construct, which is
 * inline whatever the run length: `$$E=mc^2$$` on one line, and `text $$E=mc^2$$ text`, both come
 * out as inline math. That is a run-length rule, not a TeX one. In TeX `$$` has meant display since
 * plain TeX, `$` alone means inline, and single-dollar math is off here — so a `$$` pair in this
 * app can only have been meant as display, and models emit it on one line constantly.
 *
 * Leaving it inline had a layout cost as well as a typographic one. KaTeX sets
 * `.katex .base { white-space: nowrap }`, so a long single-line `$$…$$` is one unbreakable run.
 * `.md-body .katex-display` scrolls inside its own block; an inline run has to be caught by the
 * separate guard in styles.css, and even caught it is still typeset cramped — inline mode uses
 * small integrals, small sums and squeezed fractions for a formula the author centred.
 *
 * So every text-math node opened by a dollar run is re-classed to display, which is also what makes
 * `$$…$$` and `\[…\]` behave identically (see remark-math-brackets.ts). The delimiter is read back
 * from the source rather than from the class list, because `remark-math` and `remarkMathBrackets`
 * both produce `inlineMath` nodes and only the source separates them.
 */

/**
 * The mdast shapes this touches, declared structurally rather than pulling `@types/mdast` and
 * `mdast-util-math` in as dependencies for two of them — the same trade the sibling plugins make.
 */
interface Node {
  type: string;
  position?: { start?: { offset?: number } };
  data?: { hProperties?: { className?: unknown } };
  children?: Node[];
}

const DOLLAR = "$";
const INLINE_CLASS = "math-inline";
const DISPLAY_CLASS = "math-display";

/** Re-classes one node if it is a dollar-delimited text-math node. */
function promote(node: Node, source: string): void {
  if (node.type !== "inlineMath") return;
  const offset = node.position?.start?.offset;
  // `\(…\)` and `\[…\]` are `inlineMath` too, and already carry the class they want.
  if (offset === undefined || source[offset] !== DOLLAR) return;
  const className = node.data?.hProperties?.className;
  if (!Array.isArray(className)) return;
  const index = className.indexOf(INLINE_CLASS);
  // `rehype-katex` picks KaTeX's display mode off this class, and drops the element either way.
  if (index !== -1) className[index] = DISPLAY_CLASS;
}

/** Walks every parent, so a formula inside a table cell, a heading or a list item is covered too. */
function walk(node: Node, source: string): void {
  for (const child of node.children ?? []) {
    promote(child, source);
    walk(child, source);
  }
}

/** Runs after remark-math, on the tree it produced. */
export function remarkMathDollars() {
  return (tree: Node, file: { value?: unknown }): void => walk(tree, String(file.value ?? ""));
}
