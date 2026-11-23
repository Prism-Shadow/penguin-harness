/**
 * Emphasis in chat Markdown: the CJK-friendly flanking rule, plus bold that closes after closing
 * punctuation whatever follows.
 *
 * Under CommonMark a `**` that follows punctuation closes a span only when whitespace or more
 * punctuation comes next; the CJK-friendly rule (`micromark-extension-cjk-friendly`) adds a CJK
 * character. A letter or a digit is still left out, so `**Confirmed.**Next` and `**端口:**7364`
 * keep their asterisks: the model dropped a space, and the reader sees markup.
 *
 * So a run of two or more `*` directly after one of `. , : ; ! ? ) ] }` may close as well. Those
 * marks end what stands before them, which is why the run reads as a closer; an opening bracket
 * or a quote before a run still makes it an opener only, so `f(**kwargs)` and bold inside quotes
 * parse as they did. A single `*` and `_` are untouched: they turn up in code-like prose
 * (`(*args)`, `snake_case`) far more often than a missing space does.
 *
 * It wraps the extension's attention construct rather than replacing it. That construct decides
 * `_open` and `_close` on the sequence token it has just closed, then hands over; the wrapper
 * adds its one case in between, and pairing stays the extension's.
 *
 * Types are declared structurally, as in bare-url.ts.
 */
import { cjkFriendlyExtension } from "micromark-extension-cjk-friendly";

type Code = number | null;
type State = (code: Code) => State | undefined;
interface SequenceToken {
  start: { offset: number };
  end: { offset: number };
  _close?: boolean;
}
interface Effects {
  exit(type: string): SequenceToken;
}
interface Construct {
  tokenize(this: { previous: Code }, effects: Effects, ok: State, nok: State): State;
}

const ASTERISK = 42;
const CLOSING_PUNCTUATION = new Set(Array.from(".,:;!?)]}", (c) => c.charCodeAt(0)));

function closingAfterPunctuation(attention: Construct): Construct {
  return {
    ...attention,
    tokenize(effects, ok, nok) {
      const { previous } = this;
      let sequence: SequenceToken | undefined;
      const tapped: Effects = {
        ...effects,
        exit(type) {
          sequence = effects.exit(type);
          return sequence;
        },
      };
      const done: State = (code) => {
        if (
          sequence !== undefined &&
          sequence.end.offset - sequence.start.offset > 1 &&
          previous !== null &&
          CLOSING_PUNCTUATION.has(previous)
        ) {
          sequence._close = true;
        }
        return ok(code);
      };
      return attention.tokenize.call(this, tapped, done, nok);
    },
  };
}

/** The micromark extension: CJK-friendly emphasis, with the asterisk construct wrapped. */
export function emphasisSyntax(): unknown {
  const extension = cjkFriendlyExtension() as unknown as { text: Record<number, Construct> };
  return {
    ...extension,
    text: { ...extension.text, [ASTERISK]: closingAfterPunctuation(extension.text[ASTERISK]!) },
  };
}
