/**
 * Code on the public sites, in three shapes:
 *
 * - `SiteCodeBlock`, a fenced block inside an article: the same surface for every block, holding
 *   either the highlighted markup or a plain `<pre>`. The plain one renders first (and stays, for
 *   a language with no grammar), so a block is readable before the highlighter chunk lands and
 *   if it never does; both states share padding and type, so the swap does not reflow the page.
 *   It asks the highlighter it is handed (`highlight`, or the one `SiteMarkdown` passes down) and
 *   never runs the engine itself; plain-text fences are never sent.
 * - `SiteCodeTabs`, one tab strip over the blocks a tab group holds: only the selected panel is
 *   mounted, so an install page shows one command instead of three stacked ones.
 * - `SiteCodeCard`, a terminal-style card for a short command: a label and a copy button over a
 *   monospace body whose `#` comment lines read muted.
 *
 * The block and the tabs take their look from site-prose.css (`.site-prose .site-code`), the card
 * from site-content.css.
 */
import { Children, createContext, useContext, useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { isPlainTextLanguage, resolveLanguage } from "../content/code-block/code-languages";
import type { CodeHighlighter } from "../content/code-block/highlight-options";
import { SiteCopyButton } from "./site-copy";
import { TerminalIcon } from "./site-icons";

/** The highlighter `SiteMarkdown` hands the fenced blocks it renders. */
export const SiteCodeHighlight = createContext<CodeHighlighter | null>(null);

export function SiteCodeBlock({
  code,
  language,
  highlight,
}: {
  code: string;
  language: string;
  /** Overrides the one `SiteMarkdown` passes down; none leaves the block plain. */
  highlight?: CodeHighlighter;
}) {
  const provided = useContext(SiteCodeHighlight);
  const highlighter = highlight ?? provided;
  // Held as the object React is handed, so its identity survives re-renders and the markup is
  // not re-set (a reader's selection inside the block stays put).
  const [markup, setMarkup] = useState<{ __html: string } | null>(null);

  useEffect(() => {
    const id = resolveLanguage(language);
    if (highlighter === null || id === undefined || isPlainTextLanguage(id)) {
      setMarkup(null);
      return;
    }
    let alive = true;
    highlighter(code, id).then(
      (result) => {
        if (alive) setMarkup(result ? { __html: result } : null);
      },
      () => {
        // A grammar that fails to load must not blank the block: it stays plain text.
        if (alive) setMarkup(null);
      },
    );
    return () => {
      alive = false;
    };
  }, [code, language, highlighter]);

  return (
    <div className="site-code">
      {markup ? (
        <div dangerouslySetInnerHTML={markup} />
      ) : (
        <pre>
          <code>{code}</code>
        </pre>
      )}
    </div>
  );
}

/**
 * Labels pair with the children in order — the pairing comes from the document, not from a
 * separate list that could drift. Arrow keys move between tabs, the roving tabindex keeping one
 * stop for the whole strip.
 */
export function SiteCodeTabs({ labels, children }: { labels: string[]; children: ReactNode }) {
  const panels = Children.toArray(children);
  const [selected, setSelected] = useState(0);
  // Pairing ids, so a screen reader can tell which tab owns the panel it is reading.
  const groupId = useId();
  const stripRef = useRef<HTMLDivElement | null>(null);
  const active = Math.min(selected, labels.length - 1);

  const move = (delta: number) => {
    const next = (active + delta + labels.length) % labels.length;
    setSelected(next);
    // Follow the selection with focus, so the next arrow key continues from the new tab.
    stripRef.current?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
  };

  return (
    <div className="site-code-tabs">
      <div className="site-code-tabs-strip" role="tablist" ref={stripRef}>
        {labels.map((label, index) => (
          <button
            key={label}
            type="button"
            role="tab"
            id={`${groupId}-tab-${index}`}
            aria-controls={`${groupId}-panel-${index}`}
            aria-selected={index === active}
            tabIndex={index === active ? 0 : -1}
            onClick={() => setSelected(index)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight") {
                event.preventDefault();
                move(1);
              } else if (event.key === "ArrowLeft") {
                event.preventDefault();
                move(-1);
              }
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`${groupId}-panel-${active}`}
        aria-labelledby={`${groupId}-tab-${active}`}
      >
        {panels[active]}
      </div>
    </div>
  );
}

/** No highlighter: the card holds short shell commands, where the muted comments are enough. */
export function SiteCodeCard({
  code,
  label = "shell",
  copy,
  className = "",
}: {
  code: string;
  label?: string;
  /** The copy button's label, and what a screen reader hears once the command is copied. */
  copy: { label: string; announcement: string };
  className?: string;
}) {
  const lines = code.split("\n");
  return (
    <div className={`site-code-card ${className}`}>
      <div className="site-code-card-head flex items-center justify-between gap-2 px-3 py-2">
        <span className="site-code-card-label inline-flex min-w-0 items-center gap-1.5 text-xs">
          <TerminalIcon className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate font-mono">{label}</span>
        </span>
        <SiteCopyButton text={code} label={copy.label} announcement={copy.announcement} />
      </div>
      <pre className="site-code-card-body overflow-x-auto px-4 py-3">
        <code>
          {lines.map((line, i) => (
            <span
              key={i}
              className="site-code-card-line block whitespace-pre"
              data-comment={line.trimStart().startsWith("#") || undefined}
            >
              {line.length > 0 ? line : " "}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}
