/**
 * LaTeX's `\(…\)` and `\[…\]` delimiters, taught to remark as first-class math.
 *
 * `remark-math` understands `$…$` and `$$…$$` only, but models emit the TeX bracket forms
 * constantly — the report that prompted this feature was a pasted reply whose entire formula was
 * `\[\text{采集} \rightarrow …\]`. Without this, such replies render as prose littered with
 * backslash commands.
 *
 * **Why this is a syntax extension and not a text-node rewrite.** By CommonMark, a backslash before
 * any ASCII punctuation is a character escape, so `\[x\]` has *already* become the literal text
 * `[x]` by the time an mdast tree exists — the backslashes are gone, and nothing then distinguishes
 * it from a bracket someone typed. A plugin walking `text` nodes would have to guess, and guessing
 * means eating real brackets. Rewriting the source string before parsing is the other tempting
 * shortcut, and it is worse: to avoid corrupting code it would have to re-derive which spans are
 * fences, indented blocks and code spans of arbitrary backtick runs — reimplementing CommonMark,
 * badly, on the streaming path.
 *
 * Registering a micromark construct makes both problems disappear by construction. The tokenizer is
 * only consulted where inline content is read, so a `\[` inside a fenced block or a code span is
 * never offered to it — not "handled correctly", never seen. And because
 * `micromark-util-combine-extensions` splices extension constructs *before* the built-in ones at
 * the same character, this runs ahead of `characterEscape` and gets first refusal on every `\`;
 * when it declines — the next character is not `(`/`[`, or no closer arrives — micromark falls back
 * to the escape exactly as before, so a half-arrived `\[` mid-stream stays ordinary text and
 * settles into math once its closer lands.
 *
 * **What it produces.** Both forms become an mdast `inlineMath` node carrying explicit hast
 * instructions: a `<span>` classed `math math-inline` or `math math-display`, which is the contract
 * `rehype-katex` reads to pick KaTeX's display mode. Display math is deliberately a *span* rather
 * than the `<pre><code>` pair `remark-math` builds for `$$`: `\[…\]` is phrasing-level syntax that
 * may legally appear mid-sentence, and a `<div>` or `<pre>` inside the surrounding `<p>` would be
 * invalid nesting. KaTeX's own `.katex-display` wrapper supplies the centring and block layout, so
 * the span still reads as display math wherever it lands.
 *
 * **Known limits.** A `\[…\]` broken by a blank line spans two paragraphs and is not matched (a
 * blank line inside display math is not valid input anyway), and `\[a\\]` — a TeX line break butted
 * straight against the closer, ambiguous in TeX too — closes at the second backslash.
 */

/**
 * The micromark and mdast-util shapes this touches, declared structurally rather than adding
 * `micromark-util-types` and `mdast-util-from-markdown` as dependencies for a handful of
 * interfaces — the same trade `remark-autolink-boundary.ts` makes for its mdast nodes.
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
/**
 * The tokenize context, plus the one field this construct parks on it. micromark builds a fresh
 * context per run of inline content, so the memo below is scoped to a single paragraph.
 */
