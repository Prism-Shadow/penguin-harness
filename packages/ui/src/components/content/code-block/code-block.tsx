/**
 * Code rendering, in two layers.
 *
 * `CodeSurface` is the code itself: a `<pre>` highlighted by Shiki — the light colours inline and
 * the dark ones as `--shiki-dark` variables, switched under the dark mode by prose.css, so switching
 * the mode doesn't require re-highlighting. The surface never runs Shiki itself: it asks a
 * {@link CodeHighlighter} — its `highlight` prop, or the one the nearest `CodeHighlighterProvider`
 * supplies — and until that answers, and for languages it doesn't carry, it shows the code
 * unhighlighted. The Web App supplies a worker-backed highlighter once, around its tree; the engine
 * lives on its own subpath (highlighter-core.ts) so no static import of this module reaches Shiki.
 * The surface carries no chrome at all, which is what lets the Files panel put its source view and
 * its editor on the same layer and know they agree.
 *
 * `CodeBlock` is that surface inside a message's chrome (visual reference: better-chatbot's
 * pre-block): a bordered box with a head carrying the language label and a copy button. It is the
 * `ui-frame` host for code, so a theme may redraw the box. Message code blocks keep no line numbers
 * and no wrapping — wrapping is a file viewer's answer, not a transcript's.
 *
 * `highlight={false}` (while a message is streaming) skips highlighting and shows plain text: every
 * streaming frame re-renders the full code with a growing length, re-tokenizing the whole block
 * each time would be O(n^2) work, and an in-progress highlight can't be cancelled; once streaming
 * settles, `highlight` flips back and a single final highlight is done.
 *
 * The code's own look — the surface metrics, the gutter, the editor overlay — is in prose.css.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { useUiStrings } from "../../../strings";
import { CopyButton } from "../../actions/copy-button/copy-button";
import { arrivalText } from "../prose/stream-arrivals";
import type { RevealArrival } from "../prose/stream-arrivals";
import type { CodeHighlighter } from "./highlight-options";
import { runtimeLanguageGeneration, subscribeToRuntimeLanguages } from "./code-languages";
import { alignRows, splitHighlighted } from "./code-lines";
import type { CodeRow, HighlightedLines } from "./code-lines";
import { useGutterClip } from "./gutter-clip";
import "../prose/prose.css";

export type { CodeHighlighter, CodeMark, HighlightOptions } from "./highlight-options";

const CodeHighlighterContext = createContext<CodeHighlighter | null>(null);

/**
 * Supplies the highlighter every code surface below it uses unless it is handed its own. Mount it
 * once, around the app; pass a module-level function, since a new one re-highlights every block.
 */
export function CodeHighlighterProvider({
  highlight,
  children,
}: {
  highlight: CodeHighlighter | null;
  children?: ReactNode;
}): ReactElement {
  return (
    <CodeHighlighterContext.Provider value={highlight}>{children}</CodeHighlighterContext.Provider>
  );
}

/** The nearest provider's highlighter, or null where none is mounted. */
export function useCodeHighlighter(): CodeHighlighter | null {
  return useContext(CodeHighlighterContext);
}

/**
 * What a `highlight` prop resolves to: a function is used as given, `true` means the provider's,
 * `false` means none.
 */
export function resolveHighlighter(
  highlight: boolean | CodeHighlighter,
  provided: CodeHighlighter | null,
): CodeHighlighter | null {
  if (typeof highlight === "function") return highlight;
  return highlight ? provided : null;
}

/**
 * The highlighted code, with no box around it.
 *
 * With `lineNumbers`, the lines become blocks (see highlighter-core.ts's BLOCK_LINES) so a CSS
 * counter can draw a gutter that survives wrapping, and the unhighlighted fallback is split
 * into the same line elements — one gutter, whichever path rendered the code, and one shape for
 * a caller that needs to lay something else over it. Each line is an element of its own that
 * outlives an edit, and keeps its colours while its text is what was highlighted (code-lines.ts):
 * typing redraws the lines it touches, not the file and its gutter.
 */
