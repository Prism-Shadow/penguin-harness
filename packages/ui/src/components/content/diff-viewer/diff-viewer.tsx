/**
 * A diff, unified or side by side: hunk headers, both line numbers, the removed and added lines on
 * the theme's diff washes (`--ui-diff-*`), the words that changed within a paired line on the
 * stronger wash, and the code highlighted like any other code surface.
 *
 * It takes two texts (and computes the line diff, diff.ts) or a unified patch (and draws its hunks
 * as given). Highlighting goes through the same {@link CodeHighlighter} as `CodeSurface` — the
 * `highlight` prop, or the nearest `CodeHighlighterProvider`'s — once per side: the old side (the
 * context and removed lines) and the new (the context and added lines), each with its changed
 * words marked so the highlighter wraps them between tokens. Until that answers, or with no
 * highlighter, the lines render plain with the same word marks.
 *
 * A removed line's text is a `<del>` and an added line's an `<ins>`, so a screen reader announces
 * the change and not only a colour; the `-` / `+` sign stays visible and is left out of a copy.
 * The look is in prose.css (`.code-diff`) and the classes below.
 */
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { resolveHighlighter, useCodeHighlighter } from "../code-block/code-block";
import type { CodeHighlighter } from "../code-block/highlight-options";
import {
  DIFF_WORD_CLASS,
  diffTexts,
  parsePatch,
  splitHighlightedLines,
  splitRows,
  wordMarks,
} from "./diff";
import type { DiffLine, DiffModel, WordRange } from "./diff";
import "../prose/prose.css";

export type DiffMode = "unified" | "split";

interface DiffViewerBase {
  /** The language both sides are highlighted as; plain text by default. */
  language?: string;
  mode?: DiffMode;
  /** Soft-wrap long lines instead of scrolling sideways. */
  wrap?: boolean;
  /** As on `CodeSurface`: `true` the provider's highlighter, a function that one, `false` none. */
  highlight?: boolean | CodeHighlighter;
  /** The table's accessible name ("Changes to app.ts"). */
  label?: string;
  className?: string;
}

export type DiffViewerProps = DiffViewerBase &
  (
    | {
        before: string;
        after: string;
        /** Unchanged lines kept around each change; 3 by default. */
        context?: number;
        patch?: never;
      }
    | { patch: string; before?: never; after?: never; context?: never }
  );

/** The highlighted markup of each side, per line, for the model it was made from. */
interface SideMarkup {
  model: DiffModel;
  oldSide: readonly { __html: string }[] | null;
  newSide: readonly { __html: string }[] | null;
}

const ROW: Record<DiffLine["kind"], string> = {
  context: "",
  add: "bg-[var(--ui-diff-add-bg)]",
  del: "bg-[var(--ui-diff-del-bg)]",
};
const SIGN: Record<DiffLine["kind"], string> = { context: " ", add: "+", del: "-" };
const NUMBER_CELL =
  "w-px select-none whitespace-nowrap px-2 text-right align-top text-[var(--ui-code-gutter)]";
const SIGN_CELL = "w-px select-none pl-2 align-top text-fg-subtle";

