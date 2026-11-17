/**
 * A ranking beside a showcase grid: numbered rows, one subject each, on one of a few boards the
 * reader switches between by tabs (the plugin market's "Popular" and "Rising"). A row is its
 * rank, the subject's cover as a thumbnail, its title on one line, and under it its tags with
 * the figure the board ranks by at the line's end, that board's mark before it. The first three ranks sit on a tinted chip;
 * the rest are plain figures, so the top of the board reads at a glance without a colour per
 * place.
 *
 * The title is the row's opener — a link when the host gives an `href` (the public site), a
 * button otherwise (the Web App) — and it stretches over the whole row, so the thumbnail and
 * the figure open it too while the reader tabs through one stop per row. The figure is the
 * host's own wording, shortened as it likes ("1.2k"); `countLabel` says it in full, on hover and
 * for assistive technology. The tabs follow the WAI-ARIA tabs pattern: arrow keys, Home and End
 * move between boards, and only the chosen tab is a tab stop.
 *
 * `ShowcaseSplit` is the ranking's place: beside the grid as a right column when the split's own
 * width holds both (a grid of two card columns and the panel), under the grid otherwise — a
 * phone, or a narrow window with the sidebar open.
 *
 * Props only: every word, mark and figure is the caller's, and so is the decision to show a
 * ranking at all (a host with nothing to rank renders none). The look is showcase.css; the panel
 * is a `ui-showcase` host (hooks.ts).
 */
import { useId, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";

export interface RankingEntry {
  key: string;
  /** The subject's cover at its thumbnail rendition (`Cover`). */
  thumb: ReactNode;
  title: string;
  /** The tag line's items, keyed. Empty or omitted: no line. */
  tags?: ReactNode[];
  /** The figure the board ranks by, as the host words it ("1.2k"). */
  count: string;
  /** The same figure in full words ("1,234 installs"): on hover and for assistive technology. */
  countLabel: string;
  /** Where the subject's detail is, when it is a page; the opener is then a link. */
  href?: string;
  /** Opens the detail: the button's press, or the link's click (the host may route it). */
  onOpen?: (event: MouseEvent<HTMLElement>) => void;
}

export interface RankingBoard {
  key: string;
  /** The board's tab ("Popular"). */
  label: string;
  /** The mark before each figure on this board (a glyph). */
  mark?: ReactNode;
  /** In rank order, first first; the panel shows the first `limit`. */
  entries: readonly RankingEntry[];
}

export interface ShowcaseRankingProps {
  /** The panel's heading ("Rankings"). */
  title: string;
  boards: readonly RankingBoard[];
  /** How many rows a board shows at most. */
  limit?: number;
  level?: 2 | 3;
  className?: string;
}

/** The rows a board shows unless the host asks for another count. */
export const RANKING_LIMIT = 10;

/** The board an arrow, Home or End moves to from `at`, or null for any other key. */
function nextBoard(key: string, at: number, count: number): number | null {
  if (key === "ArrowRight" || key === "ArrowDown") return (at + 1) % count;
  if (key === "ArrowLeft" || key === "ArrowUp") return (at - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

export function ShowcaseRanking({
  title,
  boards,
  limit = RANKING_LIMIT,
  level = 2,
  className = "",
}: ShowcaseRankingProps) {
  const id = useId();
  const [picked, setPicked] = useState(0);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  if (boards.length === 0) return null;
  const at = Math.min(picked, boards.length - 1);
  const board = boards[at]!;
  const Title = level === 2 ? "h2" : "h3";
  const tabbed = boards.length > 1;
  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const next = nextBoard(event.key, at, boards.length);
    if (next === null) return;
    event.preventDefault();
    setPicked(next);
    tabs.current[next]?.focus();
  };

  const list = (
    <ol className="showcase-ranking-list">
      {board.entries.slice(0, limit).map((entry, i) => (
        <li key={entry.key} className="showcase-ranking-row">
          {/* The list numbers the row for assistive technology; the figure is for the eye. */}
          <span
            className="showcase-ranking-rank"
            aria-hidden
            {...(i < 3 ? { "data-top": "" } : {})}
          >
            {i + 1}
          </span>
          <span className="showcase-ranking-thumb">{entry.thumb}</span>
          <span className="showcase-ranking-text">
            {entry.href !== undefined ? (
              <a href={entry.href} onClick={entry.onOpen} className="showcase-ranking-open">
                {entry.title}
              </a>
            ) : (
              <button type="button" onClick={entry.onOpen} className="showcase-ranking-open">
                {entry.title}
              </button>
            )}
            <span className="showcase-ranking-meta">
              {entry.tags !== undefined && entry.tags.length > 0 && (
                <span className="showcase-ranking-tags">{entry.tags}</span>
              )}
              <span
                className="showcase-ranking-count"
                data-tooltip={entry.countLabel}
                data-tooltip-extra
              >
                {board.mark}
                <span aria-hidden>{entry.count}</span>
                <span className="showcase-hidden">{entry.countLabel}</span>
              </span>
            </span>
          </span>
        </li>
      ))}
    </ol>
  );

  return (
    <section
      className={`showcase showcase-ranking ui-showcase ${className}`}
      data-part="ranking"
      aria-labelledby={`${id}-title`}
    >
      <Title id={`${id}-title`} className="showcase-ranking-title">
        {title}
      </Title>
      {tabbed ? (
        <>
          <div role="tablist" aria-labelledby={`${id}-title`} className="showcase-ranking-tabs">
            {boards.map((b, i) => (
              <button
                key={b.key}
                ref={(el) => {
                  tabs.current[i] = el;
                }}
                type="button"
                role="tab"
                id={`${id}-tab-${i}`}
                aria-selected={i === at}
                aria-controls={`${id}-panel`}
                tabIndex={i === at ? 0 : -1}
                onClick={() => setPicked(i)}
                onKeyDown={onTabKey}
                className="showcase-ranking-tab"
              >
                {b.label}
              </button>
            ))}
          </div>
          <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${at}`}>
            {list}
          </div>
        </>
      ) : (
        list
      )}
    </section>
  );
}

/**
 * A showcase grid with a panel beside it (the ranking): the panel a right column when the
 * split's own width holds both, under the grid otherwise.
 */
export function ShowcaseSplit({
  children,
  aside,
  className = "",
}: {
  children: ReactNode;
  /** The panel; absent, the grid takes the whole width. */
  aside?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`showcase showcase-split ${className}`} data-part="split">
      <div className="showcase-split-grid">
        <div className="showcase-split-main">{children}</div>
        {aside !== undefined && aside !== null && aside !== false && (
          <div className="showcase-split-aside">{aside}</div>
        )}
      </div>
    </div>
  );
}
