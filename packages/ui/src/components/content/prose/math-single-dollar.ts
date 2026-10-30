/**
 * Single-dollar inline math, `$…$`, under a rule that leaves shell variables and prices as text.
 *
 * ## The rule
 *
 * - A `$` **opens** a formula when the character after it is neither whitespace nor `$`, and the
 *   character before it is not an ASCII letter, digit, `\` or `$` (the start of a line is fine).
 * - The formula runs to the first `$` after the opener that is not part of a backslash pair (`\$`
 *   inside a formula is TeX's dollar sign). That `$` **closes** it when the character before it is
 *   not whitespace and the character after it is not an ASCII letter or digit — CJK and
 *   punctuation after a closer are fine, so `$n-1=2$，` and `$n$）` close.
 * - If that first `$` does not close, the opener opens nothing: the scan never skips ahead to a
 *   later `$`. A line break, a backtick or the end of the paragraph before the closer ends the
 *   attempt the same way.
 *
 * This is Pandoc's `tex_math_dollars` rule tightened three ways. Pandoc only refuses a closer
 * followed by a *digit*, which still makes math of `PATH=$HOME/bin:$PATH` (`HOME/bin:`) and of
 * `"$A$B"` (`A`); refusing letters too is what keeps shell text whole. The check on the
 * character before the opener keeps `US$5`, `a$b` and a `$` after a literal backslash (`\\$`)
 * from opening. And a formula stays on one line, where Pandoc lets it cross one line break. The price is that a formula glued to a
 * word, `$i$th` or `$k$s`, stays text — `$i$-th` or `\(i\)th` render. The counterexamples this
 * rule was measured against are listed in markdown-plugins.ts.
 *
 * "The first `$` decides" matters as much as either check: in `costs $5 and $x$ here`, the `$`
 * before `x` cannot close `$5` (a space precedes it), and a scan that went on looking would find
 * the closer after `x` and typeset `5 and $x`. Stopping there instead leaves `$5` as text and lets
 * `$x$` open on its own.
 *
 * ## Why a micromark construct
 *
 * For the reasons remark-math-brackets.ts gives: by the time an mdast tree exists, escapes are
 * resolved and emphasis is split, so `$\{a\}$` has lost its backslashes and `$x*y*z$` has become
 * `x`, an `<em>y</em>` and `z`. A construct reads the source characters before either happens, and
 * micromark only offers it the `$`s of inline content, so a `$` in a code span or a fenced or
 * indented block is never seen. Once inside a formula the scan reads raw characters, so it declines
 * at a backtick itself, as the bracket construct does: otherwise a closer inside a code span
 * (``$a `b$` c``) would swallow the span's opening backtick.
 *
 * `remark-math` keeps `$$`. It is registered with `singleDollarTextMath: false`, so its text
 * construct gives up on a lone `$`, and this one gives up on `$$` — the two never compete for the
 * same characters. This plugin is listed after `remark-math` in REMARK_PLUGINS, which puts its
 * construct first at `$` (micromark splices each later extension's constructs ahead of the earlier
 * ones). A `\$` outside a formula is a character escape, and the escape construct consumes both
 * characters before any `$` construct is asked, so an escaped dollar sign stays one.
 *
 * ## What it produces
 *
 * An mdast `inlineMath` node, rendered as a `<span class="math math-inline">` holding the TeX —
 * the contract the bracket construct uses, which `rehype-katex` typesets, the streaming stage shows
 * as source, and find-in-page and copy already handle.
 *
 * ## While a reply streams
 *
 * Whether a `$` closes depends on the character after it, which a streaming reply may not have
 * received yet. Typeset at the edge, `export PATH=$HOME/bin:$` would show `HOME/bin:` without its
 * dollar signs for a frame, then get them back when `P` arrives. `rehypeSingleDollarEdge`, in the
 * streaming rehype stage only, shows a single-dollar formula that ends at the very end of the text
 * received so far as its own source until the next character decides it. A settled message ends
 * where it ends, so its last formula renders.
 */