export function CodeSurface({
  language,
  code,
  highlight = true,
  lineNumbers = false,
  wrap = false,
  settleMs = 0,
  className = "",
  arrivals,
  children,
}: {
  language: string;
  code: string;
  /**
   * Who highlights: `true` (the default) the nearest `CodeHighlighterProvider`'s highlighter, a
   * function that one, `false` nobody — the code shows plain.
   */
  highlight?: boolean | CodeHighlighter;
  /** Draw a line-number gutter (and, with it, put each line in a block of its own). */
  lineNumbers?: boolean;
  /** Soft-wrap long lines instead of scrolling sideways. */
  wrap?: boolean;
  /**
   * Wait this long after the last change before highlighting. 0 (the default) highlights every
   * change, which is right for code that is rendered once; an editor passes a delay so that
   * typing costs nothing but a re-render. While a highlight is pending the surface shows the
   * CURRENT text, never the previous text's colours over it — a code layer that lags the
   * keystrokes it sits under is worse than a colourless one. A numbered surface keeps the colours
   * of the lines the change left alone and draws only the lines it touched plain; an unnumbered
   * one draws the whole block plain.
   */
  settleMs?: number;
  className?: string;
  /**
   * Runs of the code still fading in, as offsets into it (a streaming reply's block, see
   * stream-arrivals.ts): the unhighlighted text puts each in a `data-arrive` span. A highlighted
   * or numbered surface ignores them.
   */
  arrivals?: readonly RevealArrival[];
  /** Laid over the code in the same scroll box (the Files panel's editor puts its textarea here). */
  children?: ReactNode;
}) {
  const highlighter = resolveHighlighter(highlight, useCodeHighlighter());
  const [highlighted, setHighlighted] = useState<{
    code: string;
    html: string;
    /** The same markup cut into lines, for a numbered surface; null when it could not be. */
    lines: HighlightedLines | null;
  }>();
  // A plugin's languages arrive after the first paint, so a block rendered before them
  // resolved to "no grammar" and would stay unhighlighted for the life of the page. The
  // generation is part of the effect's deps, so a registration re-runs the highlight once.
  const languageGeneration = useSyncExternalStore(
    subscribeToRuntimeLanguages,
    runtimeLanguageGeneration,
    runtimeLanguageGeneration,
  );

  useEffect(() => {
    if (highlighter === null) {
      setHighlighted(undefined);
      return;
    }
    let alive = true;
    const run = () => {
      // Through a resolved promise, so a highlighter that throws instead of rejecting lands in the
      // same catch.
      void Promise.resolve()
        .then(() => highlighter(code, language, { blockLines: lineNumbers }))
        .then((out) => {
          if (alive && out !== undefined) {
            setHighlighted({ code, html: out, lines: lineNumbers ? splitHighlighted(out) : null });
          }
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
  }, [code, language, highlighter, lineNumbers, settleMs, languageGeneration]);

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

  /**
   * A numbered surface draws line by line, from the newest highlight it has — the current text's
   * or an earlier one, whose lines still colour the lines that did not change. Only markup that
   * could not be cut into lines falls back to the whole block.
   */
  const split = highlighted?.lines ?? null;
  const byLine = lines !== null && (split !== null || html === undefined);
  const drawn = useRef<CodeRow[]>([]);
  const nextKey = useRef(0);
  const rows = useMemo(
    () =>
      byLine && lines !== null
        ? alignRows(drawn.current, lines, split, () => (nextKey.current += 1))
        : null,
    [byLine, lines, split],
  );
  useEffect(() => {
    if (rows !== null) drawn.current = rows;
  }, [rows]);

  /**
   * Unwrapped, the numbers are a column of their own, sticky at the scroll box's left edge, and
   * the code layer is clipped under it as it scrolls sideways (gutter-clip.ts). Wrapped, nothing
   * scrolls sideways, and each line draws its own number in front of its first row (prose.css),
   * which is what keeps a number beside its line however many rows the line wraps to.
   */
  const column = lines !== null && !wrap;
  const lineCount = lines?.length ?? 0;
  const numbers = useMemo(
    () => (column ? Array.from({ length: lineCount }, (_, i) => String(i + 1)).join("\n") : ""),
    [column, lineCount],
  );
  const surfaceRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLElement | null>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  useGutterClip({ surface: surfaceRef, layer: layerRef, gutter: gutterRef }, column);
  const setLayer = useCallback((el: HTMLElement | null) => {
    layerRef.current = el;
  }, []);

  return (
    <div
      ref={surfaceRef}
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
      {column && (
        <div ref={gutterRef} className="code-gutter" aria-hidden="true">
          {numbers}
        </div>
      )}
      {rows !== null ? (
        <pre
          ref={setLayer}
          className={split?.pre.className}
          style={split?.pre.style}
          tabIndex={split?.pre.tabIndex}
        >
          <code>
            {/* No newline between the spans: they are blocks, and the text a selection
                serialises out of a run of blocks already carries the breaks. The code sits in
                an inner span keyed by its kind, so a line turning plain or coloured keeps its
                line element, and with it the number drawn in front of it. */}
            {rows.map((row) => (
              <span key={row.key} className="line">
                {row.html !== null ? (
                  <span key="h" className="line-code" dangerouslySetInnerHTML={row.html} />
                ) : (
                  <span key="t" className="line-code">
                    {row.text}
                  </span>
                )}
              </span>
            ))}
          </code>
        </pre>
      ) : htmlProp !== undefined ? (
        <div ref={setLayer} dangerouslySetInnerHTML={htmlProp} />
      ) : (
        <pre>
          <code>{arrivalText(code, arrivals)}</code>
        </pre>
      )}
      {children}
    </div>
  );
}

/**
 * A fenced block in a message: the language and a copy button over the code. The frame's
 * fill, rules and body read the `--ui-code-*` tokens; the size is the theme's code rung. A block
 * in a reply still fading in (stream-arrivals.ts) may carry `arrive`, the time it arrived, and
 * fades in whole, and `arrivals`, the runs of its code that came after it.
 */
export function CodeBlock({
  language,
  code,
  highlight = true,
  copyLabel,
  arrive,
  arrivals,
}: {
  language: string;
  code: string;
  /** As on `CodeSurface`: `false` while the code is still streaming in. */
  highlight?: boolean | CodeHighlighter;
  /** The copy button's name and tooltip; the interface's "Copy code" when omitted. */
  copyLabel?: string;
  /** When the block arrived in a reply still fading in, ms (`data-arrive`). */
  arrive?: number;
  /** As on `CodeSurface`. */
  arrivals?: readonly RevealArrival[];
}) {
  const strings = useUiStrings();
  return (
    <div
      className="code-block ui-frame my-2 overflow-hidden rounded-lg border border-[var(--ui-code-line)]"
      data-arrive={arrive === undefined || !Number.isFinite(arrive) ? undefined : arrive}
    >
      <div
        data-slot="head"
        className="flex items-center justify-between border-b border-[var(--ui-code-line)] bg-[var(--ui-code-bg)] px-3 py-1"
      >
        {/* The language is an identifier, not copy: the same in every interface language. */}
        <span className="font-mono text-xs lowercase text-fg-muted">{language || "text"}</span>
        {/* Always visible — the head has no hover-gated container. */}
        <CopyButton text={code} label={copyLabel ?? strings.copyCode} />
      </div>
      <div
        data-slot="body"
        className="overflow-x-auto bg-canvas text-[length:var(--ui-text-code-size)] leading-relaxed"
      >
        <CodeSurface language={language} code={code} highlight={highlight} arrivals={arrivals} />
      </div>
    </div>
  );
}
