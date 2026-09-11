/**
 * Code block (visual reference: better-chatbot's pre-block): top bar = language label + copy
 * button, body highlighted via Shiki — inline CSS variables for both the github-light /
 * github-dark themes, with dark mode switched via style overrides under html.dark (see
 * styles.css), so theme switching doesn't require re-highlighting.
 * The highlighter is dynamically imported (its own chunk, loaded only once the first code block
 * appears; see highlighter.ts); before loading completes, and for languages that chunk doesn't
 * carry, it falls back to an unhighlighted <pre>.
 *
 * highlight=false (while a message is streaming) skips highlighting and falls back to plain
 * text: every streaming frame re-renders the full code with a growing length, and re-tokenizing
 * the whole block each time would be O(n^2) main-thread cost, and an in-progress highlight can't
 * be canceled; once streaming settles, highlight flips true and a single final highlight is done.
 */
import { Fragment, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { S } from "../../lib/strings";
import { CopyButton } from "../../components/ui/copy-button";

export function CodeBlock({
  language,
  code,
  highlight = true,
  lineNumbers = false,
}: {
  language: string;
  code: string;
  highlight?: boolean;
  /**
   * Number the lines in a gutter (the Files panel's source view). Off for message code
   * blocks, which is every other caller: a reply's fenced snippet is prose, and numbering
   * it would invite a reader to cite a line that exists nowhere.
   */
  lineNumbers?: boolean;
}) {
  const [html, setHtml] = useState<string>();
  // Split once per code change, and only where a gutter needs it: the number of digits sizes
  // the gutter on both paths, and the unhighlighted fallback renders the lines it returns.
  const lines = useMemo(() => (lineNumbers ? code.split("\n") : null), [code, lineNumbers]);

  useEffect(() => {
    if (!highlight) {
      setHtml(undefined);
      return;
    }
    let alive = true;
    void import("./highlighter")
      .then((mod) => mod.highlightToHtml(code, language))
      .then((out) => {
        if (alive) setHtml(out);
      })
      .catch(() => {
        // Unknown language / failed to load: keep the unhighlighted fallback.
        if (alive) setHtml(undefined);
      });
    return () => {
      alive = false;
    };
  }, [code, language, highlight]);

  return (
    <div className="code-block my-2 overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800">
      <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-3 py-1 dark:border-gray-800 dark:bg-gray-900">
        <span className="font-mono text-xs lowercase text-gray-500 dark:text-gray-400">
          {language || "text"}
        </span>
        {/* Always visible — the header bar has no hover-gated container. */}
        <CopyButton text={code} label={S.chat.copyCode} />
      </div>
      {/* The gutter is drawn by styles.css from a counter on the per-line spans, which is why
          the fallback below splits into the same `line` spans Shiki emits: one gutter, whichever
          path rendered the code. Its width is the file's own digit count, so a three-digit line
          number does not shove the code sideways halfway down the file. */}
      <div
        className={`overflow-x-auto bg-white text-[13px] leading-relaxed dark:bg-gray-950${
          lines === null ? "" : " code-lines"
        }`}
        style={
          lines === null
            ? undefined
            : ({
                "--code-gutter": `${Math.max(2, String(lines.length).length)}ch`,
              } as CSSProperties)
        }
      >
        {html ? (
          <div dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <pre className="m-0 px-3 py-2.5 font-mono text-gray-800 dark:text-gray-200">
            <code>
              {lines === null
                ? code
                : lines.map((line, i) => (
                    // The newline sits BETWEEN the spans, as Shiki writes it: inside them, a
                    // selection of one whole line would carry a trailing break the file has
                    // after it, not in it.
                    <Fragment key={i}>
                      <span className="line">{line}</span>
                      {i < lines.length - 1 ? "\n" : ""}
                    </Fragment>
                  ))}
            </code>
          </pre>
        )}
      </div>
    </div>
  );
}