interface TokenizeContext {
  _mathBracketUnclosed?: Record<number, boolean>;
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

const BACKSLASH = 92;
const PAREN_OPEN = 40;
const PAREN_CLOSE = 41;
const BRACKET_OPEN = 91;
const BRACKET_CLOSE = 93;

/**
 * micromark feeds negative codes for the characters that are not really characters: -5 carriage
 * return, -4 line feed, -3 the pair, -2 tab, -1 virtual space. Its own `markdownLineEnding` is this
 * comparison, inlined rather than pulling in `micromark-util-character` for one predicate.
 */
function isLineEnding(code: Code): boolean {
  return code !== null && code < -2;
}

/** The wrapping token; its serialized slice is the whole `\[…\]`, delimiters included. */
const MATH = "mathBracket";
/** A two-character opening or closing delimiter. */
const MARKER = "mathBracketMarker";
/** A run of formula text with no line break in it. */
const VALUE = "mathBracketValue";
/**
 * A line break inside a formula, as its own token — not decoration.
 *
 * `micromark-util-subtokenize` stitches an inline token stream back onto the per-line chunks a
 * paragraph was split into by counting *void tokens that span a line break*, one per chunk
 * boundary. A single value token swallowing two newlines therefore reports one boundary where the
 * paragraph has two, and the stitch walks off the end of its buffer (`RangeError: Cannot access
 * index …`) — a crash, not a misrender. Every built-in inline construct that can span lines emits
 * these for the same reason.
 */
const LINE_ENDING = "lineEnding";

/**
 * Tokenizes `\(…\)` and `\[…\]`, entered on a `\` in inline content.
 *
 * The closing delimiter cannot be recognized without consuming its backslash first, and micromark
 * has no lookahead — so that backslash is consumed into a freshly opened marker token, and if the
 * character after it turns out not to be the closer (`\rightarrow`, `\\`, `\{`, …) the token is
 * re-typed as formula text and reading continues. Re-typing an open token in place is micromark's
 * own idiom for this; `micromark-extension-math` does the same when a `$` run proves too short to
 * close.
 */
function tokenizeMathBracket(
  this: TokenizeContext,
  effects: Effects,
  ok: State,
  nok: State,
): State {
  const self = this;
  /** The opening character, once known; keys the give-up memo below. */
  let opener = 0;
  /** The character that, preceded by a backslash, ends this formula. */
  let closer = 0;
  /** A marker token opened on a backslash that may or may not turn out to close the formula. */
  let pending: Token | undefined;

  return start;

  /**
   * Abandons the attempt, recording that this delimiter has no closer anywhere in the rest of the
   * paragraph.
   *
   * Reaching here means the scan ran to the end of the content without meeting the closer, so no
   * closer exists at or after this opener — and therefore none exists after any *later* opener of
   * the same kind either. Without that memo a paragraph carrying many unterminated openers costs
   * one full scan each: 1000 stray `\[` in an 18k-character paragraph measured at ~520ms of parse,
   * and chat bodies are re-parsed as they stream.
   */
  function giveUp(code: Code): State | undefined {
    (self._mathBracketUnclosed ??= {})[opener] = true;
    return nok(code);
  }

  function start(code: Code): State | undefined {
    effects.enter(MATH);
    effects.enter(MARKER);
    effects.consume(code); // The `\`, already known from the construct's character.
    return afterOpenBackslash;
  }

  function afterOpenBackslash(code: Code): State | undefined {
    if (code === PAREN_OPEN) closer = PAREN_CLOSE;
    else if (code === BRACKET_OPEN) closer = BRACKET_CLOSE;
    // Any other escape — `\*`, `\\`, a hard break — is not ours; micromark retries the built-ins.
    else return nok(code);
    opener = code;
    if (self._mathBracketUnclosed?.[opener]) return nok(code);
    effects.consume(code);
    effects.exit(MARKER);
    return valueStart;
  }

  /**
   * At a position where formula text may begin, with no value token open: just after the opening
   * delimiter, and again after every line break.
   *
   * Nothing is entered until there is a character to put in it. micromark's development build
   * asserts that no token is ever closed empty, so opening a value token eagerly and finding a
   * backslash or a newline in the very next position would abort the parse.
   */
  function valueStart(code: Code): State | undefined {
    if (code === null) return giveUp(code);
    if (code === BACKSLASH) return backslash(code);
    if (isLineEnding(code)) return lineEnding(code);
    effects.enter(VALUE);
    effects.consume(code);
    return value;
  }

  /** Inside an open value token, which therefore always holds at least one character. */
  function value(code: Code): State | undefined {
    // An unclosed formula at end of input: the value token is left open for `nok` to discard
    // along with the rest of this attempt's events.
    if (code === null) return giveUp(code);
    if (code === BACKSLASH) {
      effects.exit(VALUE);
      return backslash(code);
    }
    if (isLineEnding(code)) {
      effects.exit(VALUE);
      return lineEnding(code);
    }
    effects.consume(code);
    return value;
  }

  function lineEnding(code: Code): State | undefined {
    effects.enter(LINE_ENDING);
    effects.consume(code);
    effects.exit(LINE_ENDING);
    return valueStart;
  }

  /** Consumes a backslash into a marker token, on the chance that it opens the closing delimiter. */
  function backslash(code: Code): State | undefined {
    pending = effects.enter(MARKER);
    effects.consume(code);
    return afterValueBackslash;
  }

  function afterValueBackslash(code: Code): State | undefined {
    if (code === closer) {
      effects.consume(code);
      return afterClose;
    }
    // Not the closer after all: that backslash was formula text, so the token holding it becomes
    // one — non-empty already, which is what lets `value` take over from here.
    if (pending) pending.type = VALUE;
    return value(code);
  }

  function afterClose(code: Code): State | undefined {
    effects.exit(MARKER);
    effects.exit(MATH);
    return ok(code);
  }
}

/**
 * The micromark syntax extension: one construct on `\` in inline content. There is deliberately no
 * `flow` entry — display math is handled at the same inline level (see the module comment), which
 * is what lets `\[…\]` behave identically whether it stands alone or sits inside a sentence.
 */
const syntax = {
  text: { [BACKSLASH]: { tokenize: tokenizeMathBracket, name: MATH } },
};

/**
 * The mdast extension: the node is built on exit, where the whole `\[…\]` can be sliced in one go.
 * Which delimiter opened it is read back from that slice rather than threaded through the
 * tokenizer, so the two forms need no separate token types.
 */
const fromMarkdown = {
  enter: {
    [MATH](this: CompileContext, token: Token) {
      this.enter(
        {
          type: "inlineMath",
          value: "",
          // Filled in on exit; `mdast-util-to-hast` reads these to build the element.
          data: { hName: "span", hProperties: { className: [] }, hChildren: [] },
        },
        token,
      );
    },
  },
  exit: {
    [MATH](this: CompileContext, token: Token) {
      const node = this.stack[this.stack.length - 1]!; // Read before exit pops it.
      this.exit(token);
      const raw = this.sliceSerialize(token);
      // Both delimiters are exactly two characters, so the formula is everything between them.
      const value = raw.slice(2, -2);
      const display = raw.charCodeAt(1) === BRACKET_OPEN;
      node.value = value;
      node.data.hProperties.className = ["math", display ? "math-display" : "math-inline"];
      node.data.hChildren = [{ type: "text", value }];
    },
  },
};

/**
 * remark plugin: registers the syntax and mdast extensions above.
 *
 * Both lists are the ones `remark-parse` hands to micromark and `mdast-util-from-markdown`, which
 * is also how `remark-math` installs itself — so the two coexist without either knowing about the
 * other, each owning its own delimiter character.
 */
export function remarkMathBrackets(this: { data(): ProcessorData }): undefined {
  const data = this.data();
  (data.micromarkExtensions ??= []).push(syntax);
  (data.fromMarkdownExtensions ??= []).push(fromMarkdown);
}
