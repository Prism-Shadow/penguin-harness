/**
 * Code rendering, in two layers.
 *
 * `CodeSurface` is the code itself: a `<pre>` highlighted via Shiki — inline CSS variables for
 * both the github-light / github-dark themes, with dark mode switched via style overrides under
 * html.dark (see styles.css), so theme switching doesn't require re-highlighting. The
 * highlighter is dynamically imported (its own chunk, loaded only once the first code block
 * appears; see highlighter.ts); before loading completes, and for languages that chunk doesn't
 * carry, it falls back to unhighlighted text. It carries no chrome at all, which is what lets
 * the Files panel put its source view and its editor on the same layer and know they agree.
 *
 * `CodeBlock` is that surface inside the chat message's chrome (visual reference:
 * better-chatbot's pre-block): a bordered box with a top bar carrying the language label and a
 * copy button. Message code blocks keep no line numbers and no wrapping — see the Files panel
 * for why wrapping is a file viewer's answer and not a transcript's.
 *
 * highlight=false (while a message is streaming) skips highlighting and falls back to plain
 * text: every streaming frame re-renders the full code with a growing length, and re-tokenizing
 * the whole block each time would be O(n^2) main-thread cost, and an in-progress highlight can't
 * be canceled; once streaming settles, highlight flips true and a single final highlight is done.
 */
import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { S } from "../../lib/strings";
import { CopyButton } from "../../components/ui/copy-button";

/**
 * The highlighted code, with no box around it.
 *
 * With `lineNumbers`, the lines become blocks (see highlighter.ts's BLOCK_LINES) so a CSS
 * counter can draw a gutter that survives wrapping, and the unhighlighted fallback is split
 * into the same line elements — one gutter, whichever path rendered the code, and one shape for
 * a caller that needs to lay something else over it.
 */
export function CodeSurface({
  language,
  code,
  highlight = true,
  lineNumbers = false,
  wrap = false,
  settleMs = 0,
  className = "",
  children,
}: {
  language: string;
  code: string;
  highlight?: boolean;
  /** Draw a line-number gutter (and, with it, put each line in a block of its own). */
  lineNumbers?: boolean;
  /** Soft-wrap long lines instead of scrolling sideways. */
  wrap?: boolean;
  /**
   * Wait this long after the last change before highlighting. 0 (the default) highlights every
   * change, which is right for code that is rendered once; an editor passes a delay so that
   * typing costs nothing but a re-render. While a highlight is pending the surface shows the
   * CURRENT text unhighlighted rather than the previous text's colours — a code layer that
   * lags the keystrokes it sits under is worse than a colourless one.
   */
  settleMs?: number;
  className?: string;
  /** Laid over the code in the same scroll box (the Files panel's editor puts its textarea here). */
  children?: ReactNode;
}) {
  const [highlighted, setHighlighted] = useState<{ code: string; html: string }>();

  useEffect(() => {
    if (!highlight) {
      setHighlighted(undefined);
      return;
    }
    let alive = true;
    const run = () => {
      void import("./highlighter")
        .then((mod) => mod.highlightToHtml(code, language, { blockLines: lineNumbers }))
        .then((out) => {
          if (alive && out !== undefined) setHighlighted({ code, html: out });
        })
        .catch(() => {
          // Unknown language / failed to load: keep the unhighlighted fallback.
        });
    };
    if (settleMs <= 0) {
      run();
      return () => {
        alive = false;
      };
    }
    const timer = window.setTimeout(run, settleMs);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [code, language, highlight, lineNumbers, settleMs]);

  // Split once per code change, and only where a gutter needs it: the digit count sizes the
  // gutter, and the unhighlighted fallback renders the lines it returns.
  const lines = useMemo(() => (lineNumbers ? code.split("\n") : null), [code, lineNumbers]);
  // Only the current text's own highlight may be shown (see settleMs).
  const html = highlighted?.code === code ? highlighted.html : undefined;
  /**
   * The `dangerouslySetInnerHTML` payload, held stable across renders that do not change the
   * markup. React compares this prop by object identity and re-sets `innerHTML` whenever it
   * differs, so a fresh `{ __html }` literal rebuilds every node in the block on every render
   * of the surrounding component — discarding any selection the reader had made inside it, and
   * re-parsing the whole highlighted body for nothing.
   */
  const htmlProp = useMemo(() => (html === undefined ? undefined : { __html: html }), [html]);

  return (
    <div
      className={`code-surface ${wrap ? "code-wrap" : "code-nowrap"} ${
        lines === null ? "" : "code-lines"
      } ${className}`}
      style={
        lines === null
          ? undefined
          : // `ch` and not `rem`: an overlaid textarea has to indent by exactly this much, and
            // only a character-relative unit is the same length in both layers. +2 is the
            // clearance between the number and the code.
            ({ "--code-gutter": `${String(lines.length).length + 2}ch` } as CSSProperties)
      }
    >
      {htmlProp !== undefined ? (
        <div dangerouslySetInnerHTML={htmlProp} />
      ) : (
        <pre>
          <code>
            {lines === null
              ? code
              : // No newline between the spans: they are blocks, and the text a selection
                // serialises out of a run of blocks already carries the breaks.
                lines.map((line, i) => (
                  <span key={i} className="line">
                    {line}
                  </span>
                ))}
          </code>
        </pre>
      )}
      {children}
    </div>
  );
}

export function CodeBlock({
  language,
  code,
  highlight = true,
}: {
  language: string;
  code: string;
  highlight?: boolean;
}) {
  return (
    <div className="code-block my-2 overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800">
      <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-3 py-1 dark:border-gray-800 dark:bg-gray-900">
        <span className="font-mono text-xs lowercase text-gray-500 dark:text-gray-400">
          {language || "text"}
        </span>
        {/* Always visible — the header bar has no hover-gated container. */}
        <CopyButton text={code} label={S.chat.copyCode} />
      </div>
      <div className="overflow-x-auto bg-white text-[13px] leading-relaxed dark:bg-gray-950">
        <CodeSurface language={language} code={code} highlight={highlight} />
      </div>
    </div>
  );
}