/**
 * The micromark, mdast and hast shapes this touches, declared structurally rather than adding
 * `micromark-util-types`, `mdast-util-from-markdown` and `@types/hast` as dependencies for a
 * handful of interfaces — the same trade the sibling plugins make.
 */
type Code = number | null;
interface Token {
  type: string;
}
interface Effects {
  enter(type: string): Token;
  exit(type: string): Token;
  consume(code: Code): void;
}
type State = (code: Code) => State | undefined;
/** The tokenize context's one field this reads: the character before the construct's `$`. */
interface TokenizeContext {
  previous: Code;
}
interface HastText {
  type: "text";
  value: string;
}
interface MathNode {
  type: "inlineMath";
  value: string;
  data: { hName: string; hProperties: { className: string[] }; hChildren: HastText[] };
}
/** The subset of mdast-util-from-markdown's compile context these handlers use. */
interface CompileContext {
  stack: MathNode[];
  enter(node: MathNode, token: Token): void;
  exit(token: Token): void;
  sliceSerialize(token: Token): string;
}
/** The `this.data()` bag unified plugins share to register parser extensions. */
interface ProcessorData {
  micromarkExtensions?: unknown[];
  fromMarkdownExtensions?: unknown[];
}
interface Point {
  offset?: number;
}
interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: { className?: unknown };
  position?: { start: Point; end: Point };
  children?: HastNode[];
}

const DOLLAR = 36;
const BACKSLASH = 92;
const BACKTICK = 96;

/**
 * micromark's negative codes: -5 carriage return, -4 line feed, -3 the pair, -2 tab, -1 virtual
 * space. Its own `markdownLineEnding` is this comparison, inlined rather than pulling in
 * `micromark-util-character` for one predicate.
 */
function isLineEnding(code: Code): boolean {
  return code !== null && code < -2;
}

const WHITESPACE = /\s/;

/** Whitespace of any kind: the negative codes are all line endings, tabs or virtual spaces. */
function isWhitespace(code: Code): boolean {
  return code !== null && (code < 0 || WHITESPACE.test(String.fromCharCode(code)));
}

function isAsciiAlphanumeric(code: Code): boolean {
  return (
    code !== null &&
    ((code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122))
  );
}

/** Whether a `$` after `code` may open a formula; `null` is the start of the inline content. */
function opensAfter(code: Code): boolean {
  return !(isAsciiAlphanumeric(code) || code === BACKSLASH || code === DOLLAR);
}

/** The wrapping token; its serialized slice is the whole `$…$`, delimiters included. */
const MATH = "mathSingleDollar";
/** The opening or the closing `$`. */
const MARKER = "mathSingleDollarMarker";
/** The formula between them: one line, never empty. */
const VALUE = "mathSingleDollarValue";

/**
 * Tokenizes `$…$`, entered on a `$` in inline content. Every refusal is `nok`, which hands the
 * `$` back to micromark as ordinary text; there is no memo of failed openers because none is
 * needed — each attempt stops at the next `$`, backtick or line break, so every stretch of a
 * paragraph is scanned at most once.
 */