/** A line's text with its changed words wrapped, for the unhighlighted rendering. */
function plainWords(text: string, words: readonly WordRange[]): ReactNode {
  if (words.length === 0) return text;
  const out: ReactNode[] = [];
  let at = 0;
  for (const [start, end] of words) {
    if (start > at) out.push(text.slice(at, start));
    out.push(
      <span key={start} className={DIFF_WORD_CLASS}>
        {text.slice(start, end)}
      </span>,
    );
    at = end;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

/** The side a line's markup is found in. */
function sideOf(markup: SideMarkup | null, line: DiffLine) {
  const side = line.kind === "del" ? markup?.oldSide : markup?.newSide;
  return side?.[line.at];
}

/** One line's code: `<del>` / `<ins>` for a change, highlighted markup when there is some. */
function LineCode({ line, markup }: { line: DiffLine; markup: SideMarkup | null }) {
  const html = sideOf(markup, line);
  const Tag = line.kind === "del" ? "del" : line.kind === "add" ? "ins" : "span";
  return html === undefined ? (
    <Tag>{plainWords(line.text, line.words)}</Tag>
  ) : (
    // `shiki` lets the dark palette rule reach the token spans inside.
    <Tag className="shiki" dangerouslySetInnerHTML={html} />
  );
}

/** A diff of two texts or a unified patch. */
export function DiffViewer(props: DiffViewerProps) {
  const {
    language = "text",
    mode = "unified",
    wrap = false,
    highlight = true,
    label,
    className = "",
  } = props;
  const { before, after, patch, context } = props;
  const model = useMemo(
    () =>
      patch !== undefined ? parsePatch(patch) : diffTexts(before ?? "", after ?? "", context ?? 3),
    [before, after, patch, context],
  );
  const highlighter = resolveHighlighter(highlight, useCodeHighlighter());
  const [markup, setMarkup] = useState<SideMarkup | null>(null);

  useEffect(() => {
    if (highlighter === null) return;
    let alive = true;
    const side = (lines: readonly string[], kind: "add" | "del"): Promise<string[] | null> =>
      lines.length === 0
        ? Promise.resolve(null)
        : Promise.resolve()
            .then(() =>
              highlighter(lines.join("\n"), language, {
                blockLines: true,
                marks: wordMarks(model, kind),
              }),
            )
            .then((html) => (html === undefined ? null : splitHighlightedLines(html, lines.length)))
            .catch(() => null);
    void Promise.all([side(model.oldSide, "del"), side(model.newSide, "add")]).then(
      ([oldLines, newLines]) => {
        if (!alive) return;
        // Built once per highlight, so every row keeps the same payload object across renders.
        const payloads = (lines: string[] | null) => lines?.map((__html) => ({ __html })) ?? null;
        setMarkup({ model, oldSide: payloads(oldLines), newSide: payloads(newLines) });
      },
    );
    return () => {
      alive = false;
    };
  }, [model, language, highlighter]);

  // Only the current model's markup is drawn; a stale one would put old lines on new rows.
  const current = highlighter !== null && markup?.model === model ? markup : null;
  const code = wrap ? "whitespace-pre-wrap [overflow-wrap:anywhere]" : "whitespace-pre";

  const hunkRow = (header: string, span: number) => (
    <tr className="bg-[var(--ui-diff-hunk-bg)] text-fg-muted">
      <td colSpan={span} className="select-none px-3 py-1">
        {header}
      </td>
    </tr>
  );

  return (
    <div
      className={`code-diff overflow-hidden rounded-lg border border-[var(--ui-code-line)] bg-canvas ${className}`}
    >
      <div className="overflow-x-auto">
        <table
          aria-label={label}
          className="w-full border-collapse font-mono text-[length:var(--ui-text-code-size)] leading-relaxed"
        >
          {model.hunks.map((hunk, h) => (
            <tbody key={h}>
              {hunkRow(hunk.header, mode === "split" ? 6 : 4)}
              {mode === "split"
                ? splitRows(hunk.lines).map((row, r) => (
                    <tr key={r}>
                      {[row.left, row.right].map((line, side) =>
                        line === null ? (
                          <td key={side} colSpan={3} className="bg-surface-muted" />
                        ) : (
                          <SplitCells
                            key={side}
                            line={line}
                            number={side === 0 ? line.oldNo : line.newNo}
                            markup={current}
                            code={code}
                          />
                        ),
                      )}
                    </tr>
                  ))
                : hunk.lines.map((line, l) => (
                    <tr key={l} data-kind={line.kind} className={ROW[line.kind]}>
                      <td className={NUMBER_CELL}>{line.oldNo ?? ""}</td>
                      <td className={NUMBER_CELL}>{line.newNo ?? ""}</td>
                      <td className={SIGN_CELL}>{SIGN[line.kind]}</td>
                      <td className={`w-full pr-3 pl-1 ${code}`}>
                        <LineCode line={line} markup={current} />
                      </td>
                    </tr>
                  ))}
            </tbody>
          ))}
        </table>
      </div>
    </div>
  );
}

/** One side of a split row: its number, sign and code, on its own wash. */
function SplitCells({
  line,
  number,
  markup,
  code,
}: {
  line: DiffLine;
  number: number | null;
  markup: SideMarkup | null;
  code: string;
}) {
  const wash = ROW[line.kind];
  return (
    <>
      <td data-kind={line.kind} className={`${NUMBER_CELL} ${wash}`}>
        {number ?? ""}
      </td>
      <td data-kind={line.kind} className={`${SIGN_CELL} ${wash}`}>
        {SIGN[line.kind]}
      </td>
      <td data-kind={line.kind} className={`w-1/2 pr-3 pl-1 ${code} ${wash}`}>
        <LineCode line={line} markup={markup} />
      </td>
    </>
  );
}
