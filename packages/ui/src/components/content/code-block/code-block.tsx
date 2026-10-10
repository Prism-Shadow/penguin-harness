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
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { useUiStrings } from "../../../strings";
import { CopyButton } from "../../actions/copy-button/copy-button";
import type { CodeHighlighter } from "./highlight-options";
import { runtimeLanguageGeneration, subscribeToRuntimeLanguages } from "./code-languages";
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
   * CURRENT text unhighlighted rather than the previous text's colours — a code layer that
   * lags the keystrokes it sits under is worse than a colourless one.
   */
  settleMs?: number;
  className?: string;
  /** Laid over the code in the same scroll box (the Files panel's editor puts its textarea here). */
  children?: ReactNode;
}) {
  const highlighter = resolveHighlighter(highlight, useCodeHighlighter());
  const [highlighted, setHighlighted] = useState<{ code: string; html: string }>();
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

/**
 * A fenced block in a message: the language and a copy button over the code. The frame's
 * fill, rules and body read the `--ui-code-*` tokens; the size is the theme's code rung.
 */
export function CodeBlock({
  language,
  code,
  highlight = true,
  copyLabel,
}: {
  language: string;
  code: string;
  /** As on `CodeSurface`: `false` while the code is still streaming in. */
  highlight?: boolean | CodeHighlighter;
  /** The copy button's name and tooltip; the interface's "Copy code" when omitted. */
  copyLabel?: string;
}) {
  const strings = useUiStrings();
  return (
    <div className="code-block ui-frame my-2 overflow-hidden rounded-lg border border-[var(--ui-code-line)]">
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
        <CodeSurface language={language} code={code} highlight={highlight} />
      </div>
    </div>
  );
}