function tokenizeSingleDollar(
  this: TokenizeContext,
  effects: Effects,
  ok: State,
  nok: State,
): State {
  const self = this;
  /** The last character read was whitespace, outside a backslash pair. */
  let afterSpace = false;

  return start;

  function start(code: Code): State | undefined {
    // Checked here as well as in the construct's `previous`: micromark offers every construct
    // registered on `$` once any one of them accepts the character before it, and remark-math's
    // accepts nearly every character.
    if (!opensAfter(self.previous)) return nok(code);
    effects.enter(MATH);
    effects.enter(MARKER);
    effects.consume(code);
    effects.exit(MARKER);
    return open;
  }

  /** Just after the opener: the formula's first character. */
  function open(code: Code): State | undefined {
    // `$$` is remark-math's; whitespace or the end of the paragraph opens nothing.
    if (code === null || code === DOLLAR || code === BACKTICK || isWhitespace(code)) {
      return nok(code);
    }
    // micromark's development build asserts that no token closes empty; this one opens on a
    // character `inside` is about to consume.
    effects.enter(VALUE);
    return inside(code);
  }

  function inside(code: Code): State | undefined {
    if (code === null || code === BACKTICK || isLineEnding(code)) return nok(code);
    if (code === DOLLAR) {
      if (afterSpace) return nok(code);
      effects.exit(VALUE);
      effects.enter(MARKER);
      effects.consume(code);
      effects.exit(MARKER);
      return close;
    }
    effects.consume(code);
    if (code === BACKSLASH) return escaped;
    afterSpace = isWhitespace(code);
    return inside;
  }

  /** The character after a backslash, consumed as a pair: `\$` and `\ ` do not end anything. */
  function escaped(code: Code): State | undefined {
    if (code === null || code === BACKTICK || isLineEnding(code)) return nok(code);
    effects.consume(code);
    afterSpace = false;
    return inside;
  }

  /** Just after the closer, which only counts if a letter or digit does not follow it. */
  function close(code: Code): State | undefined {
    if (isAsciiAlphanumeric(code)) return nok(code);
    effects.exit(MATH);
    return ok(code);
  }
}

/** The micromark syntax extension: one text construct on `$`, nothing at the flow level. */
const syntax = {
  text: {
    [DOLLAR]: { tokenize: tokenizeSingleDollar, previous: opensAfter, name: MATH },
  },
};

/** The mdast extension: the node is built on exit, where the whole `$…$` can be sliced at once. */
const fromMarkdown = {
  enter: {
    [MATH](this: CompileContext, token: Token) {
      this.enter(
        {
          type: "inlineMath",
          value: "",
          // Filled in on exit; `mdast-util-to-hast` reads these to build the element.
          data: {
            hName: "span",
            hProperties: { className: ["math", "math-inline"] },
            hChildren: [],
          },
        },
        token,
      );
    },
  },
  exit: {
    [MATH](this: CompileContext, token: Token) {
      const node = this.stack[this.stack.length - 1]!; // Read before exit pops it.
      this.exit(token);
      const value = this.sliceSerialize(token).slice(1, -1);
      node.value = value;
      node.data.hChildren = [{ type: "text", value }];
    },
  },
};

/**
 * remark plugin: registers the syntax and mdast extensions above, through the same lists
 * `remark-math` and `remarkMathBrackets` install themselves on.
 */
export function remarkMathSingleDollar(this: { data(): ProcessorData }): undefined {
  const data = this.data();
  (data.micromarkExtensions ??= []).push(syntax);
  (data.fromMarkdownExtensions ??= []).push(fromMarkdown);
}

/** A formula this module produced, ending exactly where the text received so far ends. */
function atTheEdge(node: HastNode, source: string): boolean {
  if (node.type !== "element" || node.tagName !== "span") return false;
  const className = node.properties?.className;
  if (!Array.isArray(className) || !className.includes("math-inline")) return false;
  const start = node.position?.start.offset;
  if (start === undefined || node.position?.end.offset !== source.length) return false;
  // `\(…\)` is a `math-inline` span too; only a single `$` leaves its closer undecided.
  return source[start] === "$" && source[start + 1] !== "$";
}

/** Swaps the edge formula, wherever it is nested, for a text node carrying its own source. */
function settleEdge(parent: HastNode, source: string): void {
  const children = parent.children ?? [];
  for (let index = 0; index < children.length; index++) {
    const child = children[index]!;
    if (atTheEdge(child, source)) {
      const { start, end } = child.position!;
      // The source slice is what the reader would see had the construct declined, and the
      // position lets the arrivals pass (stream-arrivals.ts) split it like any other text.
      children[index] = {
        type: "text",
        value: source.slice(start.offset, end.offset),
        position: child.position,
      };
    } else {
      settleEdge(child, source);
    }
  }
}

/**
 * rehype plugin for the streaming stage: a single-dollar formula whose closer is the last
 * character received is shown as source until the next character decides whether it closes.
 */
export function rehypeSingleDollarEdge() {
  return (tree: HastNode, file: { value?: unknown }): void =>
    settleEdge(tree, String(file.value ?? ""));
}
